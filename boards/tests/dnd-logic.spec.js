// Pure-logic tests for the drag-into-a-board feature, driven through the
// ?dndqa=1 bridge (window.__soleilDndTest exposes boardTree + canvasGeom +
// dragMimes). No UI, no backend, deterministic.
//
// Fixture tree (parent → child):
//   root(R, parent=null)
//     A
//       A1
//     B
// All in workspace 'ws1'.
import { expect, test } from '@playwright/test';

const FIXTURE = {
  R:  { id: 'R',  workspace_id: 'ws1', parent_board_id: null, name: 'Root' },
  A:  { id: 'A',  workspace_id: 'ws1', parent_board_id: 'R',  name: 'A' },
  A1: { id: 'A1', workspace_id: 'ws1', parent_board_id: 'A',  name: 'A1' },
  B:  { id: 'B',  workspace_id: 'ws1', parent_board_id: 'R',  name: 'B' },
  X:  { id: 'X',  workspace_id: 'ws2', parent_board_id: null, name: 'OtherWs' },
};

test.beforeEach(async ({ page }) => {
  await page.goto('/?dndqa=1');
  await page.waitForFunction(() => !!window.__soleilDndTest, null, { timeout: 15000 });
});

test('isDescendantOf walks the parent chain inclusively', async ({ page }) => {
  const r = await page.evaluate((boards) => {
    const T = window.__soleilDndTest;
    return {
      selfIsDesc: T.isDescendantOf(boards, 'A', 'A'),
      a1UnderA:   T.isDescendantOf(boards, 'A1', 'A'),
      a1UnderR:   T.isDescendantOf(boards, 'A1', 'R'),
      bUnderA:    T.isDescendantOf(boards, 'B', 'A'),
    };
  }, FIXTURE);
  expect(r).toEqual({ selfIsDesc: true, a1UnderA: true, a1UnderR: true, bUnderA: false });
});

test('wouldCreateCycle blocks self + dropping onto a descendant', async ({ page }) => {
  const r = await page.evaluate((boards) => {
    const T = window.__soleilDndTest;
    return {
      self:           T.wouldCreateCycle(boards, 'A', 'A'),   // A into A
      intoDescendant: T.wouldCreateCycle(boards, 'A', 'A1'),  // A into its child
      legal:          T.wouldCreateCycle(boards, 'A', 'B'),   // A into a sibling
    };
  }, FIXTURE);
  expect(r).toEqual({ self: true, intoDescendant: true, legal: false });
});

test('planReparent filters offenders with reasons and keeps the legal ones', async ({ page }) => {
  const r = await page.evaluate((boards) => {
    const T = window.__soleilDndTest;
    // Move [A, A1, B, X, ghost] under B:
    //  A  → legal
    //  A1 → already child of A, target B is not its parent → legal (re-nest)
    //  B  → self (target) → skip 'self'
    //  X  → different workspace → skip 'cross-workspace'
    //  ghost → missing → skip 'missing'
    return T.planReparent(boards, ['A', 'A1', 'B', 'X', 'ghost'], 'B');
  }, FIXTURE);
  expect(r.movable.sort()).toEqual(['A', 'A1']);
  const byId = Object.fromEntries(r.skipped.map(s => [s.id, s.reason]));
  expect(byId).toEqual({ B: 'self', X: 'cross-workspace', ghost: 'missing' });
});

test('planReparent rejects cycles and same-parent no-ops', async ({ page }) => {
  const r = await page.evaluate((boards) => {
    const T = window.__soleilDndTest;
    const cycle = T.planReparent(boards, ['A'], 'A1');   // A under its descendant
    const noop  = T.planReparent(boards, ['A'], 'R');    // A is already under R
    return { cycle, noop };
  }, FIXTURE);
  expect(r.cycle.movable).toEqual([]);
  expect(r.cycle.skipped[0].reason).toBe('cycle');
  expect(r.noop.movable).toEqual([]);
  expect(r.noop.skipped[0].reason).toBe('same-parent');
});

