// Zoom-aware image tier selection on the public /share canvas. The canvas
// zooms via an ancestor CSS transform, so a card's LAYOUT width never changes
// with zoom — pickInitialTier multiplies in the settled canvas scale
// (lib/canvasScale.js, published during CanvasSurface render) to pick the tier
// the card's ON-SCREEN size justifies. There is no srcset: `activeSrc` is the
// single tier decision-maker (mount via pickInitialTier, then the promote/
// demote ladder). Pre-fix, a board opened at fit-all decoded the 1280px lg
// preview for every tiny card (~4× the sm texture bytes) — the aggregate is
// exactly what blew the GPU tile budget on image-heavy boards.

import { expect, test } from '@playwright/test';
import { TOKEN, IMAGE_COUNT, routeShareBundle, routeAnalytics, routeImageCdn } from './helpers/share-fixture.js';

const loadedSrcs = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.r2p-img')].map((el) => el.currentSrc).filter(Boolean));

// lib/device.js lowMemoryDevice() = iOS Safari OR navigator.deviceMemory <= 4.
// Pin deviceMemory so these specs are deterministic regardless of runner RAM:
// gb=8 forces the full-fidelity (Tier-2 original) path, gb=4 forces the
// memory-constrained cap (canvas never promotes past the 1280px lg preview).
const forceDeviceMemory = (page, gb) => page.addInitScript((n) => {
  try { Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => n }); } catch (_) {}
}, gb);

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

  // No srcset on the canvas imgs — activeSrc is the only tier control now.
  const withSrcset = await page.evaluate(() =>
    [...document.querySelectorAll('.r2p-img')].filter((el) => el.hasAttribute('srcset')).length);
  expect(withSrcset).toBe(0);

  // The blur layers unmount a beat after the images paint (freeing paint
  // budget at fit-all). Watch that no .r2p-img loses is-loaded as they go.
  await page.evaluate(() => {
    window.__reblurs = 0;
    for (const el of document.querySelectorAll('.r2p-img')) {
      new MutationObserver(() => { if (!el.classList.contains('is-loaded')) window.__reblurs += 1; })
        .observe(el, { attributes: true, attributeFilter: ['class'] });
    }
  });
  await expect.poll(async () => page.evaluate(
    () => document.querySelectorAll('.r2p-blur').length), { timeout: 4000 }).toBe(0);
  expect(await page.evaluate(() => window.__reblurs)).toBe(0);
});

test('zoom-in promotes to the original; zoom-out demotes back to sm — never re-blurring', async ({ page }) => {
  await forceDeviceMemory(page, 8); // full-fidelity device: Tier-2 originals allowed
  await routeAnalytics(page, []);
  await routeImageCdn(page);
  await routeShareBundle(page, { withImages: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Image board ready', { exact: true })).toBeVisible();
  await expect.poll(async () => (await loadedSrcs(page)).length, { timeout: 8000 })
    .toBeGreaterThanOrEqual(IMAGE_COUNT);

  // Tag the image nearest the viewport center as the zoom target (the wheel
  // zoom anchors at the cursor, so this card stays on-screen and grows) and
  // watch its class list: is-loaded must NEVER drop once set — a tier swap
  // that re-blurred the visible image would show up here.
  const target = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.r2p-img')];
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    let best = imgs[0], bd = Infinity;
    for (const el of imgs) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bd) { bd = d; best = el; }
    }
    best.setAttribute('data-tier-target', '1');
    window.__reblurs = 0;
    new MutationObserver(() => {
      if (!best.classList.contains('is-loaded')) window.__reblurs += 1;
    }).observe(best, { attributes: true, attributeFilter: ['class'] });
    const r = best.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, src: best.currentSrc };
  });
  expect(target.src).toContain('-sm.webp');

  const targetSrc = () => page.evaluate(
    () => document.querySelector('[data-tier-target]')?.currentSrc || '');
  const zoomBurst = (deltaY) => page.evaluate(({ dy, x, y }) => {
    const wrap = document.querySelector('.canvas-wrap');
    for (let i = 0; i < 10; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y,
      }));
    }
  }, { dy: deltaY, x: target.x, y: target.y });

  // Deep zoom-in (one burst saturates ZOOM_MAX): the scheduler's promote drain
  // (~150ms after the settle) jumps the displayed-large card straight to the
  // original. Poll timeout covers the drain + presign + decode.
  await zoomBurst(-240);
  await expect.poll(targetSrc, { timeout: 8000 }).toContain('-orig.png');

  // Deep zoom-out: the scheduler's demote drain steps the card back down to sm,
  // but only after ~1.5s of true idle (demotes never run mid-interaction), so
  // the poll must outlast that window.
  await zoomBurst(240);
  await expect.poll(targetSrc, { timeout: 8000 }).toContain('-sm.webp');

  // Zoom back in: upgradedRef was cleared by the demotion, so the card climbs
  // again — exercises a repeat Tier-2 upgrade from sm after a full cycle.
  await zoomBurst(-240);
  await expect.poll(targetSrc, { timeout: 8000 }).toContain('-orig.png');

  const after = await page.evaluate(() => ({
    reblurs: window.__reblurs,
    promote: window.__perfReport?.counters?.['image.tierPromote'] || 0,
    upgrade: window.__perfReport?.counters?.['image.tier2Upgrade'] || 0,
    demote: window.__perfReport?.counters?.['image.tierDemote'] || 0,
  }));
  expect(after.reblurs).toBe(0);
  // Two zoom-in legs each reach the original (jump-to-best-tier means the
  // sm→preview micro-step may be skipped, so assert on the combined climb).
  expect(after.promote + after.upgrade).toBeGreaterThanOrEqual(2);
  expect(after.upgrade).toBeGreaterThanOrEqual(2);
  expect(after.demote).toBeGreaterThanOrEqual(1);
});

