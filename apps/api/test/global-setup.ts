import 'dotenv/config';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { ML_TEST_PORT, testDatabaseUrl } from './test-db';

let ml: ChildProcess | null = null;

/**
 * Before the end-to-end tests: create the test database if needed, bring its
 * schema up to date, give it a read-only reporting login, and start the real
 * scoring service (services/ml) on a spare port.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set. Run `pnpm setup:env` first.');
  const testUrl = testDatabaseUrl(base);
  const name = new URL(testUrl).pathname.slice(1);
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unexpected test database name: ${name}`);

  const admin = new Client({ connectionString: base });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
  if (process.env.REPORTING_DATABASE_URL) {
    execFileSync(
      'node',
      [path.resolve(__dirname, '../../../scripts/reporting-role.mjs'), testUrl],
      { stdio: 'pipe' },
    );
  }

  const mlDir = path.resolve(__dirname, '../../../services/ml');
  const python = path.join(mlDir, '.venv/bin/python');
  if (!existsSync(python)) {
    throw new Error(
      "The scoring service's environment is missing. Run: cd services/ml && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'",
    );
  }
  ml = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--port', String(ML_TEST_PORT), '--log-level', 'warning'],
    { cwd: mlDir, stdio: 'ignore' },
  );
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${ML_TEST_PORT}/health`)).ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return async () => {
    ml?.kill();
  };
}
