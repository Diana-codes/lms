import { randomBytes } from 'node:crypto';
import {
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

export interface PlatformAdminView {
  id: string;
  email: string;
  name: string;
}

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
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ token: string; admin: PlatformAdminView }> {
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
      const failed = admin.failedLoginCount + 1;
      const locked = failed >= MAX_FAILED_LOGINS;
      await this.db.platformAdmin.update({
        where: { id: admin.id },
        data: locked
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) }
          : { failedLoginCount: failed },
      });
      await this.audit(
        locked ? 'platform.login.locked' : 'platform.login.failed',
        admin.id,
        { reason: 'bad_password' },
        meta,
      );
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

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
    await this.audit('platform.login', admin.id, undefined, meta);
    const claims: PlatformClaims = { sub: admin.id, sid: session.id, typ: 'platform' };
    const token = await this.jwt.signAsync(claims, {
      expiresIn: PLATFORM_SESSION_HOURS * 3600,
    });
    return { token, admin: { id: admin.id, email: admin.email, name: admin.name } };
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
