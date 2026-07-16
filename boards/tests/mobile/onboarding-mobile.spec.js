import { expect, test } from '@playwright/test';

// The first-run onboarding board must be USABLE on a phone. At onboarding_v2
// arm B:100 the seed is an EMPTY board (the retired arm-A starter notes +
// "Ideas" tutorial are gone), so first-run guidance is the empty-state
// first-card tiles + the guided tour. These must lay out readably on a ~390px
// canvas and the copy must be touch-aware (no bare "right-click", which means
// nothing without a mouse).

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
});

test('the empty-board first-card tiles render readably and stay within the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'mobile onboarding layout');

  const tiles = page.locator('.cnv-empty-tiles');
  await expect(tiles).toBeVisible();
  // The "Add an image" hero (the activation CTA) is on screen and tappable.
  await expect(page.locator('.cnv-empty-tile-hero')).toBeVisible();

  // Nothing in the first-card panel overflows the viewport horizontally (the old
  // wide desktop spread forced ~35% fit-zoom / off-screen cards on a phone).
  const vw = page.viewportSize()?.width ?? 390;
  const box = await tiles.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(-2);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 2);
});

test('onboarding copy is touch-aware on a touch device', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch copy');
  const coarse = await page.evaluate(() =>
    window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  test.skip(!coarse, 'requires a coarse-pointer (touch) device');

  // The empty-board sub-line has a coarse (touch) variant that must never say
  // "right-click" or "double-click" — it points at a touch gesture instead.
  const coarseSub = page.locator('.cnv-empty-tiles-sub-coarse');
  await expect(coarseSub).toBeVisible();
  const copy = (await coarseSub.innerText()).toLowerCase();
  expect(copy).not.toContain('right-click');
  expect(copy).not.toContain('double-click');
  expect(/tap|long-press|drag/.test(copy)).toBe(true);
});
