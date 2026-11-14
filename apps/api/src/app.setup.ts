import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { installBigIntJson } from './common/bigint-json';
import { CompaniesService } from './tenancy/companies.service';
import { CompanyMiddleware } from './tenancy/company.middleware';

/** Everything main.ts and the e2e tests both need on the app instance. */
export function setupApp(app: INestApplication): void {
  installBigIntJson();
  const companies = app.get(CompaniesService);
  const companyMiddleware = app.get(CompanyMiddleware);
  const express = app as NestExpressApplication;
  // Behind the console's proxy or a load balancer, the client IP is in X-Forwarded-For.
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  // The console runs on one subdomain per company, so allow any of them.
  app.enableCors({
    origin: (origin: string | undefined, done: (err: Error | null, allow?: boolean) => void) =>
      done(null, !origin || companies.isAllowedOrigin(origin)),
    credentials: true,
  });
  // Every request runs inside a company context (see tenancy/).
  app.use(companyMiddleware.use.bind(companyMiddleware));
  app.enableShutdownHooks();
}
