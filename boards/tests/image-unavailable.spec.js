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

// The reverse: the variants decode but the original does not (a HEIC or TIFF
// whose webp preview Safari made, viewed in Chrome; an original that is gone
// while its retention-locked previews remain). Zooming in promotes the card to
// the original; when that fails it must drop back to the preview it was
// already showing, and never promote again, instead of going blank.
test('an original that will not decode keeps the card on its preview after a zoom-in', async ({ page }) => {
  // Full-fidelity device so the Tier-2 promote is allowed (see share-image-tier).
  await page.addInitScript(() => {
    try { Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 8 }); } catch (_) {}
  });
  const hits = { orig: 0 };
  await routeAnalytics(page, []);
  await page.route('https://imgcdn.test/**', (route) => {
    if (/-orig\./.test(route.request().url())) {
      hits.orig += 1;
      return route.fulfill({ status: 200, contentType: 'image/tiff', body: Buffer.from('II*\u0000garbage-not-an-image') });
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
  });
  await routeShareBundle(page, { withImages: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Image board ready', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => document.querySelectorAll('.r2p-img.is-loaded').length), { timeout: 8000 }).toBeGreaterThanOrEqual(8);
  // The public viewer answers an image error by re-fetching the bundle for
  // fresh URLs and remounting the canvas (an expired presign). That remount
  // would reset the zoom under the test; the app has no such step (its
  // re-sign is a new URL), so fail the refresh and keep the canvas mounted.
  await page.route('**/parties/upload/share/share-bundle', (route) => route.abort());

  const target = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.r2p-img')];
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    let best = imgs[0], bd = Infinity;
    for (const el of imgs) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bd) { bd = d; best = el; }
    }
    best.closest('.r2p').setAttribute('data-tier-target', '1');
    const r = best.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const zoomBurst = (deltaY) => page.evaluate(({ dy, x, y }) => {
    const wrap = document.querySelector('.canvas-wrap');
    for (let i = 0; i < 10; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y,
      }));
    }
  }, { dy: deltaY, x: target.x, y: target.y });
  const targetState = () => page.evaluate(() => {
    const el = document.querySelector('[data-tier-target] .r2p-img');
    return el ? `${el.classList.contains('is-loaded') ? 'loaded' : 'pending'} ${el.currentSrc}` : 'gone';
  });

  // Deep zoom-in: the scheduler promotes to the original, the original fails,
  // and the card lands back on the lg preview, still loaded.
  await zoomBurst(-240);
  await expect.poll(() => hits.orig, { timeout: 8000 }).toBeGreaterThan(0);
  await expect.poll(targetState, { timeout: 8000 }).toMatch(/^loaded .*-lg\.webp$/);
  await expect(page.locator('.r2-img-unavailable')).toHaveCount(0);

  // Out and back in: a demote clears the upgrade latch, but the broken
  // original is never fetched again.
  const settled = hits.orig;
  await zoomBurst(240);
  await expect.poll(targetState, { timeout: 8000 }).toMatch(/-sm\.webp$/);
  await zoomBurst(-240);
  await expect.poll(targetState, { timeout: 8000 }).toMatch(/^loaded .*-lg\.webp$/);
  await page.waitForTimeout(1500);
  expect(hits.orig).toBe(settled);
  expect(await targetState()).toMatch(/^loaded .*-lg\.webp$/);
  await expect(page.locator('.r2-img-unavailable')).toHaveCount(0);
});
