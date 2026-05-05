import { expect, test } from '@playwright/test';

test('comment-gutter dot CSS is shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => [...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => r.selectorText?.includes('.comment-gutter-dot')); }
    catch { return false; }
  }));
  expect(has).toBe(true);
});

test('comment-inline-pop CSS is shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => [...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => r.selectorText?.includes('.comment-inline-pop')); }
    catch { return false; }
  }));
  expect(has).toBe(true);
});
