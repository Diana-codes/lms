import 'dotenv/config';
import { tmpdir } from 'node:os';
import path from 'node:path';
import 'reflect-metadata';
import { ML_TEST_PORT, testDatabaseUrl } from './test-db';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL ?? '');
if (process.env.REPORTING_DATABASE_URL)
  process.env.REPORTING_DATABASE_URL = testDatabaseUrl(process.env.REPORTING_DATABASE_URL);
// Tests always run on the local simulators and never call Claude, whatever .env holds.
delete process.env.MOMO_COLLECTION_SUBSCRIPTION_KEY;
delete process.env.MOMO_DISBURSEMENT_SUBSCRIPTION_KEY;
delete process.env.AFRICASTALKING_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
process.env.ML_URL = `http://127.0.0.1:${ML_TEST_PORT}`;
process.env.WEBHOOK_TOKEN ??= 'e2e-webhook-token';
process.env.JOBS_ENABLED = 'false';
// Uploaded test files go to a scratch folder, never the developer's uploads.
process.env.UPLOAD_DIR = path.join(tmpdir(), 'kora-lend-e2e-uploads');
