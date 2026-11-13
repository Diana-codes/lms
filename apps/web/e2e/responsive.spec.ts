import { expect, test } from '@playwright/test';
import { signIn, STAFF } from './helpers';

/** Runs at desktop and phone widths (see the projects in playwright.config.ts). */
test('pages fit the screen and controls are big enough to tap', async ({ page }) => {
  await signIn(page, STAFF.manager);

  for (const path of [
    '/',
    '/kit',
    '/applications',
    '/loans',
    '/loans/LN-0418-2026',
    '/loans/LN-0418-2026/statement',
    '/borrowers',
    '/borrowers/BR-00731',
    '/collections',
    '/reports',
    '/reports/print',
    '/settings/security',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    // No sideways scrolling of the page itself (wide tables scroll inside their own box).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);

    // Buttons and nav links meet the 44px touch-target rule.
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'nav a, nav button, main button, main a[class*="h-11"]',
        ),
      ]
        // A pipeline card's button covers the whole card through its ::after.
        .filter(
          (el) =>
            el.offsetParent !== null &&
            !el.closest('[role="group"]') &&
            !el.className.includes('after:absolute'),
        )
        .filter((el) => el.getBoundingClientRect().height < 44)
        .map(
          (el) =>
            `${el.tagName} "${el.textContent?.trim()}" ${el.getBoundingClientRect().height}px`,
        ),
    );
    expect(small, `${path} has undersized controls`).toEqual([]);
  }
});

test('the sign-in page fits the screen', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
