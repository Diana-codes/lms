import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { BorrowerAuthService } from './borrower-auth.service';

export interface BorrowerPrincipal {
  borrowerId: string;
  sessionId: string;
}

/**
 * Routes under /app are for borrowers. They carry a Bearer token from the
 * phone-and-code sign-in; the staff guard lets them through as @Public and
 * this guard does the real check.
 */
@Injectable()
export class BorrowerGuard implements CanActivate {
  constructor(private readonly auth: BorrowerAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { borrower?: BorrowerPrincipal }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');
    try {
      const claims = await this.auth.verifyAccess(header.slice(7));
      req.borrower = { borrowerId: claims.sub, sessionId: claims.sid };
      return true;
    } catch {
      throw new UnauthorizedException('Session expired');
    }
  }
}
