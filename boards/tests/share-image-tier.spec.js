// Zoom-aware image tier selection on the public /share canvas. The canvas
// zooms via an ancestor CSS transform, so a card's LAYOUT width never changes
// with zoom — the srcset `sizes` hint must multiply in the settled canvas
// scale (lib/canvasScale.js). Pre-fix, a board opened at fit-all told the
// browser every card was its full layout width, so EVERY mount decoded the
// 1280px lg preview (~4× the texture bytes of sm) for cards covering ~160
// device px — the aggregate is exactly what blew the GPU tile budget on
// image-heavy boards.

import { expect, test } from '@playwright/test';
import { TOKEN, IMAGE_COUNT, routeShareBundle, routeAnalytics, routeImageCdn } from './helpers/share-fixture.js';

const loadedSrcs = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.r2p-img')].map((el) => el.currentSrc).filter(Boolean));

test('fit-all mounts select the 640px sm preview, not lg', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeImageCdn(page);
  await routeShareBundle(page, { withImages: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Image board ready', { exact: true })).toBeVisible();

  // All image cards are in-band at fit-all; wait for every <img> to resolve
  // a candidate, then assert the browser picked sm for each.
  await expect.poll(async () => (await loadedSrcs(page)).length, { timeout: 8000 })
    .toBeGreaterThanOrEqual(IMAGE_COUNT);
  for (const s of await loadedSrcs(page)) expect(s).toContain('-sm.webp');
});
