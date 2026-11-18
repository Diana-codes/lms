import { expect, test } from '@playwright/test';
import { PASSWORD, signIn, STAFF, submitWithTextedCode } from './helpers';

test.describe('signing in', () => {
  test('sends signed-out visitors to the sign-in page, then back where they were going', async ({
    page,
  }) => {
    await page.goto('/kit');
    await expect(page).toHaveURL(/\/login\?next=%2Fkit$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(STAFF.manager);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText(
      'Email or password is incorrect',
    );
    await expect(page).toHaveURL(/\/login/);

    // Signing in from here (password, then the texted code) lands on the page they first asked for.
    await page.getByLabel('Password').fill(PASSWORD);
    await submitWithTextedCode(page);
    await expect(page).toHaveURL(/\/kit$/);
    await expect(page.getByRole('heading', { name: 'UI kit', level: 1 })).toBeVisible();
  });

  test('never redirects to another site after sign-in', async ({ page }) => {
    await signIn(page, STAFF.manager);
    await expect(page).toHaveURL('/');
    await page.goto('/login?next=//evil.example');
    await expect(page).toHaveURL('/');
    await page.goto('/login?next=https://evil.example');
    await expect(page).toHaveURL('/');
  });

  test('keeps session tokens out of reach of page scripts', async ({ page, context }) => {
    await signIn(page, STAFF.manager);
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    const cookies = await context.cookies();
    const session = cookies.filter((c) => c.name.startsWith('kl_'));
    expect(session.map((c) => c.name).sort()).toEqual(['kl_access', 'kl_refresh']);
    for (const cookie of session) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe('Lax');
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain('kl_');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe('{}');
  });

  test('renews an expired access token without another sign-in', async ({ page, context }) => {
    await signIn(page, STAFF.manager);
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await context.clearCookies({ name: 'kl_access' });
    await page.goto('/kit');
    await expect(page.getByRole('heading', { name: 'UI kit', level: 1 })).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === 'kl_access')).toBe(true);
  });

  test('signs out', async ({ page }) => {
    await signIn(page, STAFF.manager);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('console shell', () => {
  test('a manager sees the whole seeded portfolio, read from the ledger', async ({ page }) => {
    await signIn(page, STAFF.manager);
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    const metrics = page.getByRole('region', { name: 'Key metrics' });
    await expect(metrics.getByText('RWF 2.48B')).toBeVisible();
    await expect(page.getByRole('link', { name: /^Current/ })).toContainText(/1,0\d\d/);
    await expect(page.getByText('Claire Mutesi')).toBeVisible();
    await expect(page.getByText('Manager', { exact: true })).toBeVisible();
  });

  test('an officer sees their own book, not the whole portfolio', async ({ page }) => {
    await signIn(page, STAFF.officer);
    await expect(page.getByRole('heading', { name: 'My portfolio' })).toBeVisible();
    await expect(page.getByText('RWF 2.48B')).toHaveCount(0);
    expect((await page.request.get('/api/users')).status()).toBe(403);
    expect((await page.request.get('/api/system/stats')).status()).toBe(403);
  });

  test('the sidebar reaches every section and marks the current one', async ({ page }) => {
    await signIn(page, STAFF.manager);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const section of ['Applications', 'Loans', 'Borrowers', 'Collections', 'Reports']) {
      // The Applications link also carries a count, so match on the start of the name.
      const link = nav.getByRole('link', { name: new RegExp(`^${section}`) });
      await link.click();
      await expect(page.getByRole('heading', { name: section, level: 1 })).toBeVisible();
      await expect(link).toHaveAttribute('aria-current', 'page');
    }
    await expect(nav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('the UI kit renders and its controls respond', async ({ page }) => {
    await signIn(page, STAFF.manager);
    await page.goto('/kit');
    await expect(page.getByRole('heading', { name: 'UI kit', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Show a toast' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Reminder SMS sent to 4 borrowers due this week.',
    );

    const range = page.getByRole('group', { name: 'Range' });
    await range.getByRole('button', { name: '3M' }).click();
    await expect(range.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
    await expect(range.getByRole('button', { name: '12M' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await page.getByLabel('Amount (RWF)').fill('4500000.50');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Enter a whole amount in RWF',
    );

    await expect(page.getByRole('cell', { name: 'RWF 12,000,000' })).toHaveCSS(
      'text-align',
      'right',
    );
  });

  // The seeded company is Bridge to Finance: its brand colour and accent come from company settings.
  test('uses the brand fonts and colours', async ({ page }) => {
    await signIn(page, STAFF.manager);
    const heading = page.getByRole('heading', { name: 'Portfolio overview' });
    await expect(heading).toHaveCSS('font-family', /Space Grotesk/);
    await expect(page.locator('body')).toHaveCSS('font-family', /Inter/);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 245, 241)');
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCSS(
      'background-color',
      'rgb(23, 60, 46)',
    );
    await expect(page.getByRole('link', { name: 'Overview' })).toHaveCSS(
      'background-color',
      'rgb(162, 232, 184)',
    );
  });

  test('signed in by text, staff can move to an authenticator app', async ({ page }) => {
    await signIn(page, STAFF.collections);
    await page.getByRole('link', { name: 'Security' }).click();
    await expect(page.getByText('Text message', { exact: true })).toBeVisible();
    await expect(page.getByText(/we text a 6-digit code to \+250 78• ••• \d{3}/)).toBeVisible();
    await page.getByRole('button', { name: 'Use an authenticator app instead' }).click();
    await page.getByRole('button', { name: 'Show the QR code' }).click();
    await expect(
      page.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on' })).toBeDisabled();
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText('That code is not valid');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.getByRole('button', { name: 'Use an authenticator app instead' }),
    ).toBeVisible();
  });
});
