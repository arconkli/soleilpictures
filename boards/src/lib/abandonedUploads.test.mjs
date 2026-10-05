// abandonedUploads — a photo card saved without its file is recovered or
// removed, and never counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAbandonedUpload, isStillUploading, planAbandonedSweep, abandonedNotice, uploadAge, ABANDON_AFTER_MS, REMOVE_AFTER_MS, SWEEP_RECHECK_MS } from './abandonedUploads.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const card = (o) => (k) => o[k];

test('a pending photo with no file, older than the window, is abandoned', () => {
  assert.equal(isAbandonedUpload(card({ kind: 'image', pending: true, createdAt: ago(ABANDON_AFTER_MS + 1) }), NOW), true);
  assert.equal(isAbandonedUpload(card({ kind: 'image', pending: true, src: '', createdAt: ago(ABANDON_AFTER_MS * 10) }), NOW), true);
});

test('an upload still inside the window is left alone — it may be in flight', () => {
  assert.equal(isAbandonedUpload(card({ kind: 'image', pending: true, createdAt: ago(60_000) }), NOW), false);
  assert.ok(ABANDON_AFTER_MS >= 15 * 60_000, 'long enough for a big batch on a slow connection');
});

test('anything with a file, not pending, not a photo, or without a creation stamp is not judged', () => {
  const old = ago(ABANDON_AFTER_MS * 2);
  assert.equal(isAbandonedUpload(card({ kind: 'image', pending: true, src: 'r2:a/b.png', createdAt: old }), NOW), false);
  assert.equal(isAbandonedUpload(card({ kind: 'image', pending: false, createdAt: old }), NOW), false);
  assert.equal(isAbandonedUpload(card({ kind: 'image', createdAt: old }), NOW), false);
  assert.equal(isAbandonedUpload(card({ kind: 'pdf', pending: true, createdAt: old }), NOW), false);
  assert.equal(isAbandonedUpload(card({ kind: 'image', pending: true }), NOW), false);
  assert.equal(isAbandonedUpload(card({ kind: 'image', pending: true, createdAt: 'yesterday' }), NOW), false);
});

test('the sweep recovers what landed at any age, and removes only what is past a day', () => {
  const found = new Map([['img-2', 'ws/board/img-2.png']]);
  const hour = 60 * 60 * 1000;
  assert.deepEqual(planAbandonedSweep([
    { id: 'img-1', age: 2 * hour },                      // abandoned, but another device may still be uploading it
    { id: 'img-2', age: 2 * hour },                      // its file landed — recover now
    { id: 'img-3', age: REMOVE_AFTER_MS + 1 },           // nothing can still be uploading it
    { id: 'img-4', age: null },                          // no stamp: never removed
  ], found), {
    recover: [{ id: 'img-2', src: 'r2:ws/board/img-2.png' }],
    remove: ['img-3'],
  });
  assert.deepEqual(planAbandonedSweep([], found), { recover: [], remove: [] });
  assert.ok(REMOVE_AFTER_MS >= 12 * hour, 'removal waits far longer than any upload or clock skew');
  assert.ok(REMOVE_AFTER_MS > ABANDON_AFTER_MS);
});

test('uploadAge reads the creation stamp, and nothing else', () => {
  assert.equal(uploadAge(card({ createdAt: ago(5000) }), NOW), 5000);
  assert.equal(uploadAge(card({}), NOW), null);
});

