import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { adoptTokenCompany } from '../auth/guards';
import { CompaniesService } from '../tenancy/companies.service';
import { BorrowerAuthService } from './borrower-auth.service';

export interface BorrowerPrincipal {
  borrowerId: string;
  sessionId: string;
}

/**
 * Routes under /app are for borrowers. They carry a Bearer token from the
 * phone-and-code sign-in; the staff guard lets them through as @Public and
 * this guard does the real check, including that the token belongs to the
 * company the request is for.
 */
@Injectable()
export class BorrowerGuard implements CanActivate {
  constructor(
    private readonly auth: BorrowerAuthService,
    private readonly companies: CompaniesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { borrower?: BorrowerPrincipal }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');
    try {
      const claims = await this.auth.verifyToken(header.slice(7));
      await adoptTokenCompany(this.companies, claims.cid);
      await this.auth.checkSession(claims);
      req.borrower = { borrowerId: claims.sub, sessionId: claims.sid };
      return true;
    } catch {
      throw new UnauthorizedException('Session expired');
    }
  }
}
