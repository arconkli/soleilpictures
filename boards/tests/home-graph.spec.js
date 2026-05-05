import { expect, test } from '@playwright/test';

test('home-graph CSS classes are shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => {
    const want = ['.home-graph-wrap', '.home-graph-hud', '.home-graph-chip', '.home-empty'];
    const found = new Set();
    for (const s of document.styleSheets) {
      try {
        for (const r of s.cssRules) {
          for (const w of want) if (r.selectorText?.includes(w)) found.add(w);
        }
      } catch {}
    }
    return want.every(w => found.has(w));
  });
  expect(has).toBe(true);
});

test('Home sidebar row exists in local QA mode', async ({ page }) => {
  await page.goto('/?local=1');
  await expect(page.locator('.sb-row').filter({ hasText: 'Home' }).first()).toBeVisible();
});

test('clicking Home switches to graph empty state (local QA has no backlinks)', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator('.sb-row').filter({ hasText: 'Home' }).first().click();
  // Empty state should render since local QA has no Postgres backlinks.
  await expect(page.locator('.home-empty')).toBeVisible();
});
