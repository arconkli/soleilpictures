// A cluster's copy can be replaced under a doc someone has open: a version
// restore, cards moved into the cluster, a repair after a sync error. The
// cluster reloads and every card on it with it, so the doc used to vanish
// mid-sentence and come back closed and older, with no word of why, and the
// last keys typed before the reload landed went with the old copy.
// lib/docResets.js keeps what the page held and decides what the doc says;
// doc-reset.spec drives it through the real doc.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import {
  RELOAD_EVENT, announceBoardReload, markLocalReset, noteBoardRestored,
  noteDocReset, refreshDocReset, settleDocReset, settleOrphanedDocResets,
  noteReopen, reopenMode, clearReopen, lostWriting, resetNotice, stashKey,
} from './docResets.js';
import { addPage, cardScope, initCardDocStore, getOrCreatePageContent, readPageBlocks } from './docState.js';

// The toasts a doc would show, and what it put on the clipboard.
function harness() {
  const toasts = [];
  const copied = [];
  const feedback = {
    toast: (t) => { toasts.push({ ...t, dismissed: false }); const i = toasts.length - 1; return () => { toasts[i].dismissed = true; }; },
  };
  const copy = async (c) => { copied.push(c); return true; };
  return { toasts, copied, feedback, copy };
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

let n = 0;
// A doc on a cluster, open on a page, with what that page holds.
const open = (over = {}) => {
  n += 1;
  return {
    boardId: `board-${n}`, cardId: `card-${n}`, pageId: `page-${n}`, title: 'Pilot',
    reason: 'restore', canEdit: true,
    blocks: ['INT. CAFE - NIGHT', 'Rain on the glass.'],
    text: 'INT. CAFE - NIGHT\n\nRain on the glass.',
    html: '<p>INT. CAFE - NIGHT</p><p>Rain on the glass.</p>',
    ...over,
  };
};

test('a restore by someone else says so as the doc goes, and again, in its place, once it is back', () => {
  const h = harness();
  const e = open();
  noteDocReset(e, { feedback: h.feedback, now: 1000 });
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].message, 'This cluster was restored to an earlier version — reopening the doc.');
  assert.equal(h.toasts[0].group, `doc-reset:${e.cardId}`);

  const shown = settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => [...e.blocks], feedback: h.feedback, copy: h.copy, now: 2500 });
  assert.equal(h.toasts.length, 2);
  // Same group: it takes the first one's place rather than stacking under it.
  assert.equal(h.toasts[1].group, `doc-reset:${e.cardId}`);
  assert.equal(h.toasts[1].message, 'This cluster was restored to an earlier version.');
  assert.equal(h.toasts[1].action ?? null, null);
  assert.equal(shown.lost, false);
  // Settled once: a second mount of the doc says nothing more.
  assert.equal(settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => [], feedback: h.feedback, now: 2600 }), null);
  assert.equal(h.toasts.length, 2);
});

test('what the restore took off the page can be copied back, as it was', async () => {
  const h = harness();
  const e = open({
    blocks: ['Rain on the glass.', 'She counts the drops, then stops.'],
    text: 'Rain on the glass.\n\nShe counts the drops, then stops.',
    html: '<p>Rain on the glass.</p><p>She counts the drops, then stops.</p>',
  });
  noteDocReset(e, { feedback: h.feedback, now: 1000 });
  settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => ['Rain on the glass.'], feedback: h.feedback, copy: h.copy, now: 2000 });
  const t = h.toasts.at(-1);
  assert.equal(t.message, 'This cluster was restored to an earlier version, which changed this page.');
  assert.equal(t.type, 'warning');
  assert.equal(t.action.label, 'Copy what you had');
  await t.action.onClick();
  assert.deepEqual(h.copied, [{ text: e.text, html: e.html }]);
  assert.equal(h.toasts.at(-1).message, 'Copied — paste it anywhere.');
});

test('keys typed after the reload was announced, before the doc went, are in what it hands back', async () => {
  const h = harness();
  const e = open({ blocks: ['First line.'], text: 'First line.', html: '<p>First line.</p>' });
  noteDocReset(e, { feedback: h.feedback, now: 1000 });
  refreshDocReset(e.cardId, {
    blocks: ['First line. Typed while it reloads.'],
    text: 'First line. Typed while it reloads.',
    html: '<p>First line. Typed while it reloads.</p>',
  });
  settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => ['First line.'], feedback: h.feedback, copy: h.copy, now: 2000 });
  await h.toasts.at(-1).action.onClick();
  assert.equal(h.copied[0].text, 'First line. Typed while it reloads.');
});