test('low-memory device caps the canvas at the lg preview — zoom-in never reaches the original', async ({ page }) => {
  // Regression guard for the iOS-Safari viewer OOM: on a memory-constrained tab
  // a pinch-zoom-in must climb sm→lg but NEVER decode the full-resolution
  // original (a handful of 12–24MP decodes crashes the WebKit renderer, which is
  // the "A problem repeatedly occurred" bug). lib/device.js flags iOS Safari and
  // ≤4GB devices; we simulate the latter here.
  await forceDeviceMemory(page, 4);
  await routeAnalytics(page, []);
  await routeImageCdn(page);
  await routeShareBundle(page, { withImages: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Image board ready', { exact: true })).toBeVisible();
  await expect.poll(async () => (await loadedSrcs(page)).length, { timeout: 8000 })
    .toBeGreaterThanOrEqual(IMAGE_COUNT);

  // Same center-anchored zoom target as the desktop spec.
  const target = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.r2p-img')];
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    let best = imgs[0], bd = Infinity;
    for (const el of imgs) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bd) { bd = d; best = el; }
    }
    best.setAttribute('data-tier-target', '1');
    const r = best.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, src: best.currentSrc };
  });
  expect(target.src).toContain('-sm.webp');

  const targetSrc = () => page.evaluate(
    () => document.querySelector('[data-tier-target]')?.currentSrc || '');
  const zoomBurst = (deltaY) => page.evaluate(({ dy, x, y }) => {
    const wrap = document.querySelector('.canvas-wrap');
    for (let i = 0; i < 10; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y,
      }));
    }
  }, { dy: deltaY, x: target.x, y: target.y });

  // Deep zoom-in: the ungated sm→lg promote still fires (lg IS the cap), but the
  // Tier-2 original upgrade is refused on a low-memory device.
  await zoomBurst(-240);
  await expect.poll(targetSrc, { timeout: 8000 }).toContain('-lg.webp');

  // Hold past a second would-be promote drain, then confirm it never climbed to
  // the original and no original decode was counted anywhere.
  await page.waitForTimeout(1000);
  expect(await targetSrc()).not.toContain('-orig');
  const counters = await page.evaluate(() => ({
    upgrade: window.__perfReport?.counters?.['image.tier2Upgrade'] || 0,
    promote: window.__perfReport?.counters?.['image.tierPromote'] || 0,
  }));
  expect(counters.upgrade).toBe(0);                    // zero full-res original decodes
  expect(counters.promote).toBeGreaterThanOrEqual(1);  // did climb sm→lg
  for (const s of await loadedSrcs(page)) expect(s).not.toContain('-orig');
});