test('the notice is plain, singular when it should be, and silent for none', () => {
  assert.match(abandonedNotice(36), /^36 photos didn't finish uploading before the page closed, so they were removed\. Add them again/);
  assert.match(abandonedNotice(1), /^1 photo didn't finish uploading .* so it was removed\. Add it again to keep it\.$/);
  assert.equal(abandonedNotice(0), '');
});

// ── Wiring. Playwright is not in CI. ──
const here = dirname(fileURLToPath(import.meta.url));
const boardsApi = readFileSync(join(here, 'boardsApi.js'), 'utf8');
const canvas = readFileSync(join(here, '../components/CanvasSurface.jsx'), 'utf8');
const app = readFileSync(join(here, '../App.jsx'), 'utf8');
const read = (rel) => readFileSync(join(here, rel), 'utf8');

test('the index never counts an abandoned upload', () => {
  const walk = boardsApi.slice(boardsApi.indexOf("cardsMap.forEach((v, id) => {"), boardsApi.indexOf('const row = buildCardIndexRow('));
  assert.match(walk, /if \(isAbandonedUpload\(get, nowMs\)\) return;/,
    'skipped before the row is built, and before it joins liveIds — so a row it already had is released');
});

test('the sweep never deletes on a failed read, never touches a live upload, and refunds nothing it never counted', () => {
  const start = canvas.indexOf('// Abandoned uploads');
  assert.ok(start > 0, 'the sweep exists');
  const sweep = canvas.slice(start, canvas.indexOf('}, [board?.id, cards, canEdit, isPublic, useLocalImages', start));
  assert.match(sweep, /if \(error\) return;/, 'an unreadable images table must leave every card as it is');
  assert.match(sweep, /localImagePreviewRef\.current/, 'a card this tab is still uploading is excluded');
  assert.match(sweep, /m\?\.deleteCardsSilent\?\.\(plan\.remove, \{ refund: false \}\)/);
  assert.match(app, /const deleteCardsSilent = \(ids, \{ refund = true \} = \{\}\) => \{/);
  assert.match(app, /const freed = refund && capSource\(\)\.own \? countedWeightOf\(m, present\) : 0;/);
  // …and a card the index skips is never refunded on any path, by hand or not.
  assert.match(app, /const countedWeight = \(get\) => \(isAbandonedUpload\(get\) \? 0 :/);
});

test('the sweep judges from the server\'s snapshot and the live cards, not from a stale paint', () => {
  const start = canvas.indexOf('// Abandoned uploads');
  const sweep = canvas.slice(start, canvas.indexOf('}, [board?.id, cards, canEdit, isPublic, useLocalImages', start));
  assert.match(sweep, /if \(!canEdit \|\| isPublic \|\| useLocalImages \|\| !board\?\.id \|\| !boardSynced\) return undefined;/,
    'the instant cache paint can be a day old — never sweep from it');
  assert.match(sweep, /const live = new Map\(\(cardsRef\.current \|\| \[\]\)\.map\(\(c\) => \[c\.id, c\]\)\);/, 're-read after the await');
  assert.match(sweep, /\.filter\(\(c\) => c && isAbandonedUpload\(\(k\) => c\[k\], at\) && !localImagePreviewRef\.current\?\.\[c\.id\]\)/);
  const yb = readFileSync(join(here, '../hooks/useYBoard.js'), 'utf8');
  assert.match(yb, /synced: !!handle\.serverApplied\?\.\(\),/);
  assert.match(read('../lib/yboard.js'), /serverApplied = true;/);
  assert.match(app, /boardSynced=\{synced\}/);
});

test('a card looked up and left is not looked up again on every render, and nothing done is not logged', () => {
  assert.ok(SWEEP_RECHECK_MS >= 5 * 60_000 && SWEEP_RECHECK_MS < REMOVE_AFTER_MS);
  const start = canvas.indexOf('// Abandoned uploads');
  const sweep = canvas.slice(start, canvas.indexOf('}, [board?.id, cards, canEdit, isPublic, useLocalImages', start));
  assert.match(sweep, /&& !\(now - \(checked\.get\(c\.id\) \|\| 0\) < SWEEP_RECHECK_MS\)\);/);
  assert.match(sweep, /for \(const id of ids\) checked\.set\(id, at\);/);
  // The notice and the event report what happened, not what was planned.
  assert.match(sweep, /const removed = plan\.remove\.length \? \(Number\(m\?\.deleteCardsSilent\?\.\(plan\.remove, \{ refund: false \}\)\) \|\| 0\) : 0;/);
  assert.match(sweep, /if \(removed\) feedbackRef\.current\?\.toast/);
  assert.match(sweep, /if \(plan\.recover\.length \|\| removed\) \{\s*try \{\s*logEvent\(EV\.UPLOAD_ABANDONED/);
  assert.match(app, /return present\.length;\s*\};/, 'deleteCardsSilent says how many it removed');
});

test('still uploading means no file yet — not merely pending', () => {
  assert.equal(isStillUploading({ kind: 'image', pending: true }), true);
  assert.equal(isStillUploading({ kind: 'pdf', pending: true }), true);
  assert.equal(isStillUploading({ kind: 'image', pending: true, src: 'r2:a/b.png' }), false, 'Replace image… gave it a file');
  assert.equal(isStillUploading({ kind: 'file', pending: true, fileSrc: 'r2:a/f.zip' }), false);
  assert.equal(isStillUploading({ kind: 'image' }), false);
  assert.equal(isStillUploading(null), false);
});

test('a card still uploading never leaves the card its upload will land in', () => {
  assert.match(canvas, /const keepUploadsInPlace = \(list\) => \{\s*const n = \(list \|\| \[\]\)\.filter\(isStillUploading\)\.length;/);
  const move = canvas.slice(canvas.indexOf('const moveCardsIntoBoard = async ('));
  assert.match(move.slice(0, 900), /movedCards = movedCards\.filter\(\(c\) => !isStillUploading\(c\)\);/, 'drag onto a cluster, and Move to cluster…');
  const pane = canvas.slice(canvas.indexOf("const onDrop = (e) => {\n      const { sourceBoardId, isCopy, clientX, clientY } = e.detail || {};"));
  assert.match(pane.slice(0, 2500), /payload = payload\.filter\(\(c\) => !isStillUploading\(c\)\);/, 'across panes');
  const cut = canvas.slice(canvas.indexOf('const doCut = useCallback('), canvas.indexOf('const doPaste = useCallback('));
  assert.match(cut, /const items = keepUploadsInPlace\(all\) \? all\.filter\(\(c\) => !isStillUploading\(c\)\) : all;/, 'cut and paste');
  assert.match(cut, /await doDeleteIds\(items\.map\(\(c\) => c\.id\)\);/, 'and only what was cut is deleted');
  const cell = canvas.slice(canvas.indexOf('const routeCardIntoCell = useCallback('));
  assert.match(cell.slice(0, 600), /if \(isStillUploading\(card\)\) return false;/, 'into a grid cell');
  assert.match(canvas, /const soloCellable = CELL_DROP_KINDS\.has\(soloKind\) && !isStillUploading\(cardById\[dragIds\[0\]\]\);/);
  // (The replacement also carries its own file name since 2026-10 — or clears
  // the old one; the assertion is about `pending`, so it allows that field.)
  assert.match(canvas, /mutators\.updateCard\?\.\(c\.id, \{ src: payload\.publicUrl, adjust: null, pending: false(, fileName: payload\.fileName \|\| null)? \}\);/, 'Replace image… clears pending');
});

test('each open of a cluster gets its own look, whatever was looked up on the last visit', () => {
  assert.match(canvas, /if \(sweepCheckedRef\.current\.boardId !== board\.id\) sweepCheckedRef\.current = \{ boardId: board\.id, at: new Map\(\) \};/);
});
