import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  type NestMiddleware,
  NotFoundException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ENV, type Env } from '../config/env';
import { CompaniesService, SLUG_PATTERN } from './companies.service';
import { type CompanyContext, runWithContext } from './company-context';

/** Header the console proxy and the borrower app use to name the company. */
export const COMPANY_HEADER = 'x-company';

export type CompanyRequest = Request & { company?: CompanyContext };

/**
 * Opens the company context for a request. The company comes from the
 * x-company header, then the Host subdomain, then (development and tests
 * only) DEFAULT_COMPANY_SLUG. In single-company mode (COMPANY_SLUG) every
 * request is for that one company, whatever the address. The auth guards then check that the signed-in
 * user belongs to that same company. Platform routes run with no company.
 */
@Injectable()
export class CompanyMiddleware implements NestMiddleware {
  constructor(
    private readonly companies: CompaniesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  use(req: CompanyRequest, res: Response, next: NextFunction): void {
    const context: CompanyContext = { companyId: null };
    req.company = context;
    runWithContext(context, () => {
      this.resolve(req, context).then(
        () => next(),
        (err: unknown) => {
          // This runs before Nest's own error handling, so answer directly.
          if (err instanceof HttpException) {
            res.status(err.getStatus()).json(err.getResponse());
          } else {
            next(err);
          }
        },
      );
    });
  }

  private async resolve(req: Request, context: CompanyContext): Promise<void> {
    // Platform administration and provider webhooks find their own way.
    if (req.path.startsWith('/platform') || req.path.startsWith('/webhooks')) return;

    const header = req.headers[COMPANY_HEADER];
    const named = typeof header === 'string' ? header.trim().toLowerCase() : undefined;
    const slug =
      this.env.COMPANY_SLUG ??
      (named || this.companies.slugFromHost(req.headers.host) || this.env.DEFAULT_COMPANY_SLUG);
    if (!slug) return; // A signed-in token may still name the company (see the guards).
    if (!SLUG_PATTERN.test(slug)) throw new NotFoundException('Unknown company');

    const company = await this.companies.bySlug(slug);
    if (!company) throw new NotFoundException('Unknown company');
    if (company.status !== 'ACTIVE') {
      throw new ForbiddenException("This company's account is suspended");
    }
    this.companies.enter(context, company);
  }
}
