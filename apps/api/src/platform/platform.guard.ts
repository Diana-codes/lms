import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CompaniesService } from '../tenancy/companies.service';
import {
  PLATFORM_COOKIE,
  PlatformAuthService,
  type PlatformAdminView,
} from './platform-auth.service';

export type PlatformRequest = Request & {
  platformAdmin?: PlatformAdminView & { sessionId: string };
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BEFORE_TWO_FACTOR = 'platform:beforeTwoFactor';

/** Routes a platform admin may use before turning on two-factor (to turn it on). */
export const AllowBeforeTwoFactor = () => SetMetadata(BEFORE_TWO_FACTOR, true);

/**
 * For /platform routes (marked @Public for the staff guard). Requires a
 * platform admin session, and two-factor sign-in turned on: until it is, only
 * the setup routes work. Writes must come from the console (CSRF defence, on
 * top of the strict SameSite cookie).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly companies: CompaniesService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PlatformRequest>();
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && !this.companies.isAllowedOrigin(origin)) {
        throw new ForbiddenException('Cross-site request blocked');
      }
    }
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.[PLATFORM_COOKIE];
    if (!token) throw new UnauthorizedException('Sign in to continue');
    const admin = await this.auth.verify(token);
    req.platformAdmin = admin;

    const allowed = this.reflector.getAllAndOverride<boolean>(BEFORE_TWO_FACTOR, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!admin.twoFactorEnabled && !allowed) {
      throw new ForbiddenException('Turn on two-factor sign-in first');
    }
    return true;
  }
}
