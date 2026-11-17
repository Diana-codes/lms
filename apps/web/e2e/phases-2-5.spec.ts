import { expect, type Page, test } from '@playwright/test';
import { signIn, STAFF } from './helpers';

/**
 * Phases 2–5 in the browser, against the seeded database, the local MoMo and
 * SMS simulators and the scoring service. Claude is not configured here, so
 * the AI-written parts must say so clearly instead of breaking.
 */
const toast = (page: Page) => page.getByRole('status').filter({ hasText: /\S/ }).last();

test.describe('collections', () => {
  test('the queue shows the seeded arrears and an account can be worked', async ({ page }) => {
    await signIn(page, STAFF.collections);
    await page.getByRole('link', { name: /^Collections/ }).click();
    await expect(page.getByRole('heading', { name: 'Collections', level: 1 })).toBeVisible();
    const early = page.getByRole('region', { name: 'AI early warning' });
    await expect(early.getByText(/Early warning:/)).toBeVisible({ timeout: 15_000 });
    const metrics = page.getByRole('region', { name: 'Collection metrics' });
    await expect(metrics.getByText('121', { exact: true })).toBeVisible();

    const tabs = page.getByRole('tablist', { name: 'Days past due' });
    await tabs.getByRole('tab', { name: /^90\+ days/ }).click();
    await expect(tabs.getByRole('tab', { name: /^90\+ days/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('button', { name: /Emmanuel Mutabazi/ }).click();

    const panel = page.getByRole('complementary', { name: 'Selected account' });
    await expect(panel.getByText('LN-0377-2026 · +250 72• ••• 118')).toBeVisible();
    await expect(panel.getByText('Call — no answer', { exact: true })).toBeVisible();
    // Without Claude configured the AI box says so; nothing breaks.
    await expect(panel.getByText(/AI service is not configured/)).toBeVisible();

    await panel.getByRole('button', { name: 'Send SMS' }).click();
    await expect(panel.getByLabel(/SMS to \+250 72• ••• 118 · English/)).toHaveValue(
      /LN-0377-2026 is overdue/,
    );
    await panel.getByRole('button', { name: 'Send SMS' }).last().click();
    await expect(toast(page)).toContainText('SMS sent to Emmanuel Mutabazi');
    await expect(panel.getByText('SMS sent', { exact: true }).first()).toBeVisible();

    await panel.getByLabel('No answer').check();
    await panel.getByRole('button', { name: 'Save outcome' }).click();
    await expect(toast(page)).toContainText('Outcome saved for Emmanuel Mutabazi');
    await expect(panel.getByText(/^Call — no answer; retry/)).toBeVisible();
  });

  test('a MoMo request from the loan page is confirmed by the provider', async ({ page }) => {
    await signIn(page, STAFF.officer);
    await page.goto('/loans/LN-0418-2026');
    await page.getByRole('button', { name: 'Request via MoMo' }).click();
    await expect(toast(page)).toContainText('MoMo request for RWF 284,985 sent');
    const banner = page.getByRole('region', { name: 'MoMo request pending' });
    await expect(banner).toContainText('Waiting for the borrower to approve RWF 284,985');
    // The simulator settles after a moment; the page then shows the payment.
    await expect(async () => {
      await banner.getByRole('button', { name: 'Check now' }).click();
      await expect(page.getByText('7 of 18 paid · 0 late')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByText('Instalment 7 received via MoMo')).toBeVisible();
  });
});

test.describe('reports', () => {
  test('managers see the portfolio report and can export it', async ({ page }) => {
    await signIn(page, STAFF.manager);
    await page.getByRole('link', { name: /^Reports/ }).click();
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    const summary = page.getByRole('region', { name: 'Summary' });
    await expect(summary.getByText('RWF 2.48B')).toBeVisible();
    await expect(page.getByText('SME business loan', { exact: true })).toBeVisible();
    // 312 seeded loans, plus any an earlier test in the same run disbursed.
    await expect(page.getByRole('row').filter({ hasText: 'Kevin N.' })).toContainText(
      /Kevin N\.31\d/,
    );

    await page
      .getByRole('group', { name: 'Period' })
      .getByRole('button', { name: 'Quarter' })
      .click();
    await expect(page).toHaveURL(/period=Q$/);
    await expect(page.getByText(/^Last 3 months · all branches/)).toBeVisible();

    const download = page.waitForEvent('download');
    await page.locator('header').getByRole('link', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('kora-lend-report-Q.csv');

    await page.getByRole('link', { name: 'Print or PDF' }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio report' })).toBeVisible();
  });

  test('Ask your data explains that it is switched off when Claude is not configured', async ({
    page,
  }) => {
    await signIn(page, STAFF.manager);
    await page.goto('/reports');
    const ask = page.getByRole('region', { name: 'Ask your data' });
    await expect(ask.getByLabel('Ask your data')).toBeDisabled();
    await expect(ask.getByLabel('Ask your data')).toHaveAttribute('placeholder', /not configured/);
    await expect(page.getByRole('heading', { name: 'Score fairness check' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('officers are told reports are for managers', async ({ page }) => {
    await signIn(page, STAFF.officer);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports are for managers' })).toBeVisible();
  });
});

test.describe('scoring in the pipeline', () => {
  test('a new application is scored by the rules service, and can be scored again', async ({
    page,
  }) => {
    await signIn(page, STAFF.officer);
    await page.goto('/applications?new=1');
    const dialog = page.getByRole('dialog');
    const name = `Scored Applicant ${Date.now().toString().slice(-6)}`;
    await dialog.getByLabel('Applicant or business name').fill(name);
    await dialog.getByLabel('Amount (RWF)').fill('700000');
    await dialog.getByLabel('Phone (for MoMo)').fill(`078${Date.now().toString().slice(-7)}`);
    await dialog.getByRole('button', { name: 'Create application' }).click();
    await expect(toast(page)).toContainText(`created for ${name}`);

    const card = page.getByRole('article').filter({ hasText: name });
    await expect(card).toContainText('Review · thin credit file');
    await expect(card).toContainText(/Score \d{3}/);
    await card.getByRole('button', { name }).click();
    await expect(page.getByRole('dialog').getByText('rules-v1')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Score again' }).click();
    await expect(toast(page)).toContainText('scored again');
  });

  test('approving a flagged application asks for a reason', async ({ page }) => {
    await signIn(page, STAFF.manager);
    await page.goto('/applications?open=APP-20914');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Flag · income mismatch')).toBeVisible();
    await dialog.getByRole('button', { name: /^Approve/ }).click();
    await expect(dialog.getByLabel('Why are you approving a flagged application?')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Approve with this reason' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(dialog.getByLabel('Why are you approving a flagged application?')).toHaveCount(0);
  });
});

test.describe('borrower profile extras', () => {
  test('messaging works, and the top-up offer goes to the app', async ({ page }) => {
    await signIn(page, STAFF.officer);
    await page.goto('/borrowers/BR-00731');
    await page.getByRole('button', { name: 'Message' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Message')
      .fill('Hello Aline, your new sewing machines look great.');
    await page.getByRole('dialog').getByRole('button', { name: 'Send SMS' }).click();
    await expect(toast(page)).toContainText('SMS sent to Aline Uwase');
    await page.getByRole('button', { name: 'Offer top-up' }).click();
    await expect(toast(page)).toContainText(
      /Top-up offer of up to RWF 6,000,000 sent|already open/,
    );
  });
});
