import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../api/.env'), quiet: true });

const OUTBOX = process.env.SMS_OUTBOX_FILE
  ? path.resolve(__dirname, '../../api', process.env.SMS_OUTBOX_FILE)
  : '';

/** Newest 6-digit code written to the SMS outbox after `since` (ms). */
export async function textedCodeForPhone(since: number, waitMs = 8_000): Promise<string> {
  expect(OUTBOX, 'SMS_OUTBOX_FILE must be set in apps/api/.env').not.toBe('');
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
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
  throw new Error('No borrower sign-in code was texted');
}
