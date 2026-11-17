import { expect, type Page, test } from '@playwright/test';
import { signIn, STAFF } from './helpers';

/**
 * Phase 1: the lending flow in the browser, against the seeded database.
 * The main journey creates its own application so it can run repeatedly.
 */
const stamp = Date.now().toString().slice(-7);
const applicant = `Playwright Test ${stamp}`;
const phone = `078${stamp}`;

const dialog = (page: Page) => page.getByRole('dialog');
const toast = (page: Page) => page.getByRole('status').filter({ hasText: /\S/ }).last();
const signOut = async (page: Page) => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
};

test.describe.configure({ mode: 'serial' });

test.describe('from application to repayment', () => {
  let loanCode = '';

  test('an officer creates, reviews and approves an application', async ({ page }) => {
    await signIn(page, STAFF.officer);
    await page.getByRole('link', { name: /^Applications/ }).click();
    await page.getByRole('button', { name: 'New application' }).click();

    // The form explains what is missing instead of failing silently.
    await dialog(page).getByRole('button', { name: 'Create application' }).click();
    await expect(dialog(page).getByText('Add the applicant’s name')).toBeVisible();
    await expect(dialog(page).getByText('Add an amount')).toBeVisible();

    await dialog(page).getByLabel('Applicant or business name').fill(applicant);
    await dialog(page).getByLabel('Product').selectOption({ label: 'Personal loan' });
    await dialog(page).getByLabel('Amount (RWF)').fill('900000');
    await expect(dialog(page).getByLabel('Amount (RWF)')).toHaveValue('900,000');
    await dialog(page).getByLabel('Phone (for MoMo)').fill(phone);
    await dialog(page).getByRole('button', { name: 'Create application' }).click();
    await expect(toast(page)).toContainText(`created for ${applicant}`);

    const column = (name: string) => page.getByRole('region', { name, exact: true });
    await expect(column('New').getByRole('button', { name: applicant })).toBeVisible();

    await column('New').getByRole('button', { name: applicant }).click();
    await expect(dialog(page).getByText('RWF 900,000')).toBeVisible();
    // Scored by the rules service as soon as it is created.
    await expect(dialog(page).getByText('Review · thin credit file')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Start review' }).click();
    await expect(dialog(page).getByText('Under review', { exact: true })).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(toast(page)).toContainText('approved');
    // Officers approve; they do not release money.
    await expect(dialog(page).getByText('A manager records the disbursement.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(column('Approved').getByRole('button', { name: applicant })).toBeVisible();
    await signOut(page);
  });

  test('a manager disburses it, which creates the loan and its schedule', async ({ page }) => {
    await signIn(page, STAFF.manager);
    await page.goto('/applications');
    await page.getByRole('button', { name: applicant }).click();
    await dialog(page).getByRole('button', { name: 'Record disbursement' }).click();
    await dialog(page).getByRole('button', { name: 'Bank transfer' }).click();
    await dialog(page).getByLabel('Collateral (optional)').fill('Salary assignment');
    await dialog(page).getByRole('button', { name: 'Confirm disbursement' }).click();
    await expect(toast(page)).toContainText(/Loan LN-\d{4}-\d{4} created and disbursed/);

    const link = dialog(page).getByRole('link', { name: /Open loan LN-/ });
    loanCode = (await link.textContent())!.replace('Open loan ', '').trim();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/loans/${loanCode}$`));
    await expect(page.getByRole('heading', { name: applicant, level: 1 })).toBeVisible();
    await expect(page.getByText('Active · on track')).toBeVisible();
    await expect(page.getByText('0 of 12 paid · 0 late')).toBeVisible();
    await expect(page.getByText('Salary assignment')).toBeVisible();
    await expect(page.getByText('Bank transfer', { exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Due next' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Show all 12 instalments' }).click();
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(13);
    // The last instalment clears the balance exactly.
    await expect(
      page.getByRole('table').getByRole('row').last().getByRole('cell').nth(5),
    ).toHaveText('0');
  });

  test('recording a payment clears the instalment and shows on the statement', async ({ page }) => {
    await signIn(page, STAFF.officer);
    await page.goto(`/loans/${loanCode}`);
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog(page).getByText('This clears instalment 1 in full.')).toBeVisible();

    const amount = dialog(page).getByLabel('Amount received (RWF)');
    const full = await amount.inputValue();
    await amount.fill('99999999');
    await expect(dialog(page).getByRole('alert')).toContainText('More than the');
    await expect(dialog(page).getByRole('button', { name: 'Save payment' })).toBeDisabled();
    await amount.fill('10000');
    await expect(dialog(page).getByText(/part-payment/)).toBeVisible();
    await amount.fill(full);

    await dialog(page).getByRole('button', { name: 'Cash at branch' }).click();
    await dialog(page).getByLabel('Transaction ID').fill(`RCPT-${stamp}`);
    await dialog(page).getByRole('button', { name: 'Save payment' }).click();
    await expect(toast(page)).toContainText(`Payment of RWF ${full} recorded.`);

    await expect(page.getByText('1 of 12 paid · 0 late')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Paid' })).toHaveCount(1);
    await expect(page.getByText('Instalment 1 recorded by Kevin N. (cash)')).toBeVisible();
    await expect(page.getByText(`RWF ${full}`).first()).toBeVisible();

    await page.getByRole('link', { name: 'Statement' }).click();
    await expect(page.getByRole('heading', { name: 'Loan statement' })).toBeVisible();
    const paid = page.getByRole('row').filter({ hasText: `RCPT-${stamp}` });
    await expect(paid).toContainText('Cash at branch');
    await expect(paid).toContainText(full);
  });

  test('a restructure waits for a manager, then rebuilds the schedule', async ({ page }) => {
    await signIn(page, STAFF.officer);
    await page.goto(`/loans/${loanCode}`);
    await page.getByRole('button', { name: 'Restructure' }).click();
    await expect(dialog(page).getByText('11 instalments left')).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Send for approval' })).toBeDisabled();

    // Switching option changes the quoted instalment.
    const quoted = dialog(page).getByText('New instalment').locator('..');
    const extended = await quoted.textContent();
    await dialog(page)
      .getByRole('button', { name: /One-month payment holiday/ })
      .click();
    await expect(quoted).not.toHaveText(extended!);
    await dialog(page)
      .getByRole('button', { name: /Extend the term/ })
      .click();
    await dialog(page).getByRole('button', { name: '23 months' }).click();
    await dialog(page).getByLabel('Reason').fill('Slow season, orders pick up in January');
    await dialog(page).getByRole('button', { name: 'Send for approval' }).click();
    await expect(toast(page)).toContainText('Restructure request sent for approval.');

    const banner = page.getByRole('region', { name: 'Restructure awaiting approval' });
    await expect(banner).toContainText('extend to 23 months');
    await expect(banner).toContainText('Someone else must approve your request.');
    await expect(page.getByRole('button', { name: 'Restructure' })).toBeDisabled();
    await signOut(page);

    await signIn(page, STAFF.manager);
    await page.goto(`/loans/${loanCode}`);
    await page.getByRole('button', { name: 'Approve restructure' }).click();
    await expect(toast(page)).toContainText('Restructure approved');
    await expect(page.getByRole('region', { name: 'Restructure awaiting approval' })).toHaveCount(
      0,
    );
    await expect(page.getByText('1 of 24 paid · 0 late')).toBeVisible();
    await expect(page.getByText('Restructure approved', { exact: true })).toBeVisible();
  });

  test('the borrower profile reflects the loan, and takes a note', async ({ page }) => {
    await signIn(page, STAFF.officer);
    await page.goto(`/borrowers?q=${encodeURIComponent(applicant)}`);
    await expect(page.getByText('1 borrower', { exact: true }).first()).toBeVisible();
    await page.getByRole('link', { name: applicant }).click();
    await expect(page.getByRole('heading', { name: applicant, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: loanCode })).toBeVisible();
    await expect(page.getByText('1 instalment paid across 1 loan · never late')).toBeVisible();
    // The phone number is masked, here and in the page source.
    await expect(page.getByText(/^\+250 78• ••• \d{3}$/)).toBeVisible();
    expect(await page.content()).not.toContain(phone.slice(1));

    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Write something first.');
    await page
      .getByLabel('Add a note')
      .fill('Met at the branch. Prefers reminders in Kinyarwanda.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(toast(page)).toContainText('Note saved.');
    await expect(
      page.getByText('Met at the branch. Prefers reminders in Kinyarwanda.'),
    ).toBeVisible();
    await expect(page.getByLabel('Add a note')).toHaveValue('');
  });
});

test.describe('the seeded screens', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, STAFF.manager);
  });

  test('pipeline filters, the flagged review and the list view', async ({ page }) => {
    await page.goto('/applications');
    await expect(page.getByRole('region', { name: 'AI pre-screening' })).toContainText(
      'an officer makes every decision',
    );
    const cards = page.getByRole('article');
    const all = await cards.count();
    expect(all).toBeGreaterThanOrEqual(24);

    await page.getByRole('button', { name: 'Asset finance', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Asset finance', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(cards).toHaveCount(3);
    await expect(page.getByText(/Showing 3 applications · RWF 23\.8M/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(cards).toHaveCount(all);

    await page.getByRole('button', { name: 'Review 1 flagged' }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Bosco Hakizimana');
    await expect(cards.first()).toContainText('Flag · income mismatch');

    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('cell', { name: 'RWF 7,800,000' })).toHaveCSS(
      'text-align',
      'right',
    );

    await page.getByRole('button', { name: 'Assigned to me' }).click();
    await expect(page.getByText('No applications match these filters.')).toBeVisible();
  });

  test('a notification link opens the application it is about', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByRole('link', { name: /AI flagged APP-20914/ }).click();
    await expect(dialog(page).getByRole('heading', { name: 'Bosco Hakizimana' })).toBeVisible();
    await expect(dialog(page).getByText('Flag · income mismatch')).toBeVisible();
    await expect(dialog(page).getByText('Advice only. The decision is yours.')).toBeVisible();
    // The dialog closes on Escape and gives focus back to the page.
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('the loan detail matches the design for LN-0418-2026', async ({ page }) => {
    await page.goto('/loans/LN-0418-2026');
    await expect(page.getByRole('heading', { name: 'Aline Uwase', level: 1 })).toBeVisible();
    await expect(page.getByText('RWF 3,124,680').first()).toBeVisible();
    await expect(page.getByText('RWF 284,985').first()).toBeVisible();
    await expect(page.getByText('6 of 18 paid · 0 late')).toBeVisible();
    await expect(page.getByRole('img', { name: '31 percent of principal repaid' })).toBeVisible();
    const first = page.getByRole('table').getByRole('row').nth(1);
    await expect(first).toContainText('221,235');
    await expect(first).toContainText('63,750');
    await expect(first).toContainText('4,278,765');
    await expect(page.getByText('742 · Good')).toBeVisible();
    await expect(page.getByText('+250 78• ••• 412')).toBeVisible();
    await expect(page.getByText('Equipment lien')).toBeVisible();
  });

  test('the borrower profile matches the design for BR-00731', async ({ page }) => {
    await page.goto('/borrowers/BR-00731');
    await expect(
      page.getByText('Owner, Uwase Tailoring · Kimironko, Gasabo · Customer since Feb 2024'),
    ).toBeVisible();
    for (const tag of ['KYC verified', 'Repeat borrower', 'Low risk']) {
      await expect(page.getByText(tag, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('+18 in 6 months')).toBeVisible();
    await expect(page.getByText('RWF 7.3M')).toBeVisible();
    await expect(page.getByText('RWF 3.12M')).toBeVisible();
    await expect(page.getByText('Repaid early')).toBeVisible();
    const ai = page.getByRole('region', { name: 'AI summary' });
    await expect(ai).toContainText('Low risk, and improving.');
    await expect(ai).toContainText('Why: 24 on-time payments');
    await expect(ai).toHaveCSS('background-color', 'rgb(241, 237, 251)');
    await expect(page.getByText(/Visited the shop on 28 Oct/)).toBeVisible();
  });

  test('loans can be filtered by lateness and found by search', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /^90\+ days late/ }).click();
    await expect(page).toHaveURL(/\/loans\?bucket=DPD_90_PLUS$/);
    await expect(page.getByText(/^12 loans ·/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'LN-0377-2026' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'LN-0377-2026' })).toContainText(
      /10\d days late/,
    );

    await page.getByRole('searchbox').fill('Aline Uwase');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No loans match these filters')).toBeVisible();
    await page.getByRole('link', { name: 'All loans' }).click();
    await expect(page.getByRole('link', { name: 'LN-0418-2026' })).toBeVisible();

    await page.goto('/loans/LN-0000-1999');
    await expect(page.getByRole('heading', { name: 'No loan with that number' })).toBeVisible();
  });

  test('header search finds borrowers and loans', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: 'Search loans and borrowers' }).fill('Kalisa');
    await page
      .getByRole('link', { name: /Kalisa Trading Ltd/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Kalisa Trading Ltd', level: 1 })).toBeVisible();
  });

  test('the overview chart switches range', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('img', { name: /Monthly disbursed and collected amounts, Dec to Nov/ }),
    ).toBeVisible();
    await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: '3M' }).click();
    await expect(
      page.getByRole('img', { name: /Monthly disbursed and collected amounts, Sep to Nov/ }),
    ).toBeVisible();
  });
});
