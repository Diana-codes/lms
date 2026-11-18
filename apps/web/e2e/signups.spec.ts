import { expect, test } from '@playwright/test';
import { signIn, STAFF } from './helpers';

/**
 * Customers who sign up in the borrower app arrive with no officer. The seed
 * has one, Grace Mukamana. The officer takes her on, so this changes data:
 * reseed (`pnpm db:seed`) before running it again.
 */
const NAME = 'Grace Mukamana';

test('an app sign-up waits under "No officer" until an officer takes them on', async ({ page }) => {
  await signIn(page, STAFF.officer);
  await page.goto('/borrowers');
  await page.getByRole('link', { name: 'No officer' }).click();
  await expect(page).toHaveURL(/unassigned=true/);
  const row = page.getByRole('row').filter({ hasText: NAME });
  await expect(row).toContainText('Signed up in the app');
  await expect(row).toContainText('Needs an officer');

  await row.getByRole('link', { name: NAME }).click();
  await expect(page.getByRole('heading', { name: NAME, level: 1 })).toBeVisible();
  await expect(page.getByText('Signed up in the app').first()).toBeVisible();
  // An officer cannot reassign customers; only take one with no officer.
  await expect(page.getByRole('button', { name: 'Change officer' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Take this customer' }).click();
  await expect(page.getByText('is now the relationship officer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take this customer' })).toHaveCount(0);
  await expect(page.getByText('Kevin N.').first()).toBeVisible();
});
