// The phone admin keeps the last visit's numbers (lib/adminSnapshot.js, under
// 'phone:<key>') and paints them at once; the header says "Updating…" until the
// fresh ones land. Dev-only fixture harness; &rpcdelay=<ms> holds every answer.

import { test, expect } from '@playwright/test';

const T = { timeout: 20000 };
const URL = '/admin?adminpreview=1&phone=1';
const header = (page) => page.getByRole('button', { name: 'Refresh' });

test('the last visit\'s numbers paint before the network answers, marked Updating…', async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByTestId('ap-active-now').locator('b')).toHaveText('14', T);
  await expect(header(page)).not.toContainText('Updating…', T);
  await expect.poll(() => page.evaluate(
    () => Object.keys(localStorage).filter((k) => k.startsWith('adminSnap:preview:phone:')).length,
  ), T).toBeGreaterThan(0);

  await page.goto(`${URL}&rpcdelay=4000`);
  await expect(header(page)).toContainText('Updating…', { timeout: 1500 });
  await expect(page.getByTestId('ap-active-now').locator('b')).toHaveText(/\d/, { timeout: 1500 });
  await expect(page.getByTestId('ap-paying').locator('b')).toHaveText(/\d/, { timeout: 1500 });

  await expect(header(page)).not.toContainText('Updating…', { timeout: 15000 });
  await expect(page.getByTestId('ap-active-now').locator('b')).toHaveText('14');
});

// A forced refresh (the header's Refresh) asks for new numbers only from the
// reads on screen when it was tapped. A page opened after it reads normally, so
// a slow call it already made (cached for SLOW_TTL) is reused, not recomputed.
// Search's `crawlers` (admin_crawler_hits) is slow and is not on Today.
test('a refresh does not recompute a slow call for a page opened after it', async ({ page }) => {
  const crawlerCalls = () => page.evaluate(() => (window.__admRpcCalls || {}).admin_crawler_hits || 0);
  const crawlerNumbers = page.getByText('AI crawlers’ visits, 30 days');
  const openSearch = async () => {
    const fig = page.locator('.ap-fh-go').first();
    await fig.scrollIntoViewIfNeeded();
    await fig.click();
    await expect(page.getByTestId('ap-page-search')).toBeVisible(T);
    await expect(crawlerNumbers).toBeVisible(T);
  };

  await page.goto(URL);
  await expect(page.getByTestId('ap-active-now').locator('b')).toHaveText('14', T);
  await expect(header(page)).not.toContainText('Updating…', T);

  await openSearch();
  const t1 = await crawlerCalls();
  expect(t1).toBeGreaterThanOrEqual(1);

  await page.locator('.ap-bk').filter({ hasText: 'Today' }).click();
  await expect(page.getByTestId('ap-page-search')).toHaveCount(0);

  await header(page).click();
  await expect(page.getByTestId('ap-active-now').locator('b')).toHaveText('14', T);
  await expect(header(page)).not.toContainText('Updating…', T);

  await openSearch();
  await page.waitForTimeout(500);
  expect(await crawlerCalls()).toBe(t1);
});
