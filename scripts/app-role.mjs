#!/usr/bin/env node
// Creates (or updates) the login the API uses for company data. It owns
// nothing, so the row-level security policies from the multi_tenancy
// migration apply to every query it runs. Run after migrations (pnpm
// db:migrate does). Needs DATABASE_URL (an owner login) and APP_DATABASE_URL
// in apps/api/.env. An optional argument names a different target database.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/api/package.json'));
const { Client } = require('pg');

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(join(root, 'apps/api/.env'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}

const owner = env('DATABASE_URL');
const app = env('APP_DATABASE_URL');
if (!owner || !app) {
  console.error('DATABASE_URL and APP_DATABASE_URL must both be set. Run `pnpm setup:env`.');
  process.exit(1);
}
const target = new URL(process.argv[2] ?? owner);
const login = new URL(app);
const user = decodeURIComponent(login.username);
const password = decodeURIComponent(login.password);
if (!/^[a-z_][a-z0-9_]*$/.test(user)) throw new Error(`Unexpected app user name: ${user}`);
if (user === decodeURIComponent(new URL(owner).username)) {
  throw new Error('APP_DATABASE_URL must use a different login from DATABASE_URL');
}
const db = target.pathname.slice(1).split('?')[0];
if (!/^[a-z0-9_]+$/i.test(db)) throw new Error(`Unexpected database name: ${db}`);

// Owner-only tables: the API never touches these through its company login.
const OWNER_ONLY = ['PlatformAdmin', 'PlatformSession', 'PlatformCode', '_prisma_migrations'];

const client = new Client({ connectionString: target.toString() });
await client.connect();
try {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
  const pw = password.replace(/'/g, "''");
  await client.query(
    exists.rowCount
      ? `ALTER ROLE ${user} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${pw}'`
      : `CREATE ROLE ${user} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${pw}'`,
  );
  await client.query(`GRANT CONNECT ON DATABASE "${db}" TO ${user}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${user}`,
  );
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${user}`);
  for (const table of OWNER_ONLY) {
    await client.query(`REVOKE ALL ON TABLE "${table}" FROM ${user}`).catch(() => undefined);
  }
  // Companies are created by the platform, never through a company login.
  await client.query(`REVOKE INSERT, DELETE ON TABLE "Company" FROM ${user}`);
  // A company may change its branding and webhook secret, nothing else about
  // itself: status, features, name and time zone are the platform's.
  await client.query(`REVOKE UPDATE ON TABLE "Company" FROM ${user}`);
  await client.query(
    `GRANT UPDATE ("brandName", "brandColor", "accentColor", "logoUrl", "defaultLanguage", ` +
      `"webhookTokenHash", "updatedAt") ON TABLE "Company" TO ${user}`,
  );
  // The reporting context: the API registers which company a reporting
  // connection is answering for (policies limit it to its own company).
  await client.query(`GRANT USAGE ON SCHEMA reporting_ctx TO ${user}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON reporting_ctx.session_company TO ${user}`,
  );
  console.log(`Company-scoped login ${user} is ready in ${db}.`);
} finally {
  await client.end();
}
