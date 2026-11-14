import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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

/**
 * For /platform routes (marked @Public for the staff guard). Requires a
 * platform admin session. Writes must come from the console (CSRF defence,
 * on top of the strict SameSite cookie).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly companies: CompaniesService,
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
    req.platformAdmin = await this.auth.verify(token);
    return true;
  }
}
