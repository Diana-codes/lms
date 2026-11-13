import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { StaffRole } from '@kora/core';
import type { Request } from 'express';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, type AuthUser } from './auth.types';
import { IS_PUBLIC, ROLES } from './decorators';

type AuthedRequest = Request & { user?: AuthUser; authVia?: 'cookie' | 'bearer' };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Applied to every route. A request must carry a valid access token, as a
 * Bearer header (mobile) or the httpOnly cookie (console), unless the route
 * is marked @Public(). The session is re-checked on each request, so signing
 * out or deactivating a user takes effect straight away.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    const token = bearer ?? cookie;
    const viaCookie = !bearer && !!cookie;

    // Cookies are sent automatically by browsers, so a cookie-authenticated
    // write must come from our own console (CSRF defence, on top of SameSite).
    if (!SAFE_METHODS.has(req.method) && (viaCookie || isPublic)) {
      const origin = req.headers.origin;
      if (origin && origin !== this.env.WEB_ORIGIN) {
        throw new ForbiddenException('Cross-site request blocked');
      }
    }

    if (isPublic) return true;
    if (!token) throw new UnauthorizedException('Sign in to continue');

    let claims;
    try {
      claims = await this.auth.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.userId !== claims.sub ||
      !session.user.isActive
    ) {
      throw new UnauthorizedException('Session expired');
    }

    const u = session.user;
    req.user = {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      // The role comes from the database, not the token, so a role change applies at once.
      role: u.role,
      branchId: u.branchId,
      sessionId: session.id,
      twoFactorEnabled: u.totpEnabledAt != null,
    };
    req.authVia = viaCookie ? 'cookie' : 'bearer';
    return true;
  }
}

/** Enforces @Roles(...). Routes without it are open to any signed-in staff member. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Your role does not allow this');
    }
    return true;
  }
}
