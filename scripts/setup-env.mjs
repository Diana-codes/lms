#!/usr/bin/env node
// Creates local .env files from the .env.example templates and fills in
// freshly generated secrets. Existing .env files are left untouched.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const secret = (bytes) => randomBytes(bytes).toString('base64');

const targets = [
  {
    dir: 'apps/api',
    file: '.env',
    fill: {
      JWT_ACCESS_SECRET: () => secret(48),
      PII_ENCRYPTION_KEY: () => secret(32),
      PII_HASH_KEY: () => secret(48),
      SEED_STAFF_PASSWORD: () => `Kora-${randomBytes(6).toString('base64url')}-dev`,
      WEBHOOK_TOKEN: () => randomBytes(24).toString('base64url'),
      REPORTING_DATABASE_URL: () =>
        `postgresql://kora_reporting:${randomBytes(18).toString('hex')}@localhost:5433/kora_lend`,
      APP_DATABASE_URL: () =>
        `postgresql://kora_app:${randomBytes(18).toString('hex')}@localhost:5433/kora_lend`,
    },
  },
  { dir: 'apps/web', file: '.env.local', fill: {} },
];

for (const { dir, file, fill } of targets) {
  const example = join(root, dir, '.env.example');
  const target = join(root, dir, file);
  if (existsSync(target)) {
    console.log(`kept     ${dir}/${file} (already exists)`);
    continue;
  }
  let text = readFileSync(example, 'utf8');
  for (const [key, make] of Object.entries(fill)) {
    text = text.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${make()}`);
  }
  writeFileSync(target, text, { mode: 0o600 });
  console.log(`created  ${dir}/${file}`);
}
console.log('\nThe seeded staff password is SEED_STAFF_PASSWORD in apps/api/.env.');
