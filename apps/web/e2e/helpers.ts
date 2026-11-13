import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import dotenv from 'dotenv';

// The seeded staff password lives in the API's .env (or the CI environment).
dotenv.config({ path: path.join(__dirname, '../../api/.env'), quiet: true });

export const PASSWORD = process.env.SEED_STAFF_PASSWORD ?? '';

export const STAFF = {
  manager: 'manager@koralend.test',
  officer: 'kevin@koralend.test',
  collections: 'collections@koralend.test',
};

/** Sign in with a seeded account and wait until the console has loaded. */
export async function signIn(page: Page, email: string): Promise<void> {
  expect(PASSWORD, 'SEED_STAFF_PASSWORD must be set').not.toBe('');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}
