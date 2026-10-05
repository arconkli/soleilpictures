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

// Home is the projects panel over the graph (2026-10-01). Behind the panel the
// graph is scenery, so its own empty-state copy stays out of the panel's way;
// exploring the graph (panel put away) is where that empty state belongs.
test('clicking Home shows the projects panel, with the graph empty state kept behind it', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator('.sb-row').filter({ hasText: 'Home' }).first().click();
  await expect(page.locator('.ph-panel')).toBeVisible();
  await expect(page.locator('.home-empty')).toHaveCount(0);
});

test('exploring the universe shows the graph empty state (local QA has no backlinks)', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator('.sb-row').filter({ hasText: 'Home' }).first().click();
  await page.locator('.ph-explore').click();
  // Empty state should render since local QA has no Postgres backlinks.
  await expect(page.locator('.home-empty')).toBeVisible();
});
