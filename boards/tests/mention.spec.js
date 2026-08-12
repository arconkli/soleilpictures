import { expect, test } from '@playwright/test';

test('auto-detect underline CSS class is shipped', async ({ page }) => {
  // `.tt-link-auto`, not `.tt-autolink-candidate`.
  //
  // The old class NEVER RENDERED — commit 6855d95 says so in as many words and
  // replaced it with `.tt-link-auto[data-records]` (DocPageEditor.jsx:529) back
  // in June. This assertion has therefore been red ever since, guarding a class
  // whose absence was the fix, and nobody saw it because the suite had enough
  // noise to hide a two-month-old failure.
  await page.goto('/?local=1');
  const has = await page.evaluate(() => [...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => r.selectorText?.includes('.tt-link-auto')); }
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
