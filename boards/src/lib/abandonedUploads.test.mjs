// abandonedUploads — a photo card saved without its file is recovered or
// removed, and never counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAbandonedUpload, planAbandonedSweep, abandonedNotice, ABANDON_AFTER_MS } from './abandonedUploads.js';

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

test('the sweep recovers what landed and removes the rest', () => {
  const found = new Map([['img-2', 'ws/board/img-2.png']]);
  assert.deepEqual(planAbandonedSweep(['img-1', 'img-2', 'img-3'], found), {
    recover: [{ id: 'img-2', src: 'r2:ws/board/img-2.png' }],
    remove: ['img-1', 'img-3'],
  });
  assert.deepEqual(planAbandonedSweep([], found), { recover: [], remove: [] });
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
  assert.match(app, /if \(refund && freed\) myTier\.notePlaced\?\.\(-freed\);/);
});
