// Gesture-aware viewport culling on the public /share canvas. During an
// active wheel/pinch/pan gesture the cull is ADD-ONLY: zooming in fast must
// not unmount cards mid-gesture (which would remount them on zoom-out and
// replay the blur tier — the "everything flashes blurry while zooming"
// churn). The strict prune runs once the gesture settles (~140ms commit).
//
// Runs against the dense 60-note fixture so the world-space bands actually
// exclude cards at deep zoom. Wheel events are dispatched synthetically —
// the handler is a native listener, so no trusted-event requirement; ctrlKey
// makes it a zoom.

import { expect, test } from '@playwright/test';
import { TOKEN, routeShareBundle, routeAnalytics } from './helpers/share-fixture.js';

const cardCount = (page) => page.locator('.card').count();

test('fast zoom-in keeps every card mounted; settle prunes; renders stay flat', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page, { dense: true });
  await page.addInitScript(() => { try { localStorage.perfHud = '1'; } catch (_) {} });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Note 0', { exact: true })).toBeVisible();

  // Fit-all mounts the whole grid.
  const initial = await cardCount(page);
  expect(initial).toBeGreaterThanOrEqual(60);

  // Burst of ctrl-wheel zoom-IN events at the viewport center, then sample
  // the mid-gesture state ~60ms later (a few rAF cull runs in, still well
  // inside the 140ms settle window) — all inside ONE evaluate so the
  // measurement can't race the settle commit. Each event shrinks the
  // world-space cull bands drastically; without gesture mode this unmounts
  // most of the grid and re-renders CanvasSurface repeatedly mid-burst.
  const mid = await page.evaluate(async () => {
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    const rendersBefore = window.perf.snapshot().counters['cs.renderCount'] || 0;
    for (let i = 0; i < 10; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    }
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 30))));
    return {
      cards: document.querySelectorAll('.card').length,
      renders: (window.perf.snapshot().counters['cs.renderCount'] || 0) - rendersBefore,
    };
  });

  // Mid-gesture: nothing unmounted, and the identity-stable visibleIds
  // meant (near-)zero CanvasSurface renders. Pre-fix: dozens of cards
  // unmounted here and every cull run re-rendered.
  expect(mid.cards).toBe(initial);
  expect(mid.renders).toBeLessThanOrEqual(2);

  // After settle the strict recompute prunes off-band cards.
  await expect.poll(() => cardCount(page), { timeout: 3000 }).toBeLessThan(initial);
});

test('zoom back out remounts pruned cards (ADD path still live during gesture)', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page, { dense: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Note 0', { exact: true })).toBeVisible();
  const initial = await cardCount(page);

  const zoomBurst = (deltaY) => page.evaluate((dy) => {
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    for (let i = 0; i < 10; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    }
  }, deltaY);

  await zoomBurst(-240); // deep in
  await expect.poll(() => cardCount(page), { timeout: 3000 }).toBeLessThan(initial);

  await zoomBurst(240);  // back out — entering cards mount during the gesture
  await expect.poll(() => cardCount(page), { timeout: 3000 }).toBe(initial);
});
