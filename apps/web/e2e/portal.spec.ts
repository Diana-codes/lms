import { expect, test } from '@playwright/test';
import { signIn, STAFF } from './helpers';

function dialog(page: import('@playwright/test').Page) {
  return page.getByRole('dialog');
}

test.describe('borrower portal', () => {
  test('opens without staff session and signs a borrower in with phone only', async ({
    browser,
    page,
  }) => {
    const phone = `078${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
    const applicant = `Portal E2E ${phone.slice(-4)}`;

    await signIn(page, STAFF.officer);
    await page.goto('/applications');
    await page.getByRole('button', { name: 'New application' }).click();
    await dialog(page).getByLabel('Applicant or business name').fill(applicant);
    await dialog(page).getByLabel('Product').selectOption({ index: 0 });
    await dialog(page).getByLabel('Amount (RWF)').fill('500000');
    await dialog(page).getByLabel('Phone (for MoMo)').fill(phone);
    await dialog(page).getByRole('button', { name: 'Create application' }).click();
    await expect(page.getByText(`created for ${applicant}`)).toBeVisible({ timeout: 15_000 });

    const borrowerCtx = await browser.newContext();
    const portal = await borrowerCtx.newPage();
    await portal.goto('/portal/login');
    await expect(portal.getByRole('heading', { name: 'Sign in with your phone' })).toBeVisible();
    await expect(portal.getByText('Staff access only')).toHaveCount(0);

    // Demo company has borrower OTP off by default: phone alone is enough.
    await portal.getByLabel('Phone number').fill(phone);
    await portal.getByRole('button', { name: 'Continue' }).click();
    await expect(portal).toHaveURL(/\/portal\/home/, { timeout: 15_000 });
    await expect(portal.getByText(/Muraho/i)).toBeVisible();

    // Switching to Kinyarwanda saves it on the account and changes the screens.
    await portal.getByRole('link', { name: 'Profile' }).click();
    await portal.getByRole('button', { name: 'Ikinyarwanda' }).click();
    await expect(portal.getByText('Ururimi rwabitswe.')).toBeVisible();
    await expect(portal.getByRole('heading', { name: 'Konti yanjye' })).toBeVisible();
    await portal.getByRole('link', { name: 'Ahabanza' }).click();
    await expect(portal.getByRole('link', { name: 'Ubutumwa' }).first()).toBeVisible();

    // The sign-in page offers the switch before anyone signs in.
    const again = await browser.newContext();
    const second = await again.newPage();
    await second.goto('/portal/login');
    await second.getByRole('button', { name: 'Ikinyarwanda' }).click();
    await expect(
      second.getByRole('heading', { name: 'Injira ukoresheje telefone yawe' }),
    ).toBeVisible();
    await again.close();

    await borrowerCtx.close();
  });
});
