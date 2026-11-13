import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`API listening on http://localhost:${env.PORT}`);
}

void bootstrap();
