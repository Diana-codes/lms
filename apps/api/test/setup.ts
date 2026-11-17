import 'dotenv/config';
import { tmpdir } from 'node:os';
import path from 'node:path';
import 'reflect-metadata';
import { E2E_COMPANY_SLUG, E2E_WEBHOOK_TOKEN, ML_TEST_PORT, testDatabaseUrl } from './test-db';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL ?? '');
if (process.env.APP_DATABASE_URL)
  process.env.APP_DATABASE_URL = testDatabaseUrl(process.env.APP_DATABASE_URL);
if (process.env.REPORTING_DATABASE_URL)
  process.env.REPORTING_DATABASE_URL = testDatabaseUrl(process.env.REPORTING_DATABASE_URL);
// Requests that name no company act for the test company.
process.env.DEFAULT_COMPANY_SLUG = E2E_COMPANY_SLUG;
// Tests always run on the local simulators and never call Claude, whatever .env holds.
delete process.env.MOMO_COLLECTION_SUBSCRIPTION_KEY;
delete process.env.MOMO_DISBURSEMENT_SUBSCRIPTION_KEY;
delete process.env.AFRICASTALKING_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
process.env.ML_URL = `http://127.0.0.1:${ML_TEST_PORT}`;
// The test company was provisioned with this webhook secret (global-setup.ts).
process.env.WEBHOOK_TOKEN = E2E_WEBHOOK_TOKEN;
process.env.JOBS_ENABLED = 'false';
// The platform admin tests cover the second factor, which is off by default for local demos.
process.env.PLATFORM_TWO_FACTOR = 'true';
// Uploaded test files go to a scratch folder, never the developer's uploads.
process.env.UPLOAD_DIR = path.join(tmpdir(), 'kora-lend-e2e-uploads');
