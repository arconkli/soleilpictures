import { expect, test } from '@playwright/test';

// Snap / alignment guides. Drives the pure snap bridge published under ?alignqa=1
// (src/lib/snapQa.js) — the same buildSnapTargets / computeSnap / computeResizeSnap
// the editor uses — so we can assert the load-bearing behaviour (far cards don't
// trigger guides, collinear lines dedupe, equal-size resize draws a dual caliper)
// with zero backend.
//
// Tests pass an explicit `tuning` so the REAL culling/dedup/caliper behaviour is
// verified even while the shipped SNAP_TUNING keeps those knobs inert. Infinity
// can't cross the page.evaluate boundary (serializes to null), so the "inert"
// config uses a large FINITE value, which is functionally no-cull.
const REAL = { VIEWPORT_MARGIN_PX: 200, PROXIMITY_PX: 400, COLLINEAR_EPS_PX: 1, TIE_EPS_PX: 0.5, SIZE_GUIDE: 'caliper' };
const INERT = { VIEWPORT_MARGIN_PX: 1e9, PROXIMITY_PX: 1e9, COLLINEAR_EPS_PX: 0, TIE_EPS_PX: 0, SIZE_GUIDE: 'caliper' };
const BIG_VP = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };

test.describe('snap alignment guides', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?alignqa=1');
    await page.waitForFunction(() => !!window.__soleilAlignTest);
  });

  test('a far off-board card never enters the candidate pool (viewport gate)', async ({ page }) => {
    const r = await page.evaluate((cfg) => {
      const T = window.__soleilAlignTest;
      const { cards } = T.seedSnapLayout();
      // Viewport shows the origin cluster but excludes FAR (6000,4000).
      const vp = { x0: -2000, y0: -2000, x1: 3000, y1: 3500 };
      const t = T.targetsFor(cards, 'A', vp, 1, T.tuning(cfg.REAL));
      return {
        hasFarX: t.targetsX.some((tx) => tx.coord > 3000),
        hasFarY: t.targetsY.some((ty) => ty.coord > 3500),
      };
    }, { REAL });
    expect(r.hasFarX).toBe(false);
    expect(r.hasFarY).toBe(false);
  });

  test('a coordinally-aligned but distant card produces no guide (proximity gate)', async ({ page }) => {
    const r = await page.evaluate((cfg) => {
      const T = window.__soleilAlignTest;
      const { cards } = T.seedSnapLayout();
      // Drag A's left edge onto LONE's x (=-500) — LONE is the ONLY card there
      // but 3000px away on Y.
      const real = T.moveSnap(cards, 'A', -500, 0, cfg.BIG_VP, 1, T.tuning(cfg.REAL));
      const inert = T.moveSnap(cards, 'A', -500, 0, cfg.BIG_VP, 1, T.tuning(cfg.INERT));
      return {
        realHasGuide: !!(real.hints && real.hints.xs.length),
        inertHasGuide: !!(inert.hints && inert.hints.xs.length),
        inertX: inert.hints?.xs?.[0]?.x,
      };
    }, { REAL, INERT, BIG_VP });
    expect(r.inertHasGuide).toBe(true);  // without the gate, the far card guides
    expect(r.inertX).toBe(-500);
    expect(r.realHasGuide).toBe(false);  // WITH the gate, it does not
  });

  test('near-collinear cards merge to a single guide line (dedup)', async ({ page }) => {
    const r = await page.evaluate((cfg) => {
      const T = window.__soleilAlignTest;
      const { cards } = T.seedSnapLayout();
      const near0 = (t) => t.targetsX.filter((tx) => Math.abs(tx.coord) <= 1).length;
      return {
        real: near0(T.targetsFor(cards, 'P1', cfg.BIG_VP, 1, T.tuning(cfg.REAL))),
        inert: near0(T.targetsFor(cards, 'P1', cfg.BIG_VP, 1, T.tuning(cfg.INERT))),
      };
    }, { REAL, INERT, BIG_VP });
    // A(0), B(0), Bd(0.4) sit on x≈0. eps=1 collapses them to ONE target;
    // exact-merge keeps 0 and 0.4 as two.
    expect(r.real).toBe(1);
    expect(r.inert).toBeGreaterThan(1);
  });

  test('aligning to a nearby card draws one edge guide and snaps the delta', async ({ page }) => {
    const r = await page.evaluate((cfg) => {
      const T = window.__soleilAlignTest;
      const { cards } = T.seedSnapLayout();
      // Drag B; nudge its left 3px off A's left (x=0) — inside the 6px threshold.
      const snap = T.moveSnap(cards, 'B', 3, 0, cfg.BIG_VP, 1, T.tuning(cfg.REAL));
      return { dx: snap.dx, xs: snap.hints?.xs?.length || 0, x: snap.hints?.xs?.[0]?.x };
    }, { REAL, BIG_VP });
    expect(r.xs).toBe(1);
    expect(r.x).toBe(0);
    expect(r.dx).toBe(0);
  });

  test('dragging into an existing 24px rhythm shows a spacing marker', async ({ page }) => {
    const r = await page.evaluate((cfg) => {
      const T = window.__soleilAlignTest;
      const { cards } = T.seedSnapLayout();
      // P1(300..420) P2(444..564) are 24px apart in a row. Drag PD so its left
      // lands at the "extend right" target = P2.right(564) + gap(24) = 588;
      // PD starts at x=300 → rawDx 288.
      const snap = T.moveSnap(cards, 'PD', 288, 0, cfg.BIG_VP, 1, T.tuning(cfg.REAL));
      const sp = snap.hints?.spacings || [];
      return { count: sp.length, gap: sp[0]?.gap, axis: sp[0]?.axis };
    }, { REAL, BIG_VP });
    expect(r.count).toBeGreaterThanOrEqual(1);
    expect(r.gap).toBe(24);
    expect(r.axis).toBe('x');
  });

  test('resizing to a nearby card width draws a dual size caliper', async ({ page }) => {
    const r = await page.evaluate((cfg) => {
      const T = window.__soleilAlignTest;
      const { cards } = T.seedSnapLayout();
      // RZ is 120 wide; S1 (near) is 160 wide. Resize RZ by +40 → candW 160.
      const snap = T.resizeSnap(cards, 'RZ', 40, 0, cfg.BIG_VP, 1, T.tuning(cfg.REAL));
      const sizes = snap.hints?.sizes || [];
      return { dw: snap.dw, count: sizes.length, axis: sizes[0]?.axis, value: sizes[0]?.value, bars: sizes[0]?.bars?.length };
    }, { REAL, BIG_VP });
    expect(r.dw).toBe(40);     // snapped exactly to 160
    expect(r.count).toBe(1);
    expect(r.axis).toBe('w');
    expect(r.value).toBe(160);
    expect(r.bars).toBe(2);    // a caliper on the resized card AND on S1
  });

  test('resizing to match only a FAR card size shows no size guide (proximity)', async ({ page }) => {
    const r = await page.evaluate((cfg) => {
      const T = window.__soleilAlignTest;
      const { cards } = T.seedSnapLayout();
      // Resize RZ by +80 → candW 200. Only Sf (far) is 200 wide; S1 is 160.
      const real = T.resizeSnap(cards, 'RZ', 80, 0, cfg.BIG_VP, 1, T.tuning(cfg.REAL));
      const inert = T.resizeSnap(cards, 'RZ', 80, 0, cfg.BIG_VP, 1, T.tuning(cfg.INERT));
      return {
        realSizes: real.hints?.sizes?.length || 0,
        realDw: real.dw,
        inertHasMatch: !!(inert.hints && (inert.hints.sizes.length || inert.hints.ys.length)),
      };
    }, { REAL, INERT, BIG_VP });
    expect(r.realSizes).toBe(0);   // Sf culled → no caliper
    expect(r.realDw).toBe(80);     // and no snap pulled it to 200
    expect(r.inertHasMatch).toBe(true); // without the gate, the far card matches
  });

  // Flips green once the shipped SNAP_TUNING enables culling (the follow-up
  // commit). Until then the shipped knobs are intentionally inert.
  test.fixme('shipped SNAP_TUNING enables culling + caliper (flip guard)', async ({ page }) => {
    const t = await page.evaluate(() => window.__soleilAlignTest.SNAP_TUNING);
    expect(Number.isFinite(t.VIEWPORT_MARGIN_PX)).toBe(true);
    expect(Number.isFinite(t.PROXIMITY_PX)).toBe(true);
    expect(t.COLLINEAR_EPS_PX).toBeGreaterThan(0);
    expect(t.SIZE_GUIDE).toBe('caliper');
  });
});
