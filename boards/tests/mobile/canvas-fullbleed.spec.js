// The board canvas paints full-bleed to the viewport bottom on touch, BEHIND the
// floating bottom nav — so when the nav auto-hides on pan (or is hidden in focus
// view) the dotted-grid canvas shows through instead of a dead black strip.
// Scrollable surfaces keep their .main bottom padding (separate test concern).

import { expect, test } from '@playwright/test';

test('touch: canvas-wrap reaches the viewport bottom behind the nav', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch / mobile only');
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await page.locator('.canvas-wrap').waitFor({ state: 'attached' });

  const { gap, navTop, wrapBottom } = await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    const nav = document.querySelector('.mb-nav').getBoundingClientRect();
    return { gap: Math.round(window.innerHeight - wrap.bottom), navTop: Math.round(nav.top), wrapBottom: Math.round(wrap.bottom) };
  });
  // Canvas reaches the bottom edge (no reserved dead strip).
  expect(gap).toBeLessThanOrEqual(1);
  // The nav floats OVER the bottom of that full-bleed canvas.
  expect(navTop).toBeLessThan(wrapBottom);
});