test('a restore made here stays quiet unless the page you had open changed', () => {
  const h = harness();
  const quiet = open();
  markLocalReset(quiet.boardId, 900);
  noteDocReset(quiet, { feedback: h.feedback, now: 1000 });
  assert.equal(h.toasts.length, 0, 'Version history already says it restored');
  settleDocReset({ boardId: quiet.boardId, cardId: quiet.cardId, pageBlocks: () => [...quiet.blocks], feedback: h.feedback, now: 2000 });
  assert.equal(h.toasts.length, 0);

  const changed = open();
  markLocalReset(changed.boardId, 900);
  noteDocReset(changed, { feedback: h.feedback, now: 1000 });
  settleDocReset({ boardId: changed.boardId, cardId: changed.cardId, pageBlocks: () => ['INT. CAFE - NIGHT'], feedback: h.feedback, copy: h.copy, now: 2000 });
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].message, 'The restore changed the page you had open.');
  assert.equal(h.toasts[0].action.label, 'Copy what you had');
  // Long after, it is someone else's again.
  const later = open();
  markLocalReset(later.boardId, 900);
  noteDocReset(later, { feedback: h.feedback, now: 900 + 120_000 });
  assert.equal(h.toasts.at(-1).message, 'This cluster was restored to an earlier version — reopening the doc.');
});

test('a reset that turns out to be a restore is told as one', () => {
  const h = harness();
  const e = open({ reason: 'reset' });
  noteDocReset(e, { feedback: h.feedback, now: 1000 });
  assert.equal(h.toasts[0].message, 'This cluster was updated elsewhere — reopening the doc.');
  noteBoardRestored(e.boardId, 1300);
  settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => [...e.blocks], feedback: h.feedback, now: 2000 });
  assert.equal(h.toasts.at(-1).message, 'This cluster was restored to an earlier version.');

  const moved = open({ reason: 'reset' });
  noteDocReset(moved, { feedback: h.feedback, now: 5000 });
  settleDocReset({ boardId: moved.boardId, cardId: moved.cardId, pageBlocks: () => ['INT. CAFE - NIGHT'], feedback: h.feedback, now: 6000 });
  assert.equal(h.toasts.at(-1).message, 'This cluster was updated elsewhere and reloaded, and your last edits on this page didn’t make it.');
});

test('a doc the reloaded cluster does not have says so, with what it held', async () => {
  const h = harness();
  const gone = open();
  const kept = open({ boardId: gone.boardId });
  noteDocReset(gone, { feedback: h.feedback, now: 1000 });
  noteDocReset(kept, { feedback: h.feedback, now: 1000 });
  const shown = settleOrphanedDocResets({ boardId: gone.boardId, hasCard: (id) => id === kept.cardId, feedback: h.feedback, copy: h.copy, now: 2000 });
  assert.equal(shown.length, 1);
  const t = h.toasts.at(-1);
  assert.equal(t.group, `doc-reset:${gone.cardId}`);
  assert.equal(t.message, 'This cluster was restored to a version from before “Pilot” existed.');
  await t.action.onClick();
  assert.equal(h.copied[0].text, gone.text);
  // The one still there is left for its own doc to tell.
  assert.ok(settleDocReset({ boardId: kept.boardId, cardId: kept.cardId, pageBlocks: () => [...kept.blocks], feedback: h.feedback, now: 2100 }));
  // An untitled doc, emptied by nobody: no copy to offer.
  const blank = open({ title: '', blocks: [], text: '', html: '' });
  noteDocReset(blank, { feedback: h.feedback, now: 3000 });
  settleOrphanedDocResets({ boardId: blank.boardId, hasCard: () => false, feedback: h.feedback, copy: h.copy, now: 3500 });
  assert.equal(h.toasts.at(-1).message, 'This cluster was restored to a version from before this doc existed.');
  assert.equal(h.toasts.at(-1).action ?? null, null);
});

test('the doc back without the page you were on says so', () => {
  const h = harness();
  const e = open();
  noteDocReset(e, { feedback: h.feedback, now: 1000 });
  settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => null, feedback: h.feedback, copy: h.copy, now: 2000 });
  assert.equal(h.toasts.at(-1).message, 'This cluster was restored to an earlier version, without the page you were on.');
  assert.equal(h.toasts.at(-1).action.label, 'Copy what you had');
});

