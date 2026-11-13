import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { installBigIntJson } from './common/bigint-json';
import { ENV, type Env } from './config/env';

/** Everything main.ts and the e2e tests both need on the app instance. */
export function setupApp(app: INestApplication): void {
  installBigIntJson();
  const env = app.get<Env>(ENV);
  const express = app as NestExpressApplication;
  // Behind the console's proxy or a load balancer, the client IP is in X-Forwarded-For.
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
}
