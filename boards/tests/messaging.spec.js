import { expect, test } from '@playwright/test';

test('msg-panel CSS classes are shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => {
    const want = ['.msg-panel', '.msg-row', '.msg-bubble', '.msg-composer'];
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

test('Sidebar has Messages row (not Inbox) in local QA', async ({ page }) => {
  await page.goto('/?local=1');
  await page.waitForSelector('.sb-row', { timeout: 5000 });
  const hasMessages = await page.locator('.sb-row').filter({ hasText: 'Messages' }).count();
  const hasInbox    = await page.locator('.sb-row').filter({ hasText: 'Inbox' }).count();
  expect(hasMessages).toBeGreaterThan(0);
  expect(hasInbox).toBe(0);
});

test('app loads with no page errors after messaging migration', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/?local=1');
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
