// Stroke/arrow viewport culling + the always-on jank reporter, exercised on
// the public /share canvas (same shared render code as the editor, no auth).
//
// Strokes used to render ALL their SVG paths (3 per stroke) on every
// CanvasSurface render regardless of viewport — on scribble-heavy boards
// that was a top jank source. Off-band strokes now render null (index
// coupling preserved); selected strokes are exempt.

import { expect, test } from '@playwright/test';
import { TOKEN, routeShareBundle, routeAnalytics } from './helpers/share-fixture.js';

const strokePathCount = (page) => page.locator('.strokes-layer path[data-stroke-line]').count();

test('strokes cull at deep zoom and all render at fit-all', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page, { dense: true, withStrokes: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Note 0', { exact: true })).toBeVisible();

  // Fit-all puts every scribble in the KEEP band → all 120 render.
  await expect.poll(() => strokePathCount(page), { timeout: 5000 }).toBe(120);

  // Hard zoom-in at the viewport center, then settle: the world-space band
  // shrinks far below the 12×10-cell stroke grid → most strokes cull.
  await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    for (let i = 0; i < 10; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    }
  });
  await expect.poll(() => strokePathCount(page), { timeout: 3000 }).toBeLessThan(40);

  // Zoom back out → everything returns (no stuck culling).
  await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    for (let i = 0; i < 10; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 240, ctrlKey: true, bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    }
  });
  await expect.poll(() => strokePathCount(page), { timeout: 3000 }).toBe(120);
});

test('always-on jank reporter records a longtask incident with board context', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page, { dense: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Note 0', { exact: true })).toBeVisible();

  // The reporter mutes the first 3s after load (startup noise).
  await page.waitForTimeout(3200);

  const hook = await page.evaluate(() => ({
    present: !!window.__perfReport,
    incidents: window.__perfReport?.incidents.length ?? -1,
  }));
  expect(hook.present).toBe(true);

  // Block the main thread ~450ms → longtask observer fires → incident
  // recorded on the window hook (network post is DEV-gated; the hook isn't).
  // NOTE: the spin must run as a NORMAL page task via setTimeout — Chromium
  // does not generate longtask entries for CDP-evaluate execution itself.
  await page.evaluate(() => {
    setTimeout(() => { const t = performance.now(); while (performance.now() - t < 450) { /* spin */ } }, 0);
  });
  await expect.poll(async () => page.evaluate(() => window.__perfReport.incidents.length), { timeout: 4000 })
    .toBeGreaterThan(0);

  const incident = await page.evaluate(() => window.__perfReport.incidents[0]);
  expect(incident.bucket).toMatch(/^perf: longtask .* \(canvas\)$/);
  expect(incident.ctx.is_public).toBe(true);
  expect(incident.ctx.cards_total).toBeGreaterThanOrEqual(60);
  expect(typeof incident.ctx.longtask_ms).toBe('number');
});

test('jank reporter records a frame-gap incident during interaction', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page, { dense: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Note 0', { exact: true })).toBeVisible();
  await page.waitForTimeout(3200);   // startup mute

  // Start the interaction-gated sampler, give it a couple of ticks so
  // prevTickAt is anchored, then stall the main thread DIRECTLY in evaluate.
  // CDP-evaluate execution emits NO longtask entry (see the test above), so
  // the only detector that can fire here is the frame-gap path — rAF is
  // frozen by the stall regardless of what queued the work.
  await page.locator('.canvas-wrap').dispatchEvent('pointermove', { clientX: 200, clientY: 200 });
  await page.waitForTimeout(150);
  await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 450) { /* spin */ } });

  await expect.poll(async () => page.evaluate(
    () => window.__perfReport.incidents.filter((i) => /^perf: frame-gap /.test(i.bucket)).length,
  ), { timeout: 4000 }).toBeGreaterThan(0);

  const incident = await page.evaluate(
    () => window.__perfReport.incidents.find((i) => /^perf: frame-gap /.test(i.bucket)),
  );
  expect(incident.bucket).toBe('perf: frame-gap 350-1000ms (canvas)');
  expect(incident.ctx.gap_ms).toBeGreaterThanOrEqual(350);
  expect(incident.ctx.is_public).toBe(true);
});

test('jank reporter records a freeze incident for a multi-second rAF stall', async ({ page }) => {
  test.setTimeout(40_000);
  await routeAnalytics(page, []);
  await routeShareBundle(page, { dense: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Note 0', { exact: true })).toBeVisible();
  await page.waitForTimeout(3200);   // startup mute

  // Anchor the sampler, then stall rAF for >10s directly in evaluate (no
  // tab-hide). A gap in [10s, 60s) with no visibilitychange→hidden during it
  // is a real renderer freeze — reported instead of discarded as tab-switch.
  await page.locator('.canvas-wrap').dispatchEvent('pointermove', { clientX: 200, clientY: 200 });
  await page.waitForTimeout(150);
  await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 11000) { /* spin */ } });

  await expect.poll(async () => page.evaluate(
    () => window.__perfReport.incidents.filter((i) => /^perf: freeze /.test(i.bucket)).length,
  ), { timeout: 4000 }).toBeGreaterThan(0);

  const incident = await page.evaluate(
    () => window.__perfReport.incidents.find((i) => /^perf: freeze /.test(i.bucket)),
  );
  expect(incident.bucket).toBe('perf: freeze >10s (canvas)');
  expect(incident.ctx.gap_ms).toBeGreaterThanOrEqual(10_000);
  expect(incident.ctx.is_public).toBe(true);
});
