import { randomBytes } from 'node:crypto';
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
import { redactDeep } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { type TwoFactorMethod, twoFactorMethod, twoFactorView } from '../auth/auth.types';
import { hashPassword, verifyPassword } from '../auth/password';
import { CODE_TTL_MINUTES, TextCodes } from '../auth/text-codes';
import { generateTotpSecret, totpUri, verifyTotp } from '../auth/totp';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import type { PlatformAdmin, Prisma } from '../generated/prisma/client';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { PRODUCT_NAME } from '../tenancy/company-context';

export const PLATFORM_COOKIE = 'kp_access';
export const PLATFORM_SESSION_HOURS = 8;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const BAD_CREDENTIALS = 'Email or password is incorrect';

export interface PlatformClaims {
  sub: string;
  sid: string;
  typ: 'platform';
}

interface PlatformChallengeClaims {
  sub: string;
  typ: 'platform-2fa';
  m: TwoFactorMethod;
}

const CHALLENGE_TTL_SECONDS = 300;
const EXPIRED = 'Sign-in expired. Start again.';

export interface PlatformAdminView {
  id: string;
  email: string;
  name: string;
  /** Two-factor is required: without it the admin can only set it up. */
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod | null;
  verifiedPhone: string | null;
}

export type PlatformLoginResult =
  | { status: 'OK'; token: string; admin: PlatformAdminView }
  | {
      status: 'TWO_FACTOR_REQUIRED';
      method: TwoFactorMethod;
      challengeToken: string;
      sentTo?: string;
    };

type Admin = PlatformAdmin;

const view = (admin: Admin): PlatformAdminView => ({
  id: admin.id,
  email: admin.email,
  name: admin.name,
  ...twoFactorView(admin),
});

/**
 * Sign-in for platform admins (Orin Tech House). Separate from company staff:
 * its own table, its own token type, and only the owner database login can
 * read it. Sessions last one working day and are checked on every request.
 */
@Injectable()
export class PlatformAuthService {
  private dummyHash: Promise<string> | null = null;
  private readonly codes: TextCodes;

  constructor(
    private readonly db: PlatformPrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: PiiCrypto,
    providers: ProvidersService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.codes = new TextCodes(
      () => this.db.platformCode,
      crypto,
      () => providers.platformSms(),
      env.NODE_ENV === 'development',
    );
  }

