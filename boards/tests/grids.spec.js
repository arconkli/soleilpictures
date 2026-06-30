import { expect, test } from '@playwright/test';

// Grids — the modular grid-template card. Drives the pure grid bridge published
// under ?gridqa=1 (src/lib/gridQa.js) — the same gridLayout / gridSequence math
// the editor uses — so we can assert the load-bearing behaviour (exact cell
// tiling, the shared-edge divider constraint, split/merge invariants, spatial
// sequence ordering + auto-renumber on insert, label resolution) with zero
// backend.

test.describe('grids — fraction-tree layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?gridqa=1');
    await page.waitForFunction(() => !!window.__soleilGridTest);
  });

  test('the storyboard preset tiles its box exactly (no gap / no overlap)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      const rects = T.computeCellRects(T.seedGridLayout(), { x: 0, y: 0, w: 400, h: 300 });
      const by = Object.fromEntries(rects.map((c) => [c.id, c]));
      const area = rects.reduce((s, c) => s + c.w * c.h, 0);
      return { n: rects.length, top: by.c1, bL: by.c2, bR: by.c3, area };
    });
    expect(r.n).toBe(3);
    // top spans the full width, half the height
    expect(r.top).toMatchObject({ x: 0, y: 0 });
    expect(r.top.w).toBeCloseTo(400, 5);
    expect(r.top.h).toBeCloseTo(150, 5);
    // two bottom cells split the lower half
    expect(r.bL).toMatchObject({ x: 0 });
    expect(r.bL.y).toBeCloseTo(150, 5);
    expect(r.bL.w).toBeCloseTo(200, 5);
    expect(r.bR.x).toBeCloseTo(200, 5);
    expect(r.bR.w).toBeCloseTo(200, 5);
    // areas sum to the whole box → exact tiling
    expect(r.area).toBeCloseTo(400 * 300, 3);
  });

  test('dragging a divider adjusts only the two adjacent cells, conserving their sum', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      // bottom row is at path [1]; its only divider is childIndex 0 (between c2/c3)
      const next = T.resizeDivider(T.seedGridLayout(), [1], 0, 0.1);
      const row = next.children[1];
      return { a: row.children[0].frac, b: row.children[1].frac };
    });
    expect(r.a).toBeCloseTo(0.6, 6);
    expect(r.b).toBeCloseTo(0.4, 6);
    expect(r.a + r.b).toBeCloseTo(1, 6);
  });

  test('over-dragging a divider clamps at MIN_FRAC, never collapsing a cell', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      const next = T.resizeDivider(T.seedGridLayout(), [1], 0, 5); // absurd delta
      const row = next.children[1];
      return { a: row.children[0].frac, b: row.children[1].frac, min: T.GRID_TUNING.MIN_FRAC };
    });
    expect(r.b).toBeCloseTo(r.min, 6);
    expect(r.a).toBeCloseTo(1 - r.min, 6);
  });

  test('splitting a cell adds exactly one new unique leaf', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      const next = T.splitCell(T.seedGridLayout(), 'c1', 'row');
      const ids = T.leafIds(next);
      return { ids, unique: new Set(ids).size };
    });
    expect(r.ids).toHaveLength(4);
    expect(r.unique).toBe(4);
    expect(r.ids).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']));
  });

  test('merging a cell removes it, collapses the leftover split, and stays unique', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      const { tree, removedIds } = T.mergeCell(T.seedGridLayout(), 'c2');
      const ids = T.leafIds(tree);
      return { ids, removedIds, unique: new Set(ids).size };
    });
    expect(r.removedIds).toContain('c2');
    expect(r.ids).toEqual(['c1', 'c3']);
    expect(r.unique).toBe(2);
  });
});

test.describe('grids — spatial sequence ordering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?gridqa=1');
    await page.waitForFunction(() => !!window.__soleilGridTest);
  });

  test('Z / snake / N patterns read the matrix in the right order', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      const m = T.seedGridMatrix(3, 2);
      return {
        z: T.spatialOrder(m, 'z'),
        snake: T.spatialOrder(m, 'snake'),
        n: T.spatialOrder(m, 'n'),
      };
    });
    expect(r.z).toEqual(['g0_0', 'g0_1', 'g0_2', 'g1_0', 'g1_1', 'g1_2']);
    expect(r.snake).toEqual(['g0_0', 'g0_1', 'g0_2', 'g1_2', 'g1_1', 'g1_0']);
    expect(r.n).toEqual(['g0_0', 'g1_0', 'g0_1', 'g1_1', 'g0_2', 'g1_2']);
  });

  test('inserting a Grid between two others auto-renumbers everything after it', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      const m = T.seedGridMatrix(3, 2);
      // drop a Grid into row 0, spatially between col 0 and col 1
      m.push({ id: 'INS', x: 110, y: 0, w: 200, h: 150 });
      const order = T.spatialOrder(m, 'z');
      return { insAt: order.indexOf('INS'), oldFirst: order.indexOf('g0_1'), order };
    });
    expect(r.insAt).toBe(1);           // the new Grid becomes #2 (index 1)
    expect(r.oldFirst).toBe(2);        // the old #2 shifted to #3 (index 2)
  });
});

test.describe('grids — label variables', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?gridqa=1');
    await page.waitForFunction(() => !!window.__soleilGridTest);
  });

  test('labelFor renders number / padded / alpha with prefix + startAt', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      return {
        shot: T.labelFor(3, { prefix: 'SHOT ', style: 'num', startAt: 1 }),
        pad: T.labelFor(3, { style: 'pad2' }),
        alpha: T.labelFor(3, { style: 'alpha' }),
        roll: T.labelFor(26, { style: 'alpha' }),                  // 1 + 26 = 27 → AA
        wrap: T.labelFor(27, { style: 'alpha', startAt: 1 }),       // 1 + 27 = 28 → AB
      };
    });
    expect(r.shot).toBe('SHOT 4');
    expect(r.pad).toBe('04');
    expect(r.alpha).toBe('D');
    expect(r.roll).toBe('AA');
    expect(r.wrap).toBe('AB');
  });

  test('resolveTagText substitutes every inline tag in a cell', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      return {
        both: T.resolveTagText('Scene [#][A]', { index: 3, format: { startAt: 1 } }),
        padded: T.resolveTagText('Shot [##]', { index: 8, format: { startAt: 1 } }),
        none: T.resolveTagText('No tags here', { index: 0 }),
        has: T.hasLabelTag('Action [#]'),
        hasnot: T.hasLabelTag('Action'),
      };
    });
    expect(r.both).toBe('Scene 4D');
    expect(r.padded).toBe('Shot 09');
    expect(r.none).toBe('No tags here');
    expect(r.has).toBe(true);
    expect(r.hasnot).toBe(false);
  });

  // Guard that the shipped GRID_TUNING keeps a usable min cell + divider.
  test('shipped GRID_TUNING is sane', async ({ page }) => {
    const t = await page.evaluate(() => window.__soleilGridTest.GRID_TUNING);
    expect(t.MIN_FRAC).toBeGreaterThan(0);
    expect(t.MIN_FRAC).toBeLessThan(0.5);
    expect(Number.isFinite(t.DIVIDER_PX)).toBe(true);
    expect(Number.isFinite(t.EDGE_ADD_ZONE_PX)).toBe(true);
  });
});
