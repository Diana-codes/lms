import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { maskPhone, normaliseRwPhone } from '@kora/core';
import { AuditService } from '../audit/audit.service';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import type { User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { companyDisplayName, currentCompanyId } from '../tenancy/company-context';
import {
  type AccessTokenClaims,
  type TwoFactorChallengeClaims,
  type TwoFactorMethod,
  twoFactorMethod,
  twoFactorView,
} from './auth.types';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password';
import { CODE_TTL_MINUTES, TextCodes } from './text-codes';
import { generateTotpSecret, totpUri, verifyTotp } from './totp';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
const CHALLENGE_TTL_SECONDS = 300;
export const REFRESH_GRACE_SECONDS = 20;
const SESSION_EXPIRED = 'Session expired. Sign in again.';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface SessionTokens {
  accessToken: string;
  /** Null when an existing refresh token stays in place (see `refresh`). */
  refreshToken: string | null;
  accessTtlSeconds: number;
  refreshExpiresAt: Date;
}

/** The second sign-in step: which code to ask for, and where a texted one went. */
export interface TwoFactorChallenge {
  status: 'TWO_FACTOR_REQUIRED';
  method: TwoFactorMethod;
  challengeToken: string;
  /** For texted codes: the number it went to, masked. */
  sentTo?: string;
}

export type LoginResult =
  { status: 'OK'; tokens: SessionTokens; user: PublicUser } | TwoFactorChallenge;

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: User['role'];
  branchId: string | null;
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod | null;
  verifiedPhone: string | null;
  mustChangePassword: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    branchId: user.branchId,
    ...twoFactorView(user),
    mustChangePassword: user.mustChangePassword,
  };
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

// One message for every sign-in failure, so the response never reveals
// whether an email address has an account.
const BAD_CREDENTIALS = 'Email or password is incorrect';

