import { expect, test } from '@playwright/test';

test('feedback dialog modal classes are shipped (.feedback-dialog + .btn-primary)', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => {
    const want = ['.feedback-dialog', '.btn-primary'];
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

test('inline-composer + entity-picker CSS classes are shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => {
    const want = ['.inline-composer', '.entity-picker'];
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

test('app loads with no page errors after Phase 1', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/?local=1');
  await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
