import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { TenantPool } from '../src/tenancy/tenant-pool';

/**
 * End-to-end tests use their own database (the configured one with "_test"
 * appended), so they never touch development or seeded data.
 */
export function testDatabaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  return url.toString();
}

/** The scoring service runs here during the tests. */
export const ML_TEST_PORT = 8765;

/**
 * The company the tests act as. Requests with no company name resolve to it
 * (DEFAULT_COMPANY_SLUG), and the tests' own database client is pinned to it.
 */
export const E2E_COMPANY_SLUG = 'e2e';
export const E2E_COMPANY_ID = '019a7a00-0000-7000-8000-0000000e2e01';
/** The test company's webhook secret (used in its MoMo and SMS callback URLs). */
export const E2E_WEBHOOK_TOKEN = 'e2e-webhook-token-0123456789';

/** A unique-key lookup by reference code, within the test company. */
export const byCode = (code: string) => ({
  companyId_code: { companyId: E2E_COMPANY_ID, code },
});

/**
 * A database client for test setup and checks. It uses the API's own
 * company-scoped login, so it sees exactly what the API sees for the test
 * company, and new rows land in that company.
 */
export function testPrisma(companyId: string = E2E_COMPANY_ID): PrismaClient {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error('APP_DATABASE_URL is not set. Run `pnpm setup:env` first.');
  return new PrismaClient({
    adapter: new PrismaPg(new TenantPool({ connectionString: url, max: 4 }, () => companyId)),
  });
}
