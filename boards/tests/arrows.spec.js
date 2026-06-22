import { expect, test } from '@playwright/test';

// Smart-blend arrow routing. Drives the pure geometry bridge published under
// ?arrowqa=1 (src/lib/arrowQa.js) — same routing helpers the editor uses, plus
// the browser's exact SVG getPointAtLength sampling — so we can assert the
// load-bearing invariant ("arrows never cross cards") with zero backend.
test.describe('arrow routing (smart blend)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?arrowqa=1');
    await page.waitForFunction(() => !!window.__soleilArrowTest);
  });

  test('no arrow crosses a non-endpoint card', async ({ page }) => {
    const res = await page.evaluate(() => {
      const T = window.__soleilArrowTest;
      const { cards, arrows } = T.seedCrowded();
      return T.assertClearOfCards(cards, arrows, 2);
    });
    // Empty list keeps the failure message readable (shows the offender).
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
  });

  test('open-space hop stays a soft curve; a threaded hop becomes a clean elbow', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilArrowTest;
      const { cards, arrows } = T.seedCrowded();
      return {
        open: T.buildPathFor(cards, arrows, arrows.length - 1).path, // O1→O2, open space
        threaded: T.buildPathFor(cards, arrows, 1).path,             // P1→P2, through the 3×3 wall
      };
    });
    // Cubic bezier curves use 'C'; rounded orthogonal elbows use 'Q' (and no 'C').
    expect(r.open).toContain('C');
    expect(r.open).not.toContain('Q');
    expect(r.threaded).toContain('Q');
    expect(r.threaded).not.toContain('C');
  });

  test('attachment side is sticky under jitter, but flips on a real move', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilArrowTest;
      const arrows = [{ from: 'A', to: 'B' }];
      const key = `${T.arrowAnchorKey(arrows[0])}|from`;
      // B's top-left placed at (dx, dy) puts its center's vector from A's center
      // at exactly (dx, dy) (both cards 140×90). (200,-128) sits just inside the
      // right/top boundary → 'right'.
      const A = { id: 'A', x: 0, y: 0, w: 140, h: 90 };
      const near = (dy) => [A, { id: 'B', x: 200, y: dy, w: 140, h: 90 }];
      const a0 = T.attachmentsFor(near(-128), arrows);
      const side0 = a0.sides.get(key);
      // Nudge 4px across the raw boundary — hysteresis should HOLD the side.
      const a1 = T.attachmentsFor(near(-132), arrows, a0.sides);
      const side1 = a1.sides.get(key);
      // Move B far above A — this SHOULD flip the side to 'top'.
      const a2 = T.attachmentsFor([A, { id: 'B', x: 200, y: -400, w: 140, h: 90 }], arrows, a1.sides);
      const side2 = a2.sides.get(key);
      return { side0, side1, side2 };
    });
    expect(r.side0).toBe('right');
    expect(r.side1).toBe('right'); // sticky despite crossing the raw boundary
    expect(r.side2).toBe('top');   // a genuine move still flips it
  });

  test('an aligned open arrow bows softly instead of going dead-straight', async ({ page }) => {
    const dev = await page.evaluate(() => {
      const T = window.__soleilArrowTest;
      // Same row, clear space between → head-on attachment that WOULD be a
      // straight line without the soft bow.
      const cards = [{ id: 'A', x: 0, y: 0, w: 140, h: 90 }, { id: 'B', x: 500, y: 0, w: 140, h: 90 }];
      const arrows = [{ from: 'A', to: 'B' }];
      const att = T.attachmentsFor(cards, arrows)[0];
      const s = att.from.point, e = att.to.point;
      const pts = T.samplePath(T.buildPathFor(cards, arrows, 0).path, 100);
      const mid = pts[Math.floor(pts.length / 2)];
      const len = Math.hypot(e.x - s.x, e.y - s.y);
      const perpX = -(e.y - s.y) / len, perpY = (e.x - s.x) / len;
      // perpendicular distance of the path midpoint from the straight chord
      return Math.abs((mid.x - (s.x + e.x) / 2) * perpX + (mid.y - (s.y + e.y) / 2) * perpY);
    });
    expect(dev).toBeGreaterThan(8); // straight ≈ 0; a real bow is tens of px
  });

  test('the detour is never null (always returns a tidy route)', async ({ page }) => {
    // Box an endpoint in tightly so the simple L/Z search is stressed — the
    // hardened rails fallback must still hand back a path, not null.
    const ok = await page.evaluate(() => {
      const T = window.__soleilArrowTest;
      const cards = [
        { id: 'S', x: 0, y: 0, w: 140, h: 90 },
        { id: 'E', x: 800, y: 0, w: 140, h: 90 },
        // a dense diagonal smear of blockers across the chord
        { id: 'b1', x: 200, y: -60, w: 140, h: 90 },
        { id: 'b2', x: 360, y: -10, w: 140, h: 90 },
        { id: 'b3', x: 520, y: 40, w: 140, h: 90 },
        { id: 'b4', x: 300, y: 60, w: 140, h: 90 },
        { id: 'b5', x: 460, y: -80, w: 140, h: 90 },
      ];
      const arrows = [{ from: 'S', to: 'E' }];
      const built = T.buildPathFor(cards, arrows, 0);
      return !!(built && built.path && built.path.length > 0);
    });
    expect(ok).toBe(true);
  });
});
