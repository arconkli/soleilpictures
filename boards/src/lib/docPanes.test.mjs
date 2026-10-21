// Two docs side by side (the owner's ask, 2026-10-20): with a doc docked in the
// split pane, opening any other doc (a double-click, a double tap, a jump to
// it) puts it in the left half, where the canvas was, so two docs can be read
// at once. The dock button still swaps what is docked. × on either one brings
// the canvas back: the docked one going hands the dock to the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  NO_DOC_PANES, openBesideDock, dockDoc, closeDock, closeBeside, mainPaneMoved, docPanesSummary,
  sidebarShown, toggleSidebar,
} from './docPanes.js';

const brief = { cardId: 'brief', boardId: 'b1' };
const script = { cardId: 'script', boardId: 'b1' };
const notes = { cardId: 'notes', boardId: 'b2' };

test('with nothing docked, an open is not the panes\' business', () => {
  assert.equal(openBesideDock(NO_DOC_PANES, brief), null);
});

test('with a doc docked, another doc opens beside it, from this cluster or another', () => {
  const docked = dockDoc(NO_DOC_PANES, brief);
  assert.deepEqual(openBesideDock(docked, script), { dock: brief, beside: script });
  assert.deepEqual(openBesideDock(docked, notes), { dock: brief, beside: notes });
});

test('opening the docked doc again changes nothing', () => {
  const docked = dockDoc(NO_DOC_PANES, brief);
  assert.equal(openBesideDock(docked, { ...brief }), docked);
});

test('a third doc takes the place beside, the docked one stays', () => {
  const two = openBesideDock(dockDoc(NO_DOC_PANES, brief), script);
  assert.deepEqual(openBesideDock(two, notes), { dock: brief, beside: notes });
});

test('docking swaps what is docked; the doc beside stays, unless it is the one docked', () => {
  const two = openBesideDock(dockDoc(NO_DOC_PANES, brief), script);
  assert.deepEqual(dockDoc(two, notes), { dock: notes, beside: script });
  assert.deepEqual(dockDoc(two, script), { dock: script, beside: null });
});

test('× on the doc beside brings the canvas back, the docked one stays', () => {
  const two = openBesideDock(dockDoc(NO_DOC_PANES, brief), script);
  assert.deepEqual(closeBeside(two), { dock: brief, beside: null });
});

test('× on the docked doc brings the canvas back too: the one beside moves into the dock', () => {
  const two = openBesideDock(dockDoc(NO_DOC_PANES, brief), script);
  assert.deepEqual(closeDock(two), { dock: script, beside: null });
  assert.deepEqual(closeDock(dockDoc(NO_DOC_PANES, brief)), NO_DOC_PANES);
});

test('the main pane going to another cluster takes the doc beside with it', () => {
  const two = openBesideDock(dockDoc(NO_DOC_PANES, brief), script);
  assert.deepEqual(mainPaneMoved(two, { boardId: 'b1', view: 'canvas' }), two, 'same cluster: stays');
  assert.deepEqual(mainPaneMoved(two, { boardId: 'b2', view: 'canvas' }), { dock: brief, beside: null });
});

test('the main pane opening its Files page takes the doc beside with it, which would hide the page', () => {
  const two = openBesideDock(dockDoc(NO_DOC_PANES, brief), script);
  assert.deepEqual(mainPaneMoved(two, { boardId: 'b1', view: 'list' }), { dock: brief, beside: null });
  const one = dockDoc(NO_DOC_PANES, brief);
  assert.equal(mainPaneMoved(one, { boardId: 'b2', view: 'list' }), one, 'nothing beside: nothing moves');
});

test('the summary says how many docs are open beside the canvas', () => {
  assert.equal(docPanesSummary(NO_DOC_PANES), 0);
  assert.equal(docPanesSummary(dockDoc(NO_DOC_PANES, brief)), 1);
  assert.equal(docPanesSummary(openBesideDock(dockDoc(NO_DOC_PANES, brief), script)), 2);
});

// The sidebar tucks away while two docs are open, so each gets half the
// window. Its button and ⌘B bring it back for as long as both stay open, and
// nothing is stored: it is as it was when one of them closes.
test('two docs open: the sidebar tucks away, and comes back when one closes', () => {
  assert.equal(sidebarShown({ open: true, twoDocs: true, askedBack: false }), false);
  assert.equal(sidebarShown({ open: true, twoDocs: false, askedBack: false }), true);
  assert.equal(sidebarShown({ open: false, twoDocs: false, askedBack: false }), false);
});

test('two docs open: the toggle brings the sidebar back and tucks it again, storing nothing', () => {
  const tucked = { open: true, twoDocs: true, askedBack: false };
  const back = toggleSidebar(tucked);
  assert.deepEqual(back, { open: true, askedBack: true });
  assert.equal(sidebarShown({ ...back, twoDocs: true }), true);
  assert.deepEqual(toggleSidebar({ ...back, twoDocs: true }), { open: true, askedBack: false });
});

test('two docs open with the sidebar closed already: the toggle opens it', () => {
  const next = toggleSidebar({ open: false, twoDocs: true, askedBack: false });
  assert.deepEqual(next, { open: true, askedBack: true });
  assert.equal(sidebarShown({ ...next, twoDocs: true }), true);
});

test('one doc or none: the toggle is the sidebar\'s own', () => {
  assert.deepEqual(toggleSidebar({ open: true, twoDocs: false, askedBack: false }), { open: false, askedBack: false });
  assert.deepEqual(toggleSidebar({ open: false, twoDocs: false, askedBack: false }), { open: true, askedBack: false });
});

// How App and the canvas wire it in, read from the source.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

test('App opens a doc beside the docked one only from the main pane\'s board, and never on a phone', () => {
  const app = read('App.jsx');
  // A phone's halves are too narrow to read two docs in: there the doc opened
  // takes the dock, as it always did.
  assert.match(app, /onOpenBesideDoc=\{isMain && splitDoc && !isPhone \? /);
  // Over the main pane's board, which stays mounted under it.
  assert.match(app, /\{besideDoc && splitDoc && renderBesideDoc\(\)\}/);
  // And it goes when the main pane leaves that board, for another cluster or
  // its Files page.
  assert.match(app, /mainPaneMoved\(\{ dock: splitDoc, beside: besideDoc \}, \{ boardId: currentId, view \}\)/);
});

test('the canvas offers it to every doc card but the docked one', () => {
  assert.match(read('components/CanvasSurface.jsx'),
    /onOpenBeside=\{onOpenBesideDoc && dockedDocCardId && dockedDocCardId !== c\.id \? onOpenBesideDoc : null\}/);
});