test('planReparent de-dupes repeated ids', async ({ page }) => {
  const r = await page.evaluate((boards) => {
    const T = window.__soleilDndTest;
    return T.planReparent(boards, ['A', 'A', 'A'], 'B');
  }, FIXTURE);
  expect(r.movable).toEqual(['A']);
});

test('planCanvasReconcile adds missing child cards and flags stale mirrors', async ({ page }) => {
  const r = await page.evaluate((boards) => {
    const T = window.__soleilDndTest;
    // R's canvas currently shows a board card for A (correct) and one for A1
    // (STALE — A1 is a child of A, not R). B (a real child of R) has no card.
    const cards = [
      { id: 'A',  kind: 'board' },
      { id: 'A1', kind: 'board' },
      { id: 'note1', kind: 'note' },
    ];
    return T.planCanvasReconcile(boards, 'R', cards);
  }, FIXTURE);
  expect(r.addIds).toEqual(['B']);            // B is a child of R with no card
  expect(r.removeCardKeys).toEqual(['A1']);   // A1's mirror doesn't belong on R
});

test('clampDropRect keeps a card fully inside the bounds', async ({ page }) => {
  const r = await page.evaluate(() => {
    const T = window.__soleilDndTest;
    const bounds = { minX: 8, minY: 8, maxX: 1000, maxY: 800 };
    return {
      overRight:  T.clampDropRect({ x: 980, y: 100, w: 200, h: 100 }, bounds),
      overBottom: T.clampDropRect({ x: 100, y: 790, w: 200, h: 100 }, bounds),
      negative:   T.clampDropRect({ x: -50, y: -50, w: 100, h: 100 }, bounds),
      noBounds:   T.clampDropRect({ x: -50, y: -50, w: 100, h: 100 }, null),
    };
  });
  expect(r.overRight).toMatchObject({ x: 800, y: 100 });   // 1000 - 200
  expect(r.overBottom).toMatchObject({ x: 100, y: 700 });  // 800 - 100
  expect(r.negative).toMatchObject({ x: 8, y: 8 });
  expect(r.noBounds).toMatchObject({ x: 8, y: 8 });
});

test('readBoardRefIds prefers the LIST payload, falls back to single', async ({ page }) => {
  const r = await page.evaluate(() => {
    const T = window.__soleilDndTest;
    const mk = (entries) => ({ getData: (mime) => entries[mime] || '' });
    return {
      list: T.readBoardRefIds(mk({
        'application/x-soleil-board-ref-list': JSON.stringify(['b1', 'b2', 'b3']),
        'application/x-soleil-board-ref': JSON.stringify({ boardId: 'b1' }),
      })),
      single: T.readBoardRefIds(mk({
        'application/x-soleil-board-ref': JSON.stringify({ boardId: 'solo' }),
      })),
      none: T.readBoardRefIds(mk({})),
    };
  });
  expect(r.list).toEqual(['b1', 'b2', 'b3']);
  expect(r.single).toEqual(['solo']);
  expect(r.none).toEqual([]);
});

test('inboxItemToCard maps note / link / boardRef to card shapes', async ({ page }) => {
  const r = await page.evaluate(() => {
    const T = window.__soleilDndTest;
    return {
      note:  T.inboxItemToCard({ kind: 'note', body: 'hello' }, 10, 20),
      link:  T.inboxItemToCard({ kind: 'link', url: 'https://x.com', title: 'X' }, 0, 0),
      board: T.inboxItemToCard({ kind: 'boardRef', boardId: 'bX', name: 'Beta' }, 0, 0),
      none:  T.inboxItemToCard({ kind: 'nope' }, 0, 0),
    };
  });
  expect(r.note).toMatchObject({ kind: 'note', body: 'hello', x: 10, y: 20 });
  expect(r.link).toMatchObject({ kind: 'note' }); // links render as a note tile w/ escaped html
  expect(r.link.html).toContain('https://x.com');
  expect(r.board).toMatchObject({ kind: 'board', boardId: 'bX', name: 'Beta' });
  expect(r.none).toBeNull();
});
