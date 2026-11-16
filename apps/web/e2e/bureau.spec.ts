import { expect, test } from '@playwright/test';
import { signIn, STAFF } from './helpers';

test.describe('credit bureau', () => {
  test('a manager builds last month’s file and records that it was sent', async ({ page }) => {
    await signIn(page, STAFF.manager);
    await page.goto('/bureau');
    await expect(page.getByRole('heading', { name: 'Credit bureau' })).toBeVisible();
    await page.getByLabel('Your member code at the bureau').fill('KLDEMO');
    await page.getByRole('button', { name: 'Build file' }).click();
    await expect(page).toHaveURL(/\/bureau\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByText('Ready to send')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download file' })).toBeVisible();

    await page.getByLabel('Upload reference from the bureau').fill(`E2E-${Date.now()}`);
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await expect(page.locator('header').getByText('Sent', { exact: true })).toBeVisible();
    await expect(page.getByText('The bureau’s answer')).toBeVisible();
  });
});