  async login(email: string, password: string, meta: RequestMeta): Promise<PlatformLoginResult> {
    const admin = await this.db.platformAdmin.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!admin || !admin.isActive) {
      this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
      await verifyPassword(await this.dummyHash, password);
      await this.audit('platform.login.failed', null, { reason: 'unknown_or_inactive' }, meta);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new HttpException(
        `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!(await verifyPassword(admin.passwordHash, password))) {
      await this.registerFailure(admin.id, admin.failedLoginCount, 'bad_password', meta);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    const method = twoFactorMethod(admin);
    if (method) {
      const sent = method === 'sms' ? await this.sendSignInCode(admin) : undefined;
      const claims: PlatformChallengeClaims = { sub: admin.id, typ: 'platform-2fa', m: method };
      return {
        status: 'TWO_FACTOR_REQUIRED',
        method,
        challengeToken: await this.jwt.signAsync(claims, { expiresIn: CHALLENGE_TTL_SECONDS }),
        sentTo: sent?.sentTo,
      };
    }
    return { status: 'OK', ...(await this.startSession(admin.id, meta)) };
  }

  /** Second sign-in step: a code from the authenticator app or a text message. */
  async completeTwoFactor(
    challengeToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<{ token: string; admin: PlatformAdminView }> {
    const { admin, method } = await this.challengedAdmin(challengeToken);
    this.assertNotLocked(admin);
    if (method === 'app') {
      const step = verifyTotp(this.crypto.decrypt(admin.totpSecretEnc!), code, {
        afterStep: admin.totpLastStep,
      });
      if (step == null) {
        await this.registerFailure(admin.id, admin.failedLoginCount, 'bad_totp', meta);
        throw new UnauthorizedException('That code is not valid');
      }
      await this.db.platformAdmin.update({ where: { id: admin.id }, data: { totpLastStep: step } });
    } else if (!(await this.codes.verify(admin.id, 'SIGN_IN', code))) {
      await this.registerFailure(admin.id, admin.failedLoginCount, 'bad_sms_code', meta);
      throw new UnauthorizedException('That code is not valid or has expired');
    }
    return this.startSession(admin.id, meta);
  }

  async resendSignInCode(challengeToken: string): Promise<{ sentTo: string }> {
    const { admin, method } = await this.challengedAdmin(challengeToken);
    if (method !== 'sms') throw new BadRequestException('Use the code from your authenticator app');
    this.assertNotLocked(admin);
    return this.sendSignInCode(admin, true);
  }

  /** Texted codes, step one: send a code to the number to confirm it. */
  async startPhoneVerification(adminId: string, input: string): Promise<{ sentTo: string }> {
    const phone = normaliseRwPhone(input);
    if (!phone) throw new BadRequestException('Enter a Rwandan mobile number, e.g. 078 812 3412');
    return this.codes.send(
      adminId,
      'VERIFY_PHONE',
      phone,
      (code) =>
        `${PRODUCT_NAME} platform: ${code} is your code to confirm this phone for sign-in. It expires in ${CODE_TTL_MINUTES} minutes.`,
    );
  }

  /** Texted codes, step two: the number is confirmed and sign-in codes go there. */
  async confirmPhone(adminId: string, code: string, meta: RequestMeta): Promise<PlatformAdminView> {
    const row = await this.codes.verify(adminId, 'VERIFY_PHONE', code);
    if (!row) throw new BadRequestException('That code is not valid or has expired');
    const admin = await this.db.platformAdmin.update({
      where: { id: adminId },
      data: { phone: row.phone, phoneVerifiedAt: new Date() },
    });
    await this.audit('platform.2fa.phone_verified', adminId, { phone: maskPhone(row.phone) }, meta);
    return view(admin);
  }

  private async challengedAdmin(
    challengeToken: string,
  ): Promise<{ admin: Admin; method: TwoFactorMethod }> {
    let claims: PlatformChallengeClaims;
    try {
      claims = await this.jwt.verifyAsync<PlatformChallengeClaims>(challengeToken);
    } catch {
      throw new UnauthorizedException(EXPIRED);
    }
    if (claims.typ !== 'platform-2fa') throw new UnauthorizedException(EXPIRED);
    const admin = await this.db.platformAdmin.findUnique({ where: { id: claims.sub } });
    if (!admin || !admin.isActive || twoFactorMethod(admin) !== claims.m) {
      throw new UnauthorizedException(EXPIRED);
    }
    return { admin, method: claims.m };
  }

  private sendSignInCode(admin: Admin, resend = false): Promise<{ sentTo: string }> {
    return this.codes.send(
      admin.id,
      'SIGN_IN',
      admin.phone!,
      (code) =>
        `${PRODUCT_NAME} platform: your sign-in code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. Never share it with anyone.`,
      { resend },
    );
  }

  private assertNotLocked(admin: Admin): void {
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new HttpException(
        `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Start two-factor setup: a new secret for the admin's authenticator app. */
  async beginTwoFactorSetup(adminId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const admin = await this.db.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    if (admin.totpEnabledAt) throw new ConflictException('Two-factor is already on');
    const secret = generateTotpSecret();
    await this.db.platformAdmin.update({
      where: { id: adminId },
      data: { totpSecretEnc: this.crypto.encrypt(secret), totpLastStep: null },
    });
    return { secret, otpauthUrl: totpUri(secret, admin.email, 'BF Loan Management System platform') };
  }

  /** Finish setup by proving the authenticator app produces valid codes. */
  async enableTwoFactor(adminId: string, code: string, meta: RequestMeta): Promise<void> {
    const admin = await this.db.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    if (admin.totpEnabledAt) throw new ConflictException('Two-factor is already on');
    if (!admin.totpSecretEnc) throw new BadRequestException('Start two-factor setup first');
    const step = verifyTotp(this.crypto.decrypt(admin.totpSecretEnc), code);
    if (step == null) throw new BadRequestException('That code is not valid');
    await this.db.platformAdmin.update({
      where: { id: adminId },
      data: { totpEnabledAt: new Date(), totpLastStep: step },
    });
    await this.audit('platform.2fa.enabled', adminId, undefined, meta);
  }

  private async registerFailure(
    adminId: string,
    failedSoFar: number,
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    const failed = failedSoFar + 1;
    const locked = failed >= MAX_FAILED_LOGINS;
    await this.db.platformAdmin.update({
      where: { id: adminId },
      data: locked
        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) }
        : { failedLoginCount: failed },
    });
    await this.audit(
      locked ? 'platform.login.locked' : 'platform.login.failed',
      adminId,
      { reason },
      meta,
    );
  }

  private async startSession(
    adminId: string,
    meta: RequestMeta,
  ): Promise<{ token: string; admin: PlatformAdminView }> {
    const admin = await this.db.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    const session = await this.db.platformSession.create({
      data: {
        adminId: admin.id,
        expiresAt: new Date(Date.now() + PLATFORM_SESSION_HOURS * 3_600_000),
      },
    });
    await this.db.platformAdmin.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit('platform.login', admin.id, { twoFactor: twoFactorMethod(admin) }, meta);
    const claims: PlatformClaims = { sub: admin.id, sid: session.id, typ: 'platform' };
    const token = await this.jwt.signAsync(claims, {
      expiresIn: PLATFORM_SESSION_HOURS * 3600,
    });
    return { token, admin: view(admin) };
  }

  /** The admin behind a token, if its session is still open. */
  async verify(token: string): Promise<PlatformAdminView & { sessionId: string }> {
    let claims: PlatformClaims;
    try {
      claims = await this.jwt.verifyAsync<PlatformClaims>(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    if (claims.typ !== 'platform') throw new UnauthorizedException('Session expired');
    const session = await this.db.platformSession.findUnique({
      where: { id: claims.sid },
      include: { admin: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.adminId !== claims.sub ||
      !session.admin.isActive
    ) {
      throw new UnauthorizedException('Session expired');
    }
    return { ...view(session.admin), sessionId: session.id };
  }

  async logout(sessionId: string, adminId: string, meta: RequestMeta): Promise<void> {
    await this.db.platformSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit('platform.logout', adminId, undefined, meta);
  }

  /** Platform events go to the audit log with no company (or the company acted on). */
  async audit(
    action: string,
    adminId: string | null,
    metadata: Record<string, unknown> | undefined,
    meta: RequestMeta,
    target?: { companyId?: string; entityType?: string; entityId?: string },
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        companyId: target?.companyId ?? null,
        actorType: 'PLATFORM',
        actorId: adminId,
        action,
        entityType: target?.entityType,
        entityId: target?.entityId,
        metadata: metadata ? (redactDeep(metadata) as Prisma.InputJsonValue) : undefined,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    });
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict' as const,
      path: '/',
      maxAge: PLATFORM_SESSION_HOURS * 3_600_000,
    };
  }
}
