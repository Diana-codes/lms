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
import { redactDeep } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { hashPassword, verifyPassword } from '../auth/password';
import { generateTotpSecret, totpUri, verifyTotp } from '../auth/totp';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import type { Prisma } from '../generated/prisma/client';
import { PlatformPrismaService } from '../prisma/prisma.service';

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
}

const CHALLENGE_TTL_SECONDS = 300;

export interface PlatformAdminView {
  id: string;
  email: string;
  name: string;
  /** Two-factor is required: without it the admin can only set it up. */
  twoFactorEnabled: boolean;
}

export type PlatformLoginResult =
  | { status: 'OK'; token: string; admin: PlatformAdminView }
  | { status: 'TOTP_REQUIRED'; challengeToken: string };

/**
 * Sign-in for platform admins (Orin Tech House). Separate from company staff:
 * its own table, its own token type, and only the owner database login can
 * read it. Sessions last one working day and are checked on every request.
 */
@Injectable()
export class PlatformAuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: PlatformPrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: PiiCrypto,
    @Inject(ENV) private readonly env: Env,
  ) {}

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

    if (admin.totpEnabledAt) {
      const claims: PlatformChallengeClaims = { sub: admin.id, typ: 'platform-2fa' };
      return {
        status: 'TOTP_REQUIRED',
        challengeToken: await this.jwt.signAsync(claims, { expiresIn: CHALLENGE_TTL_SECONDS }),
      };
    }
    return { status: 'OK', ...(await this.startSession(admin.id, meta)) };
  }

  /** Second sign-in step, with a code from the authenticator app. */
  async completeTwoFactor(
    challengeToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<{ token: string; admin: PlatformAdminView }> {
    let claims: PlatformChallengeClaims;
    try {
      claims = await this.jwt.verifyAsync<PlatformChallengeClaims>(challengeToken);
    } catch {
      throw new UnauthorizedException('Sign-in expired. Start again.');
    }
    if (claims.typ !== 'platform-2fa')
      throw new UnauthorizedException('Sign-in expired. Start again.');
    const admin = await this.db.platformAdmin.findUnique({ where: { id: claims.sub } });
    if (!admin || !admin.isActive || !admin.totpEnabledAt || !admin.totpSecretEnc) {
      throw new UnauthorizedException('Sign-in expired. Start again.');
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new HttpException(
        `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const step = verifyTotp(this.crypto.decrypt(admin.totpSecretEnc), code, {
      afterStep: admin.totpLastStep,
    });
    if (step == null) {
      await this.registerFailure(admin.id, admin.failedLoginCount, 'bad_totp', meta);
      throw new UnauthorizedException('That code is not valid');
    }
    await this.db.platformAdmin.update({ where: { id: admin.id }, data: { totpLastStep: step } });
    return this.startSession(admin.id, meta);
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
    return { secret, otpauthUrl: totpUri(secret, admin.email, 'Kora Lend platform') };
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
    await this.audit('platform.login', admin.id, { twoFactor: admin.totpEnabledAt != null }, meta);
    const claims: PlatformClaims = { sub: admin.id, sid: session.id, typ: 'platform' };
    const token = await this.jwt.signAsync(claims, {
      expiresIn: PLATFORM_SESSION_HOURS * 3600,
    });
    return {
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        twoFactorEnabled: admin.totpEnabledAt != null,
      },
    };
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
    return {
      id: session.admin.id,
      email: session.admin.email,
      name: session.admin.name,
      twoFactorEnabled: session.admin.totpEnabledAt != null,
      sessionId: session.id,
    };
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
