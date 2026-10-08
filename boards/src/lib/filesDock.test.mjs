// Files beside the board (lib/filesDock.js): the off / panel / full model the
// topbar switch, F, ⌘K, the ⤢/⤡/× buttons and the divider all go through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCK, canDock, filesModeOf, planFilesEvent, switchSegments,
  clampWidth, dragPreview, releaseDock, readDockPrefs, writeDockPrefs,
  dockHintSeen, markDockHintSeen, collapsePath, ELLIPSIS,
  FOLDER_ROWS, folderColumns, folderCap, readFoldersExpanded, writeFoldersExpanded,
} from './filesDock.js';

test('the panel needs a desktop pane wide enough for a board and a panel', () => {
  assert.equal(canDock(DOCK.MIN + DOCK.CANVAS_MIN), true);
  assert.equal(canDock(DOCK.MIN + DOCK.CANVAS_MIN - 1), false);
  assert.equal(canDock(1400, { mobileShell: true }), false);
  assert.equal(canDock(NaN), false);
});

test('full is the stored list view; panel is an open dock with room', () => {
  assert.equal(filesModeOf({ view: 'list', dockOpen: false, canDock: true }), 'full');
  assert.equal(filesModeOf({ view: 'list', dockOpen: true, canDock: false }), 'full');
  assert.equal(filesModeOf({ view: 'canvas', dockOpen: true, canDock: true }), 'panel');
  assert.equal(filesModeOf({ view: 'canvas', dockOpen: true, canDock: false }), 'off');
  assert.equal(filesModeOf({ view: 'canvas', dockOpen: false, canDock: true }), 'off');
});

test('F toggles the panel, and falls back to full Files when there is no room', () => {
  assert.deepEqual(planFilesEvent('off', 'toggle'), { next: 'panel' });
  assert.deepEqual(planFilesEvent('off', 'toggle', { canDock: false }), { next: 'full' });
  assert.deepEqual(planFilesEvent('panel', 'toggle'), { next: 'off' });
  assert.deepEqual(planFilesEvent('full', 'toggle'), { next: 'off' });
});

test('the topbar: Board puts Files away, Files shows it or focuses its search', () => {
  assert.equal(planFilesEvent('off', 'board').next, 'off');
  assert.equal(planFilesEvent('panel', 'board').next, 'off');
  assert.equal(planFilesEvent('full', 'board').next, 'off');
  assert.deepEqual(planFilesEvent('off', 'files'), { next: 'panel' });
  assert.deepEqual(planFilesEvent('off', 'files', { canDock: false }), { next: 'full' });
  assert.deepEqual(planFilesEvent('panel', 'files'), { next: 'panel', focusSearch: true });
  assert.deepEqual(planFilesEvent('full', 'files'), { next: 'full', focusSearch: false });
});

test('expand, shrink and close only act from the mode they belong to', () => {
  assert.equal(planFilesEvent('panel', 'expand').next, 'full');
  assert.equal(planFilesEvent('off', 'expand').next, 'off');
  assert.equal(planFilesEvent('full', 'shrink').next, 'panel');
  assert.equal(planFilesEvent('full', 'shrink', { canDock: false }).next, 'full');
  assert.equal(planFilesEvent('panel', 'shrink').next, 'panel');
  assert.equal(planFilesEvent('panel', 'close').next, 'off');
  assert.equal(planFilesEvent('full', 'close').next, 'full');
  assert.equal(planFilesEvent('panel', 'nonsense').next, 'panel');
});

test('Board is pressed only when Files is away; Files whenever it shows', () => {
  assert.deepEqual(switchSegments('off'), { board: true, files: false });
  assert.deepEqual(switchSegments('panel'), { board: false, files: true });
  assert.deepEqual(switchSegments('full'), { board: false, files: true });
});

test('the panel width stays between its minimum and a usable board', () => {
  assert.equal(clampWidth(100, 1200), DOCK.MIN);
  assert.equal(clampWidth(5000, 1200), 1200 - DOCK.CANVAS_MIN);
  assert.equal(clampWidth(450.6, 1200), 451);
  assert.equal(clampWidth(undefined, 1200), DOCK.DEFAULT);
  assert.equal(clampWidth(500, 500), DOCK.MIN);
});

