import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { StaffRole } from '@kora/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from '../tenancy/companies.service';
import { companyContext } from '../tenancy/company-context';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, type AuthUser } from './auth.types';
import { ALLOW_WHILE_PASSWORD_CHANGE, IS_PUBLIC, ROLES } from './decorators';

type AuthedRequest = Request & { user?: AuthUser; authVia?: 'cookie' | 'bearer' };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A token belongs to one company. When the request already names a company
 * (subdomain or header), the token must be for that company; a token from
 * another company is refused as if it had expired. When the request names
 * none (a mobile client talking to the bare API host), the token's company
 * is used, provided it is still active.
 */
export async function adoptTokenCompany(
  companies: CompaniesService,
  tokenCompanyId: string | undefined,
): Promise<void> {
  const context = companyContext();
  if (!context || !tokenCompanyId) throw new UnauthorizedException('Session expired');
  if (context.companyId) {
    if (context.companyId !== tokenCompanyId) throw new UnauthorizedException('Session expired');
    return;
  }
  const company = await companies.byId(tokenCompanyId);
  if (!company || company.status !== 'ACTIVE') throw new UnauthorizedException('Session expired');
  companies.enter(context, company);
}

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
    private readonly companies: CompaniesService,
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
      if (origin && !this.companies.isAllowedOrigin(origin)) {
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
    await adoptTokenCompany(this.companies, claims.cid);

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
      companyId: u.companyId,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      // The role comes from the database, not the token, so a role change applies at once.
      role: u.role,
      branchId: u.branchId,
      sessionId: session.id,
      twoFactorEnabled: u.totpEnabledAt != null,
      mustChangePassword: u.mustChangePassword,
    };
    req.authVia = viaCookie ? 'cookie' : 'bearer';

    if (u.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_PASSWORD_CHANGE, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) throw new ForbiddenException('Choose a new password first');
    }
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