@Injectable()
export class AuthService {
  /** A real hash to verify against when the email is unknown, to even out timing. */
  private dummyHash: Promise<string> | null = null;
  private readonly codes: TextCodes;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly crypto: PiiCrypto,
    providers: ProvidersService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.codes = new TextCodes(
      () => this.prisma.staffCode,
      crypto,
      () => providers.platformSms(),
      env.NODE_ENV === 'development',
    );
  }

  async login(email: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
    });

    if (!user || !user.isActive) {
      this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
      await verifyPassword(await this.dummyHash, password);
      await this.audit.record({
        action: 'auth.login.failed',
        metadata: { reason: user ? 'inactive' : 'unknown_email' },
        ...meta,
      });
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    this.assertNotLocked(user);

    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.registerFailure(user, 'bad_password', meta);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    const method = twoFactorMethod(user);
    if (method) {
      const sent = method === 'sms' ? await this.sendSignInCode(user) : undefined;
      return {
        status: 'TWO_FACTOR_REQUIRED',
        method,
        challengeToken: await this.challengeToken(user, method),
        sentTo: sent?.sentTo,
      };
    }

    // No second factor yet. Two-factor is required, so the session can only
    // be used to set it up (see JwtAuthGuard).
    return { status: 'OK', ...(await this.startSession(user, meta)) };
  }

  /** Second step of sign-in: a code from the authenticator app or a text message. */
  async completeTwoFactor(
    challengeToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<{ tokens: SessionTokens; user: PublicUser }> {
    const { user, method } = await this.challengedUser(challengeToken);
    this.assertNotLocked(user);

    if (method === 'app') {
      const step = verifyTotp(this.crypto.decrypt(user.totpSecretEnc!), code, {
        afterStep: user.totpLastStep,
      });
      if (step == null) {
        await this.registerFailure(user, 'bad_totp', meta);
        throw new UnauthorizedException('That code is not valid');
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
    } else if (!(await this.codes.verify(user.id, 'SIGN_IN', code))) {
      await this.registerFailure(user, 'bad_sms_code', meta);
      throw new UnauthorizedException('That code is not valid or has expired');
    }
    return this.startSession(user, meta);
  }

  /** Text a new sign-in code, for someone waiting at the code step. */
  async resendSignInCode(challengeToken: string): Promise<{ sentTo: string }> {
    const { user, method } = await this.challengedUser(challengeToken);
    if (method !== 'sms') throw new BadRequestException('Use the code from your authenticator app');
    this.assertNotLocked(user);
    return this.sendSignInCode(user, true);
  }

  /** Step one of setting up texted codes: send a code to the number given. */
  async startPhoneVerification(userId: string, input: string): Promise<{ sentTo: string }> {
    const phone = normaliseRwPhone(input);
    if (!phone) throw new BadRequestException('Enter a Rwandan mobile number, e.g. 078 812 3412');
    return this.codes.send(
      userId,
      'VERIFY_PHONE',
      phone,
      (code) =>
        `${companyDisplayName()}: ${code} is your code to confirm this phone for sign-in. It expires in ${CODE_TTL_MINUTES} minutes.`,
    );
  }

  /** Step two: the code arrived, so the number is theirs. Sign-in codes go there from now on. */
  async confirmPhone(userId: string, code: string, meta: RequestMeta): Promise<PublicUser> {
    const row = await this.codes.verify(userId, 'VERIFY_PHONE', code);
    if (!row) throw new BadRequestException('That code is not valid or has expired');
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: row.phone, phoneVerifiedAt: new Date() },
    });
    await this.audit.record({
      action: 'auth.2fa.phone_verified',
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      metadata: { phone: maskPhone(row.phone) },
      ...meta,
    });
    return toPublicUser(user);
  }

  /**
   * Swap a refresh token for a new pair. The old refresh token stops working,
   * apart from a short grace window: if a second request arrives with the
   * token that was just replaced (two tabs, or parallel page loads), it gets
   * a new access token but no new refresh token.
   */
  async refresh(
    refreshToken: string,
    meta: RequestMeta,
  ): Promise<{ tokens: SessionTokens; user: PublicUser }> {
    const hash = sha256(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: { OR: [{ refreshTokenHash: hash }, { prevRefreshTokenHash: hash }] },
      include: { user: true },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    const user = toPublicUser(session.user);
    const accessTtlSeconds = this.env.ACCESS_TOKEN_TTL_SECONDS;

    if (session.refreshTokenHash !== hash) {
      const age = session.rotatedAt ? now.getTime() - session.rotatedAt.getTime() : Infinity;
      if (age > REFRESH_GRACE_SECONDS * 1000) {
        // A replaced token turning up late may have been stolen: end the session.
        await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
        await this.audit.record({
          action: 'auth.refresh.reuse_detected',
          actorId: session.userId,
          entityType: 'Session',
          entityId: session.id,
          ...meta,
        });
        throw new UnauthorizedException(SESSION_EXPIRED);
      }
      return {
        user,
        tokens: {
          accessToken: await this.signAccessToken(session.user, session.id),
          refreshToken: null,
          accessTtlSeconds,
          refreshExpiresAt: session.expiresAt,
        },
      };
    }

    const next = randomBytes(32).toString('base64url');
    const refreshExpiresAt = this.refreshExpiry();
    // Conditional update: if two requests race with the same token, one
    // rotates it and the other falls into the grace window above.
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: {
        refreshTokenHash: sha256(next),
        prevRefreshTokenHash: hash,
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt: refreshExpiresAt,
        ip: meta.ip ?? session.ip,
      },
    });
    if (rotated.count !== 1) return this.refresh(refreshToken, meta);

    return {
      user,
      tokens: {
        accessToken: await this.signAccessToken(session.user, session.id),
        refreshToken: next,
        accessTtlSeconds,
        refreshExpiresAt,
      },
    };
  }

  /**
   * A user changes their own password. Other sessions are signed out; the
   * current one carries on.
   */
  async changePassword(
    userId: string,
    sessionId: string,
    current: string,
    next: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, current))) {
      await this.registerFailure(user, 'bad_password_on_change', meta);
      throw new UnauthorizedException('Your current password is incorrect');
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (await verifyPassword(user.passwordHash, next)) {
      throw new BadRequestException('Choose a password different from the current one');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(next),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
      },
    });
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: sessionId } },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'auth.password.changed',
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      ...meta,
    });
  }

  async logout(sessionId: string, userId: string, meta: RequestMeta): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ action: 'auth.logout', actorId: userId, ...meta });
  }

  /** Start two-factor setup: make a secret and hand it to the user's authenticator app. */
  async beginTwoFactorSetup(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new ConflictException('Two-factor is already on');
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: this.crypto.encrypt(secret), totpLastStep: null },
    });
    return { secret, otpauthUrl: totpUri(secret, user.email) };
  }

  /** Finish setup by proving the authenticator app produces valid codes. */
  async enableTwoFactor(userId: string, code: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new ConflictException('Two-factor is already on');
    if (!user.totpSecretEnc) throw new BadRequestException('Start two-factor setup first');

    const step = verifyTotp(this.crypto.decrypt(user.totpSecretEnc), code);
    if (step == null) throw new BadRequestException('That code is not valid');

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date(), totpLastStep: step },
    });
    await this.audit.record({
      action: 'auth.2fa.enabled',
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      ...meta,
    });
  }

  /**
   * Stop using the authenticator app; codes then come by text. Needs the
   * password and a current app code, and a verified phone (two-factor is
   * required, so it cannot simply be switched off).
   */
  async disableTwoFactor(
    userId: string,
    password: string,
    code: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabledAt || !user.totpSecretEnc) {
      throw new BadRequestException('The authenticator app is not in use');
    }
    if (!user.phone || !user.phoneVerifiedAt) {
      throw new BadRequestException(
        'Confirm a phone number for text-message codes first. Two-factor sign-in is required.',
      );
    }
    const passwordOk = await verifyPassword(user.passwordHash, password);
    const step = verifyTotp(this.crypto.decrypt(user.totpSecretEnc), code, {
      afterStep: user.totpLastStep,
    });
    if (!passwordOk || step == null) {
      throw new UnauthorizedException('Password or code is incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null },
    });
    await this.audit.record({
      action: 'auth.2fa.disabled',
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      ...meta,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    if (claims.typ !== 'access') throw new UnauthorizedException();
    return claims;
  }

  // ── internals ──────────────────────────────────────────────────────────

  private challengeToken(user: User, method: TwoFactorMethod): Promise<string> {
    const claims: TwoFactorChallengeClaims = {
      sub: user.id,
      cid: user.companyId,
      typ: '2fa',
      m: method,
    };
    return this.jwt.signAsync(claims, { expiresIn: CHALLENGE_TTL_SECONDS });
  }

  /** The user a sign-in challenge is for, if it is still valid and their method unchanged. */
  private async challengedUser(
    challengeToken: string,
  ): Promise<{ user: User; method: TwoFactorMethod }> {
    const expired = new UnauthorizedException('Sign-in expired. Start again.');
    let claims: TwoFactorChallengeClaims;
    try {
      claims = await this.jwt.verifyAsync<TwoFactorChallengeClaims>(challengeToken);
    } catch {
      throw expired;
    }
    if (claims.typ !== '2fa' || claims.cid !== currentCompanyId()) throw expired;
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.isActive || twoFactorMethod(user) !== claims.m) throw expired;
    return { user, method: claims.m };
  }

  private sendSignInCode(user: User, resend = false): Promise<{ sentTo: string }> {
    return this.codes.send(
      user.id,
      'SIGN_IN',
      user.phone!,
      (code) =>
        `${companyDisplayName()}: your sign-in code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. Never share it with anyone.`,
      { resend },
    );
  }

  private assertNotLocked(user: User): void {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async registerFailure(user: User, reason: string, meta: RequestMeta): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    const locked = updated.failedLoginCount >= MAX_FAILED_LOGINS;
    if (locked) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
        },
      });
    }
    await this.audit.record({
      action: locked ? 'auth.login.locked' : 'auth.login.failed',
      actorId: user.id,
      entityType: 'User',
      entityId: user.id,
      metadata: { reason },
      ...meta,
    });
  }

  private async startSession(
    user: User,
    meta: RequestMeta,
  ): Promise<{ tokens: SessionTokens; user: PublicUser }> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = this.refreshExpiry();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.record({
      action: 'auth.login',
      actorId: user.id,
      entityType: 'User',
      entityId: user.id,
      metadata: { twoFactor: twoFactorMethod(user) },
      ...meta,
    });
    return {
      user: toPublicUser(user),
      tokens: {
        accessToken: await this.signAccessToken(user, session.id),
        refreshToken,
        accessTtlSeconds: this.env.ACCESS_TOKEN_TTL_SECONDS,
        refreshExpiresAt,
      },
    };
  }

  private signAccessToken(user: User, sessionId: string): Promise<string> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      sid: sessionId,
      cid: user.companyId,
      role: user.role,
      typ: 'access',
    };
    return this.jwt.signAsync(claims, { expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS });
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }
}