test('dragging the divider far enough expands; narrow enough closes', () => {
  const pane = 1000;
  assert.equal(dragPreview(700, pane), 'full');        // 70% of a 1000px pane
  assert.equal(dragPreview(650, pane), null);
  assert.equal(dragPreview(1088, 1400), 'full');       // wide pane: past the widest panel wins over 70%
  assert.equal(dragPreview(1087, 1400), null);
  assert.equal(dragPreview(DOCK.CLOSE_BELOW - 1, pane), 'close');
  assert.equal(dragPreview(400, 0), null);
  assert.deepEqual(releaseDock(800, pane), { action: 'expand' });
  assert.deepEqual(releaseDock(120, pane), { action: 'close' });
  assert.deepEqual(releaseDock(250, pane), { action: 'resize', width: DOCK.MIN });
  assert.deepEqual(releaseDock(480, pane), { action: 'resize', width: 480 });
});

test('the dock preference is device-local and survives bad storage', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(readDockPrefs(storage), { open: false, width: DOCK.DEFAULT });
  writeDockPrefs({ open: true, width: 520 }, storage);
  assert.deepEqual(readDockPrefs(storage), { open: true, width: 520 });
  mem.set('soleil.files.dock', '{not json');
  assert.deepEqual(readDockPrefs(storage), { open: false, width: DOCK.DEFAULT });
  const throwing = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  assert.deepEqual(readDockPrefs(throwing), { open: false, width: DOCK.DEFAULT });
  assert.doesNotThrow(() => writeDockPrefs({ open: true, width: 400 }, throwing));
  assert.deepEqual(readDockPrefs(null), { open: false, width: DOCK.DEFAULT });
});

test('the first-open hint shows once, and never when storage is broken', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(dockHintSeen(storage), false);
  markDockHintSeen(storage);
  assert.equal(dockHintSeen(storage), true);
  assert.equal(dockHintSeen({ getItem: () => { throw new Error('x'); } }), true);
});

test('the path bar keeps the root and the last steps, and elides the middle', () => {
  assert.deepEqual(collapsePath(['a', 'b']), ['a', 'b']);
  assert.deepEqual(collapsePath(['a', 'b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(collapsePath(['a', 'b', 'c', 'd', 'e']), ['a', ELLIPSIS, 'd', 'e']);
  assert.deepEqual(collapsePath(['a', 'b', 'c', 'd', 'e'], 4), ['a', ELLIPSIS, 'c', 'd', 'e']);
  assert.deepEqual(collapsePath([null, 'a', undefined]), ['a']);
  assert.deepEqual(collapsePath(null), []);
});

test('a panel at its widest never expands on a release that barely moved', () => {
  for (const pane of [700, 1000, 1200, 1300, 1600, 2400]) {
    const widest = clampWidth(1e6, pane);
    for (const w of [widest - 3, widest, widest + 4, widest + DOCK.CLICK_SLOP]) {
      assert.notEqual(releaseDock(w, pane).action, 'expand', `pane ${pane}, w ${w}`);
    }
  }
});

test('reveal opens Files for a file that is not on the board, and leaves an open Files alone', () => {
  assert.equal(planFilesEvent('off', 'reveal').next, 'panel');
  assert.equal(planFilesEvent('off', 'reveal', { canDock: false }).next, 'full');
  assert.equal(planFilesEvent('panel', 'reveal').next, 'panel');
  assert.equal(planFilesEvent('full', 'reveal').next, 'full');
});

test('panel folders: two rows of columns, unless only one would be hidden', () => {
  assert.equal(folderColumns(0), 1);
  assert.equal(folderColumns(FOLDER_ROWS.MIN_W), 1);
  assert.equal(folderColumns(FOLDER_ROWS.MIN_W * 2 + FOLDER_ROWS.GAP), 2);
  assert.equal(folderColumns(376), 2);            // a 400px panel, less its gutters
  assert.equal(folderCap(3, 376), 3);
  assert.equal(folderCap(4, 376), 4);
  assert.equal(folderCap(5, 376), 5);             // hiding one buys nothing
  assert.equal(folderCap(6, 376), 4);
  assert.equal(folderCap(40, 900), 10);
  assert.equal(folderCap(-1, 376), 0);
  assert.equal(folderCap('x', 376), 0);
});

test('Show all folders is remembered per device, and broken storage reads collapsed', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  assert.equal(readFoldersExpanded(storage), false);
  writeFoldersExpanded(true, storage);
  assert.equal(readFoldersExpanded(storage), true);
  writeFoldersExpanded(false, storage);
  assert.equal(readFoldersExpanded(storage), false);
  const broken = { getItem: () => { throw new Error('denied'); } };
  assert.equal(readFoldersExpanded(broken), false);
});
