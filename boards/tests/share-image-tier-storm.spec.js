// Bounded image-tier storm on a DENSE public /share board (24 image cards).
// The pre-fix failure: one zoom-in settle woke ~70 per-card effects that ALL
// promoted to the original in the same idle window (live: image.tier2Upgrade
// =67), and the matching zoom-out settle swapped ~54 textures at once — a
// GPU raster storm that froze the compositor at fit-all. The scheduler bounds
// it: promotes are viewport-gated (a card the cull will drop never wastes an
// original decode), demotes wait for true idle, and every swap is probe-
// decoded so a loaded image never re-blurs.

import { expect, test } from '@playwright/test';
import { TOKEN, DENSE_IMAGE_COUNT, routeShareBundle, routeAnalytics, routeImageCdn } from './helpers/share-fixture.js';

const loadedSrcs = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.r2p-img')].map((el) => el.currentSrc).filter(Boolean));

async function openDense(page) {
  await routeAnalytics(page, []);
  await routeImageCdn(page);
  await routeShareBundle(page, { denseImages: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Image board ready', { exact: true })).toBeVisible();
  await expect.poll(async () => (await loadedSrcs(page)).length, { timeout: 8000 })
    .toBeGreaterThanOrEqual(DENSE_IMAGE_COUNT);
}

// Snapshot each mounted canvas img: where it is vs the viewport, and which
// tier it's showing.
function snapshotTiles(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    return [...document.querySelectorAll('.r2p-img')].map((el) => {
      const r = el.getBoundingClientRect();
      const inView = r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
      const src = el.currentSrc || el.src || '';
      const tier = src.includes('-sm.webp') ? 'sm' : src.includes('-lg.webp') ? 'lg'
        : src.includes('-orig.png') ? 'orig' : 'other';
      return { inView, tier };
    });
  });
}

test('fit-all on a dense board loads every image at the sm tier', async ({ page }) => {
  await openDense(page);
  for (const s of await loadedSrcs(page)) expect(s).toContain('-sm.webp');
});

test('zoom-in promotes only on-screen cards; off-screen mounted cards stay sm; no re-blur', async ({ page }) => {
  await openDense(page);

  // Watch every tile for a re-blur (is-loaded dropping) across the whole cycle.
  await page.evaluate(() => {
    window.__reblurs = 0;
    for (const el of document.querySelectorAll('.r2p-img')) {
      new MutationObserver(() => { if (!el.classList.contains('is-loaded')) window.__reblurs += 1; })
        .observe(el, { attributes: true, attributeFilter: ['class'] });
    }
  });

  // Anchor the zoom on the viewport CENTER (≈ the grid center at fit-all), so
  // zooming keeps the grid centered: in-view cards grow large enough to promote
  // while the KEEP band (1.5 viewports) still holds a ring of off-screen cards
  // mounted. One ctrl-wheel burst per step; stop as soon as a card has promoted
  // AND off-screen mounted cards exist (a moderate zoom — too deep and the cull
  // prunes the off-screen ring away).
  const zoomStep = () => page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    const x = window.innerWidth / 2, y = window.innerHeight / 2;
    for (let i = 0; i < 2; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }
  });

  let tiles = [];
  for (let step = 0; step < 5; step++) {
    await zoomStep();
    await page.waitForTimeout(650);   // settle + promote drain + batches
    tiles = await snapshotTiles(page);
    const promoted = tiles.some((t) => t.inView && t.tier !== 'sm');
    const offMounted = tiles.some((t) => !t.inView);
    if (promoted && offMounted) break;
  }

  const offView = tiles.filter((t) => !t.inView);
  // The test is only meaningful if some cards are mounted but off-viewport.
  expect(offView.length).toBeGreaterThanOrEqual(1);
  // THE bound: the viewport gate never promotes an off-screen card (pre-fix,
  // every mounted card promoted to the original regardless of position —
  // image.tier2Upgrade=67 on the real board).
  for (const t of offView) expect(t.tier).toBe('sm');
  // And at least one on-screen card did promote above sm.
  expect(tiles.some((t) => t.inView && t.tier !== 'sm')).toBe(true);
  // No re-blur from any of the promote swaps.
  expect(await page.evaluate(() => window.__reblurs)).toBe(0);

  // Zoom back out to fit-all: after the idle window the promoted cards demote
  // back toward sm — bounded + probe-decoded, so still no re-blur.
  await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    const x = window.innerWidth / 2, y = window.innerHeight / 2;
    for (let i = 0; i < 12; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }
  });
  await expect.poll(async () => {
    const t = await snapshotTiles(page);
    return t.length > 0 && t.every((x) => x.tier === 'sm');
  }, { timeout: 9000 }).toBe(true);
  expect(await page.evaluate(() => window.__reblurs)).toBe(0);
});

test('rapid zoom cycles never strand a card on its blur (cached-load reaches is-loaded)', async ({ page }) => {
  await openDense(page);
  const cycle = (dy, n) => page.evaluate(({ dy, n }) => {
    const wrap = document.querySelector('.canvas-wrap');
    const x = window.innerWidth / 2, y = window.innerHeight / 2;
    for (let i = 0; i < n; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }
  }, { dy, n });

  // Several fast in/out cycles → cards unmount and remount with warm-cache
  // images, which complete before React attaches onLoad. Without the
  // cached-complete safety net those cards' `loaded` state sticks false: the
  // <img> sits at opacity 0 and only the blur shows.
  for (let k = 0; k < 4; k++) { await cycle(-240, 8); await page.waitForTimeout(120); await cycle(240, 10); await page.waitForTimeout(120); }

  // Every mounted canvas image must reach is-loaded (its real bytes visible),
  // and the blur layers must drain — no card stranded blurry.
  await expect.poll(async () => page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.r2p-img')];
    return imgs.length > 0 && imgs.every((el) => el.classList.contains('is-loaded'));
  }), { timeout: 9000 }).toBe(true);
  await expect.poll(async () => page.evaluate(
    () => document.querySelectorAll('.r2p-blur').length), { timeout: 5000 }).toBe(0);
});
