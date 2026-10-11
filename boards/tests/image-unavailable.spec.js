// An image the browser cannot decode (a TIFF or PSD outside Safari, a HEIC on
// Chrome/Firefox, an object that is gone) used to loop: every <img> error
// forced a fresh signature, a fresh signature is a new URL string, so the
// browser re-downloaded the whole original and failed again, every second or
// two, for as long as the card was mounted. MEDIA-02: one re-sign per tier,
// then a variant falls back to the original, and an original that still fails
// says "Preview not available" with a Download.
//
// Runs on the public /share viewer fixture (no PartyKit, no Supabase): one of
// the eight image cards serves bytes that are not an image at any tier.

import { expect, test } from '@playwright/test';
import { TOKEN, routeShareBundle, routeAnalytics } from './helpers/share-fixture.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('an undecodable image stops downloading and says Preview not available', async ({ page }) => {
  const hits = { broken: 0 };
  await routeAnalytics(page, []);
  await page.route('https://imgcdn.test/**', (route) => {
    const url = route.request().url();
    if (/\/0-/.test(url)) {
      hits.broken += 1;
      // TIFF magic followed by nothing a browser outside Safari can draw.
      return route.fulfill({ status: 200, contentType: 'image/tiff', body: Buffer.from('II*\u0000garbage-not-an-image') });
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
  });
  await routeShareBundle(page, { withImages: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Image board ready', { exact: true })).toBeVisible();

  const card = page.locator('.r2-img-unavailable');
  await expect(card).toHaveCount(1, { timeout: 8000 });
  await expect(card.getByText('Preview not available')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Download' })).toBeVisible();

  // Bounded: the variant tiers, the fall-back to the original, and nothing
  // after. (On this viewer the re-sign returns the same static URL; in the app
  // it is a new string, which is what used to loop.)
  const settled = hits.broken;
  await page.waitForTimeout(4000);
  expect(hits.broken).toBe(settled);
  expect(settled).toBeLessThanOrEqual(8);

  // The other seven still render as images.
  await expect.poll(() => page.evaluate(
    () => document.querySelectorAll('.r2p-img.is-loaded').length), { timeout: 8000 }).toBeGreaterThanOrEqual(7);
});
