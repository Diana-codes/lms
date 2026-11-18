import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Cookie, expect, type Page } from '@playwright/test';
import dotenv from 'dotenv';

// The seeded staff password lives in the API's .env (or the CI environment).
dotenv.config({ path: path.join(__dirname, '../../api/.env'), quiet: true });

export const PASSWORD = process.env.SEED_STAFF_PASSWORD ?? '';

/** Where the API's SMS simulator writes texts in development (SMS_OUTBOX_FILE). */
const OUTBOX = process.env.SMS_OUTBOX_FILE
  ? path.resolve(__dirname, '../../api', process.env.SMS_OUTBOX_FILE)
  : '';

export const STAFF = {
  manager: 'manager@bf.test',
  officer: 'kevin@bf.test',
  collections: 'collections@bf.test',
};

/** The code in the newest text the simulator sent after `since` (ms). */
async function textedCode(since: number): Promise<string> {
  expect(OUTBOX, 'SMS_OUTBOX_FILE must be set in apps/api/.env').not.toBe('');
  for (let tries = 0; tries < 50; tries++) {
    const lines = existsSync(OUTBOX) ? readFileSync(OUTBOX, 'utf8').trim().split('\n') : [];
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      const entry = JSON.parse(lines[i]!) as { at: number; message: string };
      if (entry.at < since) break;
      const code = /\b(\d{6})\b/.exec(entry.message)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('No sign-in code was texted');
}

/**
 * Session cookies per account, reused across tests: every real sign-in texts
 * a code, and codes are capped per person per hour.
 */
const sessions = new Map<string, Cookie[]>();

/** Sign in with a seeded account (password, then the texted code) and wait for the console. */
export async function signIn(page: Page, email: string): Promise<void> {
  expect(PASSWORD, 'SEED_STAFF_PASSWORD must be set').not.toBe('');
  const saved = sessions.get(email);
  if (saved) {
    await page.context().addCookies(saved);
    await page.goto('/');
    if (!new URL(page.url()).pathname.startsWith('/login')) return;
    // Signed out (or the session ended) since: sign in for real.
    sessions.delete(email);
    await page.context().clearCookies();
  }
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await submitPasswordAndMaybeCode(page);
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  const cookies = await page.context().cookies();
  sessions.set(
    email,
    cookies.filter((c) => c.name.startsWith('kl_')),
  );
}

/**
 * Press "Sign in" (password already filled). When the company has staff 2FA
 * on, enter the texted code; otherwise the console opens straight away.
 */
export async function submitPasswordAndMaybeCode(page: Page): Promise<void> {
  const since = Date.now() - 1000;
  await page.getByRole('button', { name: 'Sign in' }).click();
  const codeStep = page.getByRole('heading', { name: 'Enter your code' });
  try {
    await expect(codeStep).toBeVisible({ timeout: 2_000 });
  } catch {
    return;
  }
  await page.getByLabel('6-digit code').fill(await textedCode(since));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
}

/** @deprecated Use submitPasswordAndMaybeCode */
export const submitWithTextedCode = submitPasswordAndMaybeCode;