test('a repair after a sync error only speaks for a page that lost something', () => {
  const h = harness();
  const fine = open({ reason: 'heal' });
  noteDocReset(fine, { feedback: h.feedback, now: 1000 });
  settleDocReset({ boardId: fine.boardId, cardId: fine.cardId, pageBlocks: () => [...fine.blocks], feedback: h.feedback, now: 2000 });
  assert.equal(h.toasts.length, 0, 'the workspace already says it hit a sync error');
  const lost = open({ reason: 'heal' });
  noteDocReset(lost, { feedback: h.feedback, now: 1000 });
  settleDocReset({ boardId: lost.boardId, cardId: lost.cardId, pageBlocks: () => [], feedback: h.feedback, copy: h.copy, now: 2000 });
  assert.equal(h.toasts.at(-1).message, 'Your last edits on this page didn’t make it through the sync error.');
});

test('a reader is told what happened, with nothing of theirs to copy', () => {
  const h = harness();
  const e = open({ canEdit: false });
  noteDocReset(e, { feedback: h.feedback, now: 1000 });
  assert.equal(localStorage.getItem(stashKey(e.cardId)), null);
  settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => [], feedback: h.feedback, now: 2000 });
  assert.equal(h.toasts.at(-1).message, 'This cluster was restored to an earlier version.');
  assert.equal(h.toasts.at(-1).action ?? null, null);
});

test('the page as it was stays on this device until it is known nothing was lost', () => {
  const h = harness();
  const kept = open();
  noteDocReset(kept, { feedback: h.feedback, now: 1000 });
  const stash = JSON.parse(localStorage.getItem(stashKey(kept.cardId)));
  assert.equal(stash.text, kept.text);
  assert.equal(stash.boardId, kept.boardId);
  settleDocReset({ boardId: kept.boardId, cardId: kept.cardId, pageBlocks: () => ['INT. CAFE - NIGHT'], feedback: h.feedback, now: 2000 });
  assert.ok(localStorage.getItem(stashKey(kept.cardId)), 'lost: the stash stays');
  const same = open();
  noteDocReset(same, { feedback: h.feedback, now: 1000 });
  settleDocReset({ boardId: same.boardId, cardId: same.cardId, pageBlocks: () => [...same.blocks], feedback: h.feedback, now: 2000 });
  assert.equal(localStorage.getItem(stashKey(same.cardId)), null, 'nothing lost: nothing to keep');
});

test('a second reload close behind the first keeps the copy the first one offered', async () => {
  const h = harness();
  const e = open({ blocks: ['Rain on the glass.', 'A line the restore takes.'], text: 'Rain on the glass.\n\nA line the restore takes.' });
  noteDocReset(e, { feedback: h.feedback, now: 1000 });
  settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => ['Rain on the glass.'], feedback: h.feedback, copy: h.copy, now: 2000 });
  // The restore is noticed again (a slower signal), and the doc reloads onto
  // what it already shows.
  noteDocReset({ ...e, blocks: ['Rain on the glass.'], text: 'Rain on the glass.', html: '<p>Rain on the glass.</p>' }, { feedback: h.feedback, now: 9000 });
  settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => ['Rain on the glass.'], feedback: h.feedback, copy: h.copy, now: 10000 });
  const t = h.toasts.at(-1);
  assert.equal(t.message, 'This cluster was restored to an earlier version, which changed this page.');
  await t.action.onClick();
  assert.equal(h.copied[0].text, e.text);
});

test('only the doc that comes back settles a reload, not the one still going', () => {
  const h = harness();
  const e = open({ docGuid: 'old-copy' });
  noteDocReset(e, { feedback: h.feedback, now: 1000 });
  assert.equal(settleDocReset({ boardId: e.boardId, cardId: e.cardId, docGuid: 'old-copy', pageBlocks: () => [...e.blocks], feedback: h.feedback, now: 1200 }), null);
  assert.ok(settleDocReset({ boardId: e.boardId, cardId: e.cardId, docGuid: 'new-copy', pageBlocks: () => [...e.blocks], feedback: h.feedback, now: 2000 }));
});

test('a reset long gone by is dropped, not told late', () => {
  const h = harness();
  const e = open();
  noteDocReset(e, { feedback: h.feedback, now: 1000 });
  assert.equal(settleDocReset({ boardId: e.boardId, cardId: e.cardId, pageBlocks: () => [], feedback: h.feedback, now: 1000 + 180_000 }), null);
  assert.equal(h.toasts.length, 1);
  // Only a reload for this doc's own cluster counts.
  const other = open();
  noteDocReset(other, { feedback: h.feedback, now: 1000 });
  assert.equal(settleDocReset({ boardId: 'elsewhere', cardId: other.cardId, pageBlocks: () => [], feedback: h.feedback, now: 1100 }), null);
});

