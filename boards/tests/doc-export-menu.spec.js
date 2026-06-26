// Regression: the doc/screenplay "Export" dropdown must actually be reachable.
//
// The toolbar (.doc-tb) is a horizontal scroll container (overflow-x:auto;
// overflow-y:hidden). For months the Export menu was an inline absolutely-
// positioned child of that toolbar, so it was CLIPPED to a few-pixel sliver
// hanging below the bar — the user could see a dark sliver but never click
// "Export PDF". The fix portals the menu to <body> (fixed-positioned against
// the trigger), like FontPickerDropdown.
//
// getBoundingClientRect ignores ancestor overflow-clipping, so a rect-in-
// viewport check would have PASSED even while clipped. The reliable signal is
// hit-testing: a clipped element is not the top element at its own center, so
// document.elementFromPoint() returns something behind it. We assert the menu
// item IS the hit target → genuinely visible and clickable.

import { expect, test } from '@playwright/test';

async function openScreenplayDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await expect(page.locator('.tt-editor').first()).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.locator('.doc-tb-screenplay-toggle').click();
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
}

// Is `selector`'s element the actual hit target at its own center (i.e. not
// clipped by an ancestor's overflow and not covered by anything)?
async function isHittable(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { found: true, hittable: false, reason: 'zero-size', r };
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      found: true,
      hittable: !!top && (top === el || el.contains(top) || top.contains(el)),
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
      r: { top: r.top, bottom: r.bottom, height: r.height },
    };
  }, selector);
}

test('the Export menu opens fully (not clipped by the toolbar) and its items are clickable', async ({ page }) => {
  await openScreenplayDoc(page);

  // Click the down-arrow Export button in the toolbar.
  await page.locator('.doc-card-modal button[aria-label="Export"]').click();

  // The menu renders (portaled to <body>, so it's outside .doc-card-modal).
  const menu = page.locator('.doc-export-menu');
  await expect(menu).toBeVisible();

  // The "Export PDF" item must be a genuine hit target — the whole point of the
  // bug was that it existed in the DOM but was clipped to a sliver.
  const pdfItem = menu.getByRole('menuitem', { name: 'Export PDF' });
  await expect(pdfItem).toBeVisible();

  const hit = await isHittable(page, '.doc-export-menu');
  expect(hit.found).toBe(true);
  expect(hit.r.height).toBeGreaterThan(40);   // a real multi-row menu, not a sliver
  expect(hit.inViewport).toBe(true);          // fully on-screen
  expect(hit.hittable).toBe(true);            // not clipped / not covered

  // Clicking it fires the real export and produces a downloadable PDF — the
  // exact end-to-end path the user wanted. On the old clipped menu, Playwright's
  // own hit-test gate would have timed out before any download could start.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    pdfItem.click({ timeout: 4000 }),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
});
