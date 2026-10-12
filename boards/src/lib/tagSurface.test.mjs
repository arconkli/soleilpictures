import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDeleteEvent, touchesAppliedTag, touchesTagMention, touchesTagSuggestion, coalesce,
  effectiveTypeFilter, clampMenuPosition, isDuplicateTagName, findTagByName,
} from './tagSurface.js';

// What Supabase realtime actually delivers for entity_links under RLS +
// REPLICA IDENTITY DEFAULT: a DELETE's `old` is the primary key and nothing else.
const del = { eventType: 'DELETE', new: {}, old: { id: 'link-1' } };
const insApplied = (over = {}) => ({
  eventType: 'INSERT',
  new: { id: 'l', target_kind: 'tag', target_id: 'tag-a', link_kind: 'applied', source_kind: 'card', ...over },
  old: {},
});

test('removing a tag (a PK-only DELETE) refreshes the chips and the counts', () => {
  assert.equal(isDeleteEvent(del), true);
  assert.equal(touchesAppliedTag(del), true);
  assert.equal(touchesAppliedTag(del, 'tag-a'), true, 'cannot be attributed, so it may be ours');
});

test('applied-tag inserts still match, mentions and other tags do not', () => {
  assert.equal(touchesAppliedTag(insApplied()), true);
  assert.equal(touchesAppliedTag(insApplied(), 'tag-a'), true);
  assert.equal(touchesAppliedTag(insApplied(), 'tag-b'), false);
  assert.equal(touchesAppliedTag(insApplied({ link_kind: 'mention' })), false);
  assert.equal(touchesAppliedTag({ eventType: 'UPDATE', new: { target_kind: 'card' }, old: {} }), false);
  assert.equal(touchesAppliedTag(null), false);
});

test('the profile reloads "Appears in" for doc mentions, doc-applied rows and any DELETE', () => {
  assert.equal(touchesTagMention(insApplied({ link_kind: 'mention' }), 'tag-a'), true);
  assert.equal(touchesTagMention(insApplied({ source_kind: 'doc' }), 'tag-a'), true);
  assert.equal(touchesTagMention(insApplied(), 'tag-a'), false, 'a card application is not a mention');
  assert.equal(touchesTagMention(insApplied({ link_kind: 'mention' }), 'tag-b'), false);
  assert.equal(touchesTagMention(del, 'tag-a'), true);
});

test('a suggestion change for this tag reloads the inbox, including a DELETE', () => {
  assert.equal(touchesTagSuggestion({ eventType: 'INSERT', new: { tag_id: 't' }, old: {} }, 't'), true);
  assert.equal(touchesTagSuggestion({ eventType: 'INSERT', new: { tag_id: 'u' }, old: {} }, 't'), false);
  // tag_id in the key → exact.
  assert.equal(touchesTagSuggestion({ eventType: 'DELETE', new: {}, old: { tag_id: 't', source_id: 'x' } }, 't'), true);
  assert.equal(touchesTagSuggestion({ eventType: 'DELETE', new: {}, old: { tag_id: 'u', source_id: 'x' } }, 't'), false);
  // only an opaque id → maybe ours.
  assert.equal(touchesTagSuggestion({ eventType: 'DELETE', new: {}, old: { id: 9 } }, 't'), true);
});

// Realtime skips RLS for a DELETE, so an entity_links subscription with no
// filter receives every DELETE on the platform — and every doc or note save
// deletes mention rows. The tag page must stay scoped to its workspace.
test('the tag page listens to entity_links in its own workspace only', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../components/TagDetailView.jsx'), 'utf8');
  const subs = src.split("table: 'entity_links'").slice(1);
  assert.ok(subs.length > 0, 'the tag page subscribes to entity_links');
  for (const rest of subs) {
    const opts = rest.slice(0, rest.indexOf('}'));
    assert.match(opts, /filter:\s*`source_workspace=eq\./);
  }
});

const tick = () => new Promise(r => setTimeout(r, 0));

test('a refresh asked for mid-flight is queued, not dropped', async () => {
  let calls = 0;
  let release;
  const run = coalesce(async () => {
    calls += 1;
    if (calls === 1) await new Promise(r => { release = r; });
  });
  const first = run();
  await tick();
  run(); run(); run();          // three asks while the first is in flight
  assert.equal(calls, 1, 'never concurrent');
  release();
  await first;
  assert.equal(calls, 2, 'exactly one trailing run covers every queued ask');
  await run();
  assert.equal(calls, 3, 'idle again: the next ask runs straight away');
});

test('a failing refresh does not wedge the runner or swallow the trailing run', async () => {
  let calls = 0;
  let release;
  const run = coalesce(async () => {
    calls += 1;
    if (calls === 1) { await new Promise(r => { release = r; }); throw new Error('network'); }
  });
  const first = run();
  await tick();
  run();
  release();
  await first;
  assert.equal(calls, 2);
  await run();
  assert.equal(calls, 3);
});

test('a remembered type filter only applies to a tag that has that kind', () => {
  const counts = new Map([['note', 3], ['image', 0]]);
  assert.equal(effectiveTypeFilter('note', counts), 'note');
  assert.equal(effectiveTypeFilter('image', counts), 'all', 'zero of that kind → show everything');
  assert.equal(effectiveTypeFilter('palette', counts), 'all', 'absent kind → show everything');
  assert.equal(effectiveTypeFilter('all', counts), 'all');
  assert.equal(effectiveTypeFilter(null, counts), 'all');
  assert.equal(effectiveTypeFilter('note', new Map()), 'all', 'nothing synced yet → nothing to filter');
});

test('a context menu stays on screen: it opens at the pointer, or flips', () => {
  const vp = { vw: 1000, vh: 800, width: 180, height: 200 };
  assert.deepEqual(clampMenuPosition({ ...vp, x: 100, y: 100 }), { left: 100, top: 100 }, 'room: at the pointer');
  // Right-clicked a row 60px from the bottom: open upward, ending at the pointer.
  assert.deepEqual(clampMenuPosition({ ...vp, x: 100, y: 740 }), { left: 100, top: 540 });
  // Near the right edge: open leftward.
  assert.deepEqual(clampMenuPosition({ ...vp, x: 950, y: 100 }), { left: 770, top: 100 });
  // Bottom-right corner: both.
  assert.deepEqual(clampMenuPosition({ ...vp, x: 990, y: 790 }), { left: 810, top: 590 });
  // A menu taller than the room above and below still lands inside the padding.
  const tall = clampMenuPosition({ vw: 400, vh: 300, width: 180, height: 280, x: 10, y: 150 });
  assert.equal(tall.top, 8);
  assert.ok(tall.left >= 8 && tall.left + 180 <= 400 - 8);
});

test('a rename that collides finds the live tag it collided with, or none (a deleted one)', () => {
  assert.equal(isDuplicateTagName({ code: '23505', message: 'duplicate key value violates unique constraint' }), true);
  assert.equal(isDuplicateTagName({ code: '42501' }), false);
  assert.equal(isDuplicateTagName(null), false);
  const tags = [
    { id: 'a', name: 'Pricing', slug: 'pricing' },
    { id: 'b', name: 'Plans', slug: 'plans' },
  ];
  assert.equal(findTagByName(tags, '  PLANS ', 'a')?.id, 'b', 'case-insensitive, trimmed');
  assert.equal(findTagByName(tags, 'pricing', 'a'), null, 'never the tag being renamed');
  assert.equal(findTagByName(tags, 'Archive', 'a'), null, 'not live → held by a deleted tag');
  assert.equal(findTagByName(tags, '', 'a'), null);
});
