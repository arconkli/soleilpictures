import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDeleteEvent, touchesAppliedTag, touchesTagMention, touchesTagSuggestion, coalesce,
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
