// Undo/redo — bulletproof in-session UndoManager.
//
// Two layers of coverage:
//
//  1. SOURCE GUARD (Node fs, no browser) — proves the fragile "time-travel"
//     undo fallback and the History tool are gone, and the pure-UndoManager
//     wiring (captureTimeout + breakUndo + exposed undoManager) is in place.
//     These run in dev mode where there's no hashed bundle to grep.
//
//  2. ENGINE BEHAVIOR (?local=1 + window.__soleilTest.Y) — builds a Y.Doc +
//     UndoManager mirroring loadYBoard() in src/lib/yboard.js and exercises
//     the exact semantics undo relies on: create/undo/redo, one-action =
//     one-step, the stopCapturing() boundary that `breakUndo` uses, delete +
//     restore, redo cleared after a new edit, and trackedOrigins.
//
// The real keyboard handler + buildMutators integration needs Supabase auth
// (LocalBoardsApp stubs undo), so it's covered by the source guard + manual
// smoke rather than a live click-through here.

import { expect, test } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url); // boards/
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const has = (rel) => existsSync(new URL(rel, ROOT));

// ─────────────────────────── 1. Source guard ───────────────────────────────

test.describe('Undo: time-travel fallback removed (source guard)', () => {
  test('CanvasSurface has no time-travel undo machinery', () => {
    const src = read('src/components/CanvasSurface.jsx');
    expect(src).not.toMatch(
      /timeTravelUndo|timeTravelRedo|ttPointerRef|ttForwardRef|ttBusyRef|ttSnapshotTakenRef|restoreReferencedBoardsFromBytes/
    );
  });

  test('Cmd+Z / Cmd+Shift+Z route straight to mutators.undo / mutators.redo', () => {
    const src = read('src/components/CanvasSurface.jsx');
    // The keyboard handler calls the mutators directly (no canUndo()/fallback
    // gate — combined with the no-timeTravel guard above this proves the
    // two-tier fallback is gone).
    expect(src).toContain('mutators.undo?.()');
    expect(src).toContain('mutators.redo?.()');
  });

  test('boardsApi no longer exports the time-travel / history functions', () => {
    const src = read('src/lib/boardsApi.js');
    expect(src).not.toMatch(
      /export async function (fetchPrevChange|fetchNextChange|applyMetaChangeUndo|listBoardSnapshots|fetchBoardOpDensity|restoreBoardToTarget)\b/
    );
    // Kept: drag-into-board safety net + Trash recovery still need these.
    expect(src).toMatch(/export async function bulletproofRestore\b/);
    expect(src).toMatch(/export async function restoreBoard\b/);
  });
});

test.describe('History tool removed, Trash kept', () => {
  test('TimeTravelModal + snapshotPreview deleted, TrashModal added', () => {
    expect(has('src/components/TimeTravelModal.jsx')).toBe(false);
    expect(has('src/lib/snapshotPreview.js')).toBe(false);
    expect(has('src/components/TrashModal.jsx')).toBe(true);
  });

  test('App.jsx swaps History → Trash', () => {
    const app = read('src/App.jsx');
    expect(app).not.toMatch(/TimeTravelModal|historyOpen|setHistoryOpen|tb-icon-history/);
    expect(app).toMatch(/import \{ TrashModal \}/);
    expect(app).toMatch(/tb-icon-trash/);
    expect(app).toMatch(/setTrashOpen/);
  });
});

// The Y types the board UndoManager tracks — MUST match yboard.js. The
// 'scope mirror' test below extracts the real list from the source, so the
// engine-behavior simulation can never silently drift again (it once ran for
// months missing gridTemplates/gridSequences).
const UM_SCOPE = ['cards', 'arrows', 'strokes', 'groups', 'docPages', 'docPageContent', 'docBookmarks', 'docComments', 'gridTemplates', 'gridSequences'];