test('a doc reopens as it was open, in either layout, and only soon after', () => {
  noteReopen('reopen-a', 'side', 1000);
  assert.equal(reopenMode('reopen-a', 2000), 'side');
  // Read twice (StrictMode renders a component twice): same answer.
  assert.equal(reopenMode('reopen-a', 2000), 'side');
  clearReopen('reopen-a');
  assert.equal(reopenMode('reopen-a', 2000), null);
  noteReopen('reopen-b', 'full', 1000);
  assert.equal(reopenMode('reopen-b', 1000 + 31_000), null);
  noteReopen('reopen-c', 'closed', 1000);
  assert.equal(reopenMode('reopen-c', 1500), null);
});

test('lost means a block the page had is not there any more', () => {
  assert.equal(lostWriting(['One.', 'Two.'], ['One.', 'Two.']), false);
  assert.equal(lostWriting(['One.'], ['Added by the version.', 'One.']), false, 'the restore only added');
  assert.equal(lostWriting(['One.', 'Two.'], ['One.']), true);
  assert.equal(lostWriting(['One. And more.'], ['One.']), true, 'a sentence cut short');
  assert.equal(lostWriting(['One  two.'], ['One two .']), false, 'spacing is not writing');
  assert.equal(lostWriting(['', '  '], []), false);
  assert.equal(lostWriting(['One.'], null), true, 'no page at all');
  assert.equal(lostWriting([], null), false);
});

test('a page reads as its blocks, each with its words apart', () => {
  const ydoc = new Y.Doc();
  const card = new Y.Map();
  ydoc.getMap('cards').set('c1', card);
  initCardDocStore(ydoc, card);
  const scope = cardScope(card);
  const id = addPage(ydoc, { name: 'Scene one', scope });
  const frag = getOrCreatePageContent(ydoc, id, scope);
  const p = (text) => { const el = new Y.XmlElement('paragraph'); el.insert(0, [new Y.XmlText(text)]); return el; };
  const list = new Y.XmlElement('bulletList');
  const item = (text) => { const li = new Y.XmlElement('listItem'); li.insert(0, [p(text)]); return li; };
  list.insert(0, [item('Coffee'), item('Rain')]);
  frag.insert(0, [p('INT. CAFE - NIGHT'), list, p('')]);
  assert.deepEqual(readPageBlocks(ydoc, id, scope), ['INT. CAFE - NIGHT', 'Coffee Rain', '']);
  assert.equal(readPageBlocks(ydoc, 'no-such-page', scope), null);
});

test('the reload is announced on the window, for one cluster', () => {
  const seen = [];
  globalThis.window = new EventTarget();
  window.addEventListener(RELOAD_EVENT, (e) => seen.push(e.detail));
  announceBoardReload('board-x', 'restore');
  assert.deepEqual(seen, [{ boardId: 'board-x', reason: 'restore' }]);
  delete globalThis.window;
});

// The wiring, read from the source: the hook that reloads a cluster announces
// it before it lets the old copy go, and says which kind of reload it is.
test('useYBoard announces every reload of a live cluster before it discards the old copy', () => {
  const src = readFileSync(new URL('../hooks/useYBoard.js', import.meta.url), 'utf8');
  const trigger = src.slice(src.indexOf('const triggerReset'), src.indexOf('resetTimerRef.current = setTimeout'));
  const announce = trigger.indexOf('announceBoardReload(boardId, kind)');
  assert.ok(announce > -1, 'triggerReset announces');
  assert.ok(announce < trigger.indexOf('h.discard'), '…before the discard');
  assert.match(src, /watchBoardRestores\(boardId, \(\{ version \}\) => \{\s*noteBoardRestored\(boardId\);\s*triggerReset\(`realtime-version=\$\{version\}`, \{ kind: 'restore' \}\);/);
  assert.match(src, /triggerReset\('yjs-corruption', \{ force: true, discard: false, kind: 'heal' \}\)/);
  const api = readFileSync(new URL('./boardsApi.js', import.meta.url), 'utf8');
  const restore = api.slice(api.indexOf('export async function bulletproofRestore'));
  assert.ok(restore.indexOf('markLocalReset(boardId)') > -1
    && restore.indexOf('markLocalReset(boardId)') < restore.indexOf("supabase.rpc('mark_board_restored'"),
  'a restore from here is marked before its signal can arrive');
  assert.match(restore, /__soleilEmitBoardReset\(boardId, 'restore'\)/);
  const reset = api.slice(api.indexOf('export async function forceResetBoardRoom'));
  assert.ok(reset.indexOf('markLocalReset(boardId)') > -1 && reset.indexOf('markLocalReset(boardId)') < reset.indexOf('fetch('));
});
