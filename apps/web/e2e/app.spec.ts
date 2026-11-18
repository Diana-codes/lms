import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { textedCodeForPhone } from './portal-helpers';

/**
 * The customer app in the browser (/app): the same app as on phones. A new
 * customer comes from the website's Apply button, signs up, sends their
 * documents, applies for the product they picked and waits for a decision.
 * Needs `pnpm build` (it exports the app into apps/web/public/app).
 */
const PHOTO = path.join(__dirname, 'fixtures/photo.jpg');
const PDF = path.join(__dirname, 'fixtures/document.pdf');

async function send(page: Page, document: string, option: string, file: string) {
  await page.getByText(document, { exact: true }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(option, { exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(
    page.getByText(document, { exact: true }).first().locator('xpath=../..'),
  ).toContainText('Being checked', { timeout: 15_000 });
}

test.use({ viewport: { width: 412, height: 915 } });
test.setTimeout(120_000);

test('a new customer signs up, sends documents and applies, from the website link', async ({
  page,
}) => {
  const phone = `078${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
  await page.goto('/portal?lang=en&product=SME-WC');
  // Old /portal links open the app.
  await expect(page).toHaveURL(/\/app\?lang=en&product=SME-WC$/);
  await expect(page.getByText('Muraho! Sign in or sign up')).toBeVisible();
  await expect(page.getByText('Kora')).toHaveCount(0);

  const since = Date.now() - 1000;
  await page.getByLabel('Phone number').fill(phone.slice(1));
  await page.getByText('Send me a code').click();
  await page.getByLabel('6-digit code').fill(await textedCodeForPhone(since));
  const signIn = page.getByText('Sign in', { exact: true });
  if (await signIn.isVisible()) await signIn.click();

  await expect(page.getByText('Murakaza neza! Tell us about you')).toBeVisible();
  await page.getByLabel('Full name').fill(`App E2E ${phone.slice(-4)}`);
  await page
    .getByLabel('National ID number, 16 digits')
    .fill(`1199080${String(Math.floor(100_000_000 + Math.random() * 899_999_999))}`);
  await page.getByLabel('Business name, optional').fill('E2E Shop');
  await page.getByLabel(/^Sector/).click();
  await page.getByText('Retail shop', { exact: true }).click();
  await page.getByLabel(/^Branch/).click();
  await page.getByRole('radio').first().click();
  const boxes = page.getByRole('checkbox');
  await boxes.nth(0).click({ force: true });
  await boxes.nth(1).click({ force: true });
  await page.getByText('Create my account').click();

  // Documents everyone needs, then the loan.
  await expect(page.getByText('To keep your account verified')).toBeVisible();
  await send(page, 'National ID', 'Choose a photo', PHOTO);
  await send(page, 'Selfie', 'Take a selfie', PHOTO);
  await page.getByText('Next: choose your loan').click();

  // The product picked on the website is already chosen.
  await expect(page.getByText('Step 1 of 4 · Loan details')).toBeVisible();
  await expect(page.getByLabel(/^Type of loan/)).toContainText('SME business loan');
  await page.getByText('Continue', { exact: true }).click();
  await expect(page.getByText('Step 2 of 4 · Your details')).toBeVisible();
  const revenue = page.getByLabel('Average monthly revenue in Rwandan francs');
  if ((await revenue.inputValue()) === '') await revenue.fill('1500000');
  await page.getByText('Continue to documents').click();

  // What this product needs, before the application exists.
  await expect(page.getByText('What SME business loan needs')).toBeVisible();
  await send(page, 'Business registration (RDB)', 'Choose a PDF', PDF);
  await send(page, 'Bank & MoMo statements', 'Choose a PDF', PDF);
  await expect(page.getByText('You are all set')).toBeVisible();
  await page.getByText('Review application').click();

  await expect(page.getByText('Step 4 of 4 · Review & submit')).toBeVisible();
  await expect(page.getByText('Annual percentage rate (APR), including fees')).toBeVisible();
  const consent = page.getByRole('checkbox', { name: /agree to the loan agreement/ });
  await consent.click({ position: { x: 12, y: 12 } });
  await expect(page.getByRole('button', { name: 'Submit application' })).toBeEnabled();
  await page
    .getByText(/^Submit/)
    .last()
    .click();
  await expect(page.getByText('Application sent')).toBeVisible();
  await expect(page.getByText(/APP-\d+/)).toBeVisible();
});