test.describe('UndoManager hardening wired', () => {
  test('explicit captureTimeout + tracked structures in yboard.js', () => {
    const yb = read('src/lib/yboard.js');
    expect(yb).toMatch(/captureTimeout:\s*500/);
    expect(yb).toMatch(/trackedOrigins:\s*new Set\(\['local'\]\)/);
  });

  test('spec mirror matches the real UndoManager scope (anti-drift)', () => {
    const yb = read('src/lib/yboard.js');
    const m = yb.match(/new Y\.UndoManager\(\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const real = m[1].split(',').map(s => s.trim()).filter(Boolean);
    expect(real).toEqual(UM_SCOPE);
  });

  test('App.jsx exposes undoManager + breakUndo and calls breakUndo on discrete adds', () => {
    const app = read('src/App.jsx');
    expect(app).toMatch(/const breakUndo = \(\) => \{[^}]*stopCapturing/);
    expect(app).toMatch(/undo, redo, canUndo, canRedo, undoManager, breakUndo/);
    // breakUndo is called by add/create mutators (≥ several call sites).
    const calls = (app.match(/\bbreakUndo\(\);/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(8);
  });

  test('delete boundary breaks undo at the action level (one mixed delete = one step)', () => {
    const src = read('src/components/CanvasSurface.jsx');
    // breakUndo is invoked once at the top of doDeleteSelected, NOT inside the
    // per-type leaf mutators — so a mixed delete collapses into one undo step.
    expect(src).toMatch(/doDeleteSelected = useCallback\(async \(\) => \{[\s\S]{0,600}?mutators\.breakUndo\?\.\(\)/);
  });

  test('selection is preserved across undo/redo', () => {
    const src = read('src/components/CanvasSurface.jsx');
    expect(src).toMatch(/stack-item-added/);
    expect(src).toMatch(/stack-item-popped/);
  });

  test('board delete is restored by undo/redo (not just the canvas card)', () => {
    const app = read('src/App.jsx');
    // deleteCards tags its undo step with the soft-deleted board ids…
    expect(app).toMatch(/BOARD_DELETE_META/);
    // …and undo()/redo() act on them so the board row (deleted_at) is reversed,
    // not only the Y.Doc card. This is what makes the toast + toolbar + Cmd+Z work.
    expect(app).toMatch(/restoreBoardsForUndo/);
    expect(app).toMatch(/reSoftDeleteBoardsForRedo/);
    // The list/grid delete path (no UndoManager) gets its own Undo toast.
    // (The interface says "cluster" — the rebrand left the old 'Board
    // deleted' assertion here matching nothing for months.)
    expect(app).toMatch(/['"`]Cluster deleted['"`]/);
  });
});

test.describe('Phase-0 undo hardening (source guard)', () => {
  test('split view gates the global shortcut listeners per pane', () => {
    const cs = read('src/components/CanvasSurface.jsx');
    const ls = read('src/components/ListSurface.jsx');
    // One Cmd+Z must never undo on BOTH panes — see lib/activePane.js.
    expect(cs).toMatch(/hasSplit && getActivePane\(\) !== paneId/);
    expect(ls).toMatch(/hasSplit && getActivePane\(\) !== paneId/);
    expect(has('src/lib/activePane.js')).toBe(true);
    // Both surfaces receive the pane props from App's renderSurface.
    const app = read('src/App.jsx');
    expect((app.match(/paneId=\{isMain \? 'main' : 'split'\}/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('selection restore reads the Y.Doc synchronously (no RAF race)', () => {
    const cs = read('src/components/CanvasSurface.jsx');
    // The RAF-deferred cardsRef read lost the race with useYBoard's refresh,
    // clearing the selection on undo-of-delete. The rewrite reads the doc.
    expect(cs).toMatch(/stack-item-updated/);
    const effect = cs.slice(cs.indexOf("const SEL_KEY = 'soleil-selection'"));
    expect(effect.slice(0, 2200)).not.toMatch(/requestAnimationFrame/);
    // Items minted by undo/redo themselves are not re-stamped.
    expect(cs).toMatch(/e\.origin === um/);
  });

  test('deleteCards owns its step boundaries + returns the stack item', () => {
    const app = read('src/App.jsx');
    expect(app).toMatch(/deleteCards = async \(ids, \{ boundary = true \} = \{\}\)/);
    // Awaited board soft-deletes can no longer let unrelated edits merge into
    // (and get mis-tagged by) the delete transact.
    expect(app).toMatch(/return \{ stackItem \}/);
    // Upload rollbacks are off-stack: a failed upload is not a user action.
    expect(app).toMatch(/const deleteCardsSilent = \(ids\)/);
  });

  test('upload rollbacks and async src patches stay off the undo stack', () => {
    const cs = read('src/components/CanvasSurface.jsx');
    expect(cs).toMatch(/mutators\.deleteCardsSilent\?\.\(\[id\]\)/);
    // Canvas post-upload patches use updateCardSilent (the list path always
    // did; the canvas path used to "peel" the src on Cmd+Z).
    expect(cs).toMatch(/mutators\.updateCardSilent\?\.\(id, \{ src: up\.src, pending: false \}\)/);
    expect(cs).not.toMatch(/mutators\.updateCard\?\.\(id, \{ src: up\.src, pending: false \}\)/);
  });

  test('delete toasts guard on their own stack item (lib/undoToast.js)', () => {
    expect(has('src/lib/undoToast.js')).toBe(true);
    const cs = read('src/components/CanvasSurface.jsx');
    expect(cs).toMatch(/undoToast\(feedback, \{/);
    expect(cs).toMatch(/stackItem: deleted\?\.stackItem/);
  });

  test('cluster-delete strip is NOT on the Yjs undo stack (single engine)', () => {
    const app = read('src/App.jsx');
    // Origin 'board-delete': the closure toast is the only undo affordance
    // for deleteBoardsById — with 'local' it diverged from Cmd+Z.
    expect(app).toMatch(/\}, 'board-delete'\);/);
  });

  test('doc sheet-delete has no purge timer left to race (UndoManager owns it)', () => {
    const ds = read('src/components/DocSurface.jsx');
    // Two generations of bug here: `duration:` (toast died before the purge
    // fired), then the purge timer itself (content unrecoverable at 6.5s).
    // Now the DOC_ORIGIN UndoManager reverses deletePageSheet outright.
    expect(ds).not.toMatch(/duration:\s*6000/);
    expect(ds).not.toMatch(/purgeSheetContent/);
    expect(ds).toMatch(/undoToast\(feedback, \{/);
    const dstate = read('src/lib/docState.js');
    expect(dstate).toMatch(/export function getDocUndoManager/);
    expect(dstate).not.toMatch(/export function detachPageSheet/);
  });

  test('doc overlay Escape never fires while typing', () => {
    const dc = read('src/components/DocCard.jsx');
    expect(dc).toMatch(/if \(isEditableTarget\(e\)\) return;\s*\n\s*onClose\(\);/);
  });

  test('dead history plumbing stays dead', () => {
    const yb = read('src/lib/yboard.js');
    expect(yb).not.toMatch(/export function restoreVersionInto/);
    const app = read('src/App.jsx');
    expect(app).not.toMatch(/listBoardVersions|fetchPrevVersion|fetchNextVersion/);
    const cs = read('src/components/CanvasSurface.jsx');
    expect(cs).not.toContain('History → Restore');
  });
});

// ───────────────────────── 2. Engine behavior ──────────────────────────────

async function goLocal(page) {
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await page.waitForFunction(() => !!(window.__soleilTest && window.__soleilTest.Y), null, { timeout: 20000 });
}

test.describe('Undo engine semantics (mirrors yboard.js config)', () => {
  test('create / undo / redo, one-step, boundaries, delete, redo-clear, origins', async ({ page }) => {
    await goLocal(page);

    const r = await page.evaluate(() => {
      const { Y } = window.__soleilTest;

      // Mirror loadYBoard() in src/lib/yboard.js exactly (the 'anti-drift'
      // source guard above pins this list to the real one).
      const mk = () => {
        const doc = new Y.Doc();
        const cards = doc.getMap('cards');
        const arrows = doc.getArray('arrows');
        const strokes = doc.getArray('strokes');
        const groups = doc.getMap('groups');
        const docPages = doc.getArray('docPages');
        const docPageContent = doc.getMap('docPageContent');
        const docBookmarks = doc.getMap('docBookmarks');
        const docComments = doc.getMap('docComments');
        const gridTemplates = doc.getMap('gridTemplates');
        const gridSequences = doc.getMap('gridSequences');
        const um = new Y.UndoManager(
          [cards, arrows, strokes, groups, docPages, docPageContent, docBookmarks, docComments, gridTemplates, gridSequences],
          { trackedOrigins: new Set(['local']), captureTimeout: 500 }
        );
        const addCard = (id, origin = 'local') => doc.transact(() => {
          const m = new Y.Map(); m.set('id', id); cards.set(id, m);
        }, origin);
        const moveCard = (id, x) => doc.transact(() => {
          const m = cards.get(id); if (m) m.set('x', x);
        }, 'local');
        const del = (id) => doc.transact(() => { cards.delete(id); }, 'local');
        return { doc, cards, um, addCard, moveCard, del };
      };

      const out = {};

      // (1) create → undo → redo
      {
        const { cards, um, addCard } = mk();
        addCard('c1');
        const afterAdd = cards.size;
        const stackAfterAdd = um.undoStack.length;
        um.undo();
        const afterUndo = cards.size;
        um.redo();
        const afterRedo = cards.size;
        out.createUndoRedo = { afterAdd, stackAfterAdd, afterUndo, afterRedo };
      }

      // (2) one transaction (multi-card) = one undo step
      {
        const { doc, cards, um } = mk();
        doc.transact(() => {
          for (const id of ['a', 'b', 'c']) { const m = new Y.Map(); m.set('id', id); cards.set(id, m); }
        }, 'local');
        const stackLen = um.undoStack.length;
        um.undo();
        out.oneStepMultiCard = { stackLen, afterUndo: cards.size };
      }

      // (3) stopCapturing() boundary == what breakUndo() does.
      //     Same-tick adds MERGE (captureTimeout) unless we stopCapturing.
      {
        const { um, addCard } = mk();
        addCard('m1'); addCard('m2');              // no boundary → merge
        const mergedLen = um.undoStack.length;     // expect 1
        const { um: um2, addCard: add2 } = mk();
        add2('s1'); um2.stopCapturing(); add2('s2'); // boundary → split
        const splitLen = um2.undoStack.length;     // expect 2
        out.boundary = { mergedLen, splitLen };
      }

      // (4) delete → undo restores
      {
        const { cards, um, addCard, del } = mk();
        addCard('d1'); um.stopCapturing();
        del('d1');
        const afterDelete = cards.size;
        um.undo();
        out.deleteUndo = { afterDelete, afterUndo: cards.size };
      }

      // (5) redo stack cleared after a new edit
      {
        const { um, addCard } = mk();
        addCard('x1'); um.undo();
        const redoBefore = um.redoStack.length; // 1
        addCard('x2');                            // new edit clears redo
        const redoAfter = um.redoStack.length;   // 0
        out.redoCleared = { redoBefore, redoAfter };
      }

      // (6) trackedOrigins: a non-'local' write is NOT undoable
      {
        const { um, addCard } = mk();
        addCard('snap', 'snapshot');
        out.untracked = { stackLen: um.undoStack.length }; // 0
      }

      return out;
    });

    // (1)
    expect(r.createUndoRedo.afterAdd).toBe(1);
    expect(r.createUndoRedo.stackAfterAdd).toBe(1);
    expect(r.createUndoRedo.afterUndo).toBe(0);
    expect(r.createUndoRedo.afterRedo).toBe(1);
    // (2)
    expect(r.oneStepMultiCard.stackLen).toBe(1);
    expect(r.oneStepMultiCard.afterUndo).toBe(0);
    // (3)
    expect(r.boundary.mergedLen).toBe(1);
    expect(r.boundary.splitLen).toBe(2);
    // (4)
    expect(r.deleteUndo.afterDelete).toBe(0);
    expect(r.deleteUndo.afterUndo).toBe(1);
    // (5)
    expect(r.redoCleared.redoBefore).toBe(1);
    expect(r.redoCleared.redoAfter).toBe(0);
    // (6)
    expect(r.untracked.stackLen).toBe(0);
  });

  // Mirrors the board-delete-aware undo/redo in App.jsx buildMutators: a board
  // soft-delete is a Postgres side effect the UndoManager can't reverse, so the
  // delete step is tagged with the board ids on its stack-item meta and the
  // side effect (restore / re-delete) is replayed on undo / redo. Proves the
  // engine assumptions that fix depends on: the tag is readable BEFORE the pop,
  // the opposite-stack item exists right AFTER the pop to carry the tag onto,
  // and the side effect therefore round-trips across undo→redo→undo.
  test('soft-deleted board ids round-trip through the undo stack meta', async ({ page }) => {
    await goLocal(page);

    const r = await page.evaluate(() => {
      const { Y } = window.__soleilTest;
      const BOARD_DELETE_META = 'soleil-soft-deleted-boards';

      const doc = new Y.Doc();
      const cards = doc.getMap('cards');
      const um = new Y.UndoManager([cards], { trackedOrigins: new Set(['local']), captureTimeout: 500 });

      // Side-effect logs standing in for restoreBoard() / deleteBoard().
      const restored = [];
      const redeleted = [];

      // undo()/redo() that mirror App.jsx exactly.
      const undo = () => {
        const top = um.undoStack[um.undoStack.length - 1];
        const ids = top && top.meta.get(BOARD_DELETE_META);
        um.undo();
        if (ids && ids.length) {
          const r = um.redoStack[um.redoStack.length - 1];
          if (r) r.meta.set(BOARD_DELETE_META, ids); // carry forward so redo re-deletes
          restored.push(...ids);
        }
      };
      const redo = () => {
        const top = um.redoStack[um.redoStack.length - 1];
        const ids = top && top.meta.get(BOARD_DELETE_META);
        um.redo();
        if (ids && ids.length) {
          const u = um.undoStack[um.undoStack.length - 1];
          if (u) u.meta.set(BOARD_DELETE_META, ids);
          redeleted.push(...ids);
        }
      };

      // Simulate deleteCards: add a board card, boundary, delete it, tag the step.
      doc.transact(() => { const m = new Y.Map(); m.set('id', 'b1'); m.set('kind', 'board'); cards.set('b1', m); }, 'local');
      um.stopCapturing(); // breakUndo() boundary so the delete is its own step
      doc.transact(() => { cards.delete('b1'); }, 'local');
      const top = um.undoStack[um.undoStack.length - 1];
      top.meta.set(BOARD_DELETE_META, ['b1']);

      const cardAfterDelete = cards.has('b1');   // false — card gone
      undo();
      const cardAfterUndo = cards.has('b1');     // true  — Yjs re-added the card
      const restoredAfterUndo = restored.slice();// ['b1'] — board restore fired
      redo();
      const cardAfterRedo = cards.has('b1');     // false — card removed again
      const redeletedAfterRedo = redeleted.slice(); // ['b1'] — board re-soft-deleted
      undo();
      const cardAfterUndo2 = cards.has('b1');    // true
      const restoredTotal = restored.slice();    // ['b1','b1'] — tag survived the round trip

      return {
        cardAfterDelete, cardAfterUndo, restoredAfterUndo,
        cardAfterRedo, redeletedAfterRedo, cardAfterUndo2, restoredTotal,
      };
    });

    expect(r.cardAfterDelete).toBe(false);
    expect(r.cardAfterUndo).toBe(true);
    expect(r.restoredAfterUndo).toEqual(['b1']);   // undo restores the board, not just the card
    expect(r.cardAfterRedo).toBe(false);
    expect(r.redeletedAfterRedo).toEqual(['b1']);  // redo re-deletes it
    expect(r.cardAfterUndo2).toBe(true);
    expect(r.restoredTotal).toEqual(['b1', 'b1']); // fired on BOTH undos → tag round-trips
  });
});
