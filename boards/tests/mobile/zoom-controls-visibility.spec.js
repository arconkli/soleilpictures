// The on-canvas zoom widget (.cnv-zoom) is decluttered on touch: hidden by
// default, revealed only WHILE actively zooming (body[data-zooming='1'], set by
// markZooming() in CanvasSurface and cleared ~1.1s after the last zoom change).
// Desktop keeps it always-visible. Runs against the local app (?local=1).

import { expect, test } from '@playwright/test';

test('desktop: zoom widget stays visible, and a +/− press flags zooming', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'desktop only');
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  const zoom = page.locator('.cnv-zoom');
  await expect(zoom).toBeVisible();
  // The "+" button: markZooming() flags zooming, and the widget never hides on desktop.
  await page.locator('.cnv-zoom button').last().click();
  expect(await page.evaluate(() => document.body.hasAttribute('data-zooming'))).toBe(true);
  await expect(zoom).toBeVisible();
});

test('touch: zoom widget hidden by default; only data-zooming reveals it (not pan)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch / mobile only');
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  const zoom = page.locator('.cnv-zoom');
  await zoom.waitFor({ state: 'attached' });

  // Hidden by default.
  await expect(zoom).toHaveCSS('opacity', '0');
  // A pure pan (data-canvas-interacting) must NOT reveal it...
  await page.evaluate(() => document.body.setAttribute('data-canvas-interacting', '1'));
  await expect(zoom).toHaveCSS('opacity', '0');
  await page.evaluate(() => document.body.removeAttribute('data-canvas-interacting'));
  // ...only an active zoom does.
  await page.evaluate(() => document.body.setAttribute('data-zooming', '1'));
  await expect(zoom).toHaveCSS('opacity', '1');
  await page.evaluate(() => document.body.removeAttribute('data-zooming'));
  await expect(zoom).toHaveCSS('opacity', '0');
});
