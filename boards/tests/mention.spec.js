import { expect, test } from '@playwright/test';

test('auto-detect underline CSS class is shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => [...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => r.selectorText?.includes('.tt-autolink-candidate')); }
    catch { return false; }
  }));
  expect(has).toBe(true);
});

test('app loads with no page errors after Phase 3', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/?local=1');
  await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
