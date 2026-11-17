import { expect, type Page, test } from '@playwright/test';
import { signIn, STAFF } from './helpers';

/**
 * KYC documents on the borrower profile. The seed gives Moses Tuyisenge
 * (APP-20934) an ID photo and an RDB certificate waiting for review, with
 * real sample files. These tests look but don't decide, so they can run
 * again and again on the same data; the API tests cover verify and reject.
 */
const NAME = 'Moses Tuyisenge';

async function openMoses(page: Page) {
  await page.goto(`/borrowers?q=${encodeURIComponent(NAME)}`);
  await page.getByRole('link', { name: NAME }).click();
  await expect(page.getByRole('heading', { name: NAME, level: 1 })).toBeVisible();
  return page.getByRole('list', { name: 'KYC documents' });
}

test.describe('KYC documents', () => {
  test('an officer can open a document and is asked for a reason before rejecting', async ({
    page,
  }) => {
    await signIn(page, STAFF.officer);
    const docs = await openMoses(page);
    const rdb = docs.getByRole('listitem').filter({ hasText: 'Business registration (RDB)' });
    await expect(rdb).toContainText('Pending');
    await expect(rdb).toContainText('PDF');

    // The file opens in a new tab, served straight from the API.
    const view = rdb.getByRole('link', { name: /View Business registration \(RDB\) \(PDF/ });
    const href = await view.getAttribute('href');
    expect(href).toMatch(/^\/api\/borrowers\/BR-\d+\/documents\/[\w-]+\/file$/);
    expect(await view.getAttribute('target')).toBe('_blank');
    const file = await page.request.get(href!);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toBe('application/pdf');
    expect(file.headers()['cache-control']).toBe('no-store');
    expect((await file.body()).subarray(0, 5).toString()).toBe('%PDF-');

    const id = docs.getByRole('listitem').filter({ hasText: 'National ID' });
    const photo = await page.request.get(
      (await id.getByRole('link', { name: /View National ID/ }).getAttribute('href'))!,
    );
    expect(photo.headers()['content-type']).toBe('image/png');

    // Rejecting needs a reason the borrower will read.
    await rdb.getByRole('button', { name: 'Ask for a new Business registration (RDB)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask for a new Business registration (RDB)' });
    await expect(dialog.getByRole('button', { name: 'Send request' })).toBeDisabled();
    await dialog.getByRole('button', { name: /Part of the document is cut off/ }).click();
    await expect(dialog.getByRole('button', { name: 'Send request' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Something else' }).click();
    await expect(dialog.getByRole('button', { name: 'Send request' })).toBeDisabled();
    await dialog.getByLabel('Tell the borrower what to fix').fill('Please send the whole page.');
    await expect(dialog.getByRole('button', { name: 'Send request' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rdb).toContainText('Pending');
  });

  test('a rejection made by mistake can be undone, and the document is pending again', async ({
    page,
  }) => {
    await signIn(page, STAFF.officer);
    const docs = await openMoses(page);
    const rdb = docs.getByRole('listitem').filter({ hasText: 'Business registration (RDB)' });
    await rdb.getByRole('button', { name: 'Ask for a new Business registration (RDB)' }).click();
    const ask = page.getByRole('dialog', { name: 'Ask for a new Business registration (RDB)' });
    await ask.getByRole('button', { name: /Part of the document is cut off/ }).click();
    await ask.getByRole('button', { name: 'Send request' }).click();
    await expect(rdb).toContainText('Rejected');

    await rdb
      .getByRole('button', { name: 'Undo the review of Business registration (RDB)' })
      .click();
    const undo = page.getByRole('dialog', { name: /Undo the rejection/ });
    await expect(undo).toContainText('ignore the earlier message');
    await expect(undo.getByRole('button', { name: 'Undo review' })).toBeDisabled();
    await undo.getByLabel(/Why\?/).fill('Clicked the wrong button');
    await undo.getByRole('button', { name: 'Undo review' }).click();
    await expect(page.getByText('is back to pending')).toBeVisible();
    await expect(rdb).toContainText('Pending');
    await expect(rdb.getByRole('button', { name: /Undo the review/ })).toHaveCount(0);
  });

  test('collections agents see the list but cannot open identity papers', async ({ page }) => {
    await signIn(page, STAFF.collections);
    const docs = await openMoses(page);
    await expect(docs.getByText('National ID')).toBeVisible();
    await expect(docs.getByRole('link', { name: /^View/ })).toHaveCount(0);
    await expect(docs.getByRole('button', { name: /Verify|Ask for a new/ })).toHaveCount(0);
  });
});
