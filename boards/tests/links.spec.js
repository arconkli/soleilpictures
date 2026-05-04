import { expect, test } from '@playwright/test';

test('Link mark CSS shipped (.tt-link-broken indicates the new mark renderer)', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => {
    return [...document.styleSheets].some(s => {
      try { return [...s.cssRules].some(r => r.selectorText?.includes('.tt-link-broken')); }
      catch { return false; }
    });
  });
  expect(has).toBe(true);
});

test('Doc rail tabs no longer show Bookmarks (replaced by Links + Refs)', async ({ page }) => {
  await page.goto('/?local=1');
  const hasBookmarksLabel = await page.evaluate(() => document.body.innerText.includes('Bookmarks'));
  expect(hasBookmarksLabel).toBe(false);
});

test('doc-links and doc-refs CSS classes are shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => {
    const want = ['.doc-links', '.doc-refs', '.backlinks-row'];
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
