#!/usr/bin/env node
// Creates (or updates) the read-only login that "Ask your data" uses.
// It can read the views in the `reporting` schema and nothing else, and every
// session it opens is read-only. Run after migrations: `pnpm db:reporting-role`.
// Needs DATABASE_URL (an owner login) and REPORTING_DATABASE_URL in apps/api/.env.
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
const reporting = env('REPORTING_DATABASE_URL');
if (!owner || !reporting) {
  console.log('REPORTING_DATABASE_URL is not set; "Ask your data" stays off. Nothing to do.');
  process.exit(0);
}
const target = new URL(process.argv[2] ?? owner);
const login = new URL(reporting);
const user = decodeURIComponent(login.username);
const password = decodeURIComponent(login.password);
if (!/^[a-z_][a-z0-9_]*$/.test(user)) throw new Error(`Unexpected reporting user name: ${user}`);
const db = target.pathname.slice(1).split('?')[0];
if (!/^[a-z0-9_]+$/i.test(db)) throw new Error(`Unexpected database name: ${db}`);

const client = new Client({ connectionString: target.toString() });
await client.connect();
try {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
  const pw = password.replace(/'/g, "''");
  await client.query(
    exists.rowCount
      ? `ALTER ROLE ${user} LOGIN PASSWORD '${pw}'`
      : `CREATE ROLE ${user} LOGIN PASSWORD '${pw}'`,
  );
  await client.query(`ALTER ROLE ${user} SET default_transaction_read_only = on`);
  await client.query(`ALTER ROLE ${user} SET statement_timeout = '5s'`);
  await client.query(`ALTER ROLE ${user} SET search_path = reporting`);
  await client.query(`REVOKE ALL ON SCHEMA public FROM ${user}`);
  await client.query(`GRANT CONNECT ON DATABASE "${db}" TO ${user}`);
  await client.query(`GRANT USAGE ON SCHEMA reporting TO ${user}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO ${user}`);
  console.log(`Read-only login ${user} can read the reporting views in ${db}.`);
} finally {
  await client.end();
}
