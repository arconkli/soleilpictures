// surface-gallery-render.spec.js — every fixture in the gallery actually works.
//
// The wiring spec next door asserts on source shape. This one runs the real
// module in a real browser, because the failure this feature is most exposed to
// is a fixture that is wrong rather than absent: a prop renamed, a helper that
// throws, a component whose required prop moved. A registry that lists 100
// surfaces and crashes on the 40th is worse than no registry.
//
// Two depths:
//   1. every renderer is invoked — toasts fire through a stub feedback API,
//      overlays build their element (which runs the fixture code: File
//      construction, POWER_REVEALS lookups, stepsFor, prop spreading).
//   2. the surfaces that need no app context are MOUNTED, and must produce DOM.
//      That is the half that proves a fixture is right, not merely callable.
//
// The probe itself is src/local/galleryRenderProbe.js — Vite only rewrites bare
// specifiers ('react') in files it transforms, and a page.evaluate string is
// not one.
import { expect, test } from '@playwright/test';

// Mounted for real. Every one of these is standalone by design: no provider, no
// supabase read, no canvas. If a prop contract moves, this list goes red.
const MOUNTABLE = [
  'first-value-banner', 'upgrade-pill-plain', 'upgrade-pill-count', 'upgrade-pill-urgent',
  'join-editor', 'join-viewer', 'public-topbar-signed-out', 'public-topbar-remix',
  'public-topbar-signed-in', 'public-topbar-open', 'not-found', 'empty-state',
  'home-empty', 'admin-skeleton-table', 'admin-skeleton-cards', 'admin-skeleton-chart',
  'admin-error', 'admin-empty', 'chart-placeholder', 'mobile-bottom-nav',
  'billing-demo', 'billing-paid', 'billing-trialing', 'billing-trial-canceled',
  'billing-canceled', 'billing-grant', 'billing-admin',
];

test.describe('surface gallery fixtures', () => {
  test('every renderer runs, and the mountable ones produce DOM', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/?local=1&reset=1&blank=1');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async ({ mountable }) => {
      const { probeGallery } = await import('/src/local/galleryRenderProbe.js');
      return probeGallery(mountable);
    }, { mountable: MOUNTABLE });

    expect(result.missing, 'entries with no renderer').toEqual([]);
    expect(result.failures, 'renderers that threw').toEqual([]);
    // 100 overlay+toast entries today; the floor guards against the registry
    // being silently gutted rather than pinning an exact count.
    expect(result.invoked).toBeGreaterThanOrEqual(95);
    expect(result.toasts).toBeGreaterThanOrEqual(18);
    expect(result.mounted.length).toBe(MOUNTABLE.length);
    // "Produced DOM" is satisfied by an empty shell, so require substance: real
    // copy, or — for the loading skeletons, which are shimmer bars and
    // correctly have no words — real structure.
    const WORDLESS = new Set(['admin-skeleton-table', 'admin-skeleton-cards', 'admin-skeleton-chart']);
    for (const m of result.mounted) {
      if (WORDLESS.has(m.id)) {
        // The chart skeleton is the sparsest of the three — a frame and a bar.
        expect(m.nodes, `${m.id} rendered no elements`).toBeGreaterThan(1);
      } else {
        expect(m.chars, `${m.id} rendered no text`).toBeGreaterThan(0);
      }
    }
    expect(errors, 'uncaught page errors').toEqual([]);
  });
});
