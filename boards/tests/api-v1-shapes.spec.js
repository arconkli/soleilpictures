// /api/v1 — the boundary between a stranger's JSON and everyone's Y.Doc.
//
// normalizeIncomingCard and publicCard are the only two places an API caller's
// data crosses into (and out of) a shared document. Everything else in
// worker-api.js is routing and authorization; these two decide what is allowed
// to become a card and what a consumer is allowed to see. Tested directly
// because a route test would exercise them incidentally and prove less.

import { test, expect } from '@playwright/test';
import { normalizeIncomingCard, publicCard } from '../src/worker-api.js';

test('unknown fields never reach the card', () => {
  const out = normalizeIncomingCard({
    kind: 'note',
    title: 'ok',
    // Everything below is a field a caller might try because it exists on real
    // cards. None of it is part of the API.
    seed: true,
    createdBy: 'someone-else',
    adjust: { brightness: 9 },
    gridLayout: { rows: 4 },
    __proto__: { polluted: true },
  });
  expect(out.seed).toBeUndefined();
  expect(out.createdBy).toBeUndefined();
  expect(out.adjust).toBeUndefined();
  expect(out.gridLayout).toBeUndefined();
  expect(out.polluted).toBeUndefined();
  expect(out.title).toBe('ok');
});

test('an unrecognised kind falls back to note rather than being stored', () => {
  expect(normalizeIncomingCard({ kind: 'schedule' }).kind).toBe('note');
  expect(normalizeIncomingCard({ kind: '../../etc' }).kind).toBe('note');
  expect(normalizeIncomingCard({ kind: 'image' }).kind).toBe('image');
});

test('a patch cannot change a card id', () => {
  // The id is the key in both the Y.Map and card_index. Letting a PATCH move it
  // would orphan the index row rather than rename anything.
  const out = normalizeIncomingCard({ id: 'somebody-elses-card', title: 'x' }, { partial: true });
  expect(out.id).toBeUndefined();
  expect(out.title).toBe('x');
});

test('a patch touches only the fields it names', () => {
  const out = normalizeIncomingCard({ title: 'new' }, { partial: true });
  expect(Object.keys(out)).toEqual(['title']);
  // No default w/h — a partial update must not silently resize the card.
  expect(out.w).toBeUndefined();
  expect(out.h).toBeUndefined();
});

test('sizes are clamped so one call cannot make a board unusable', () => {
  expect(normalizeIncomingCard({ w: 999999, h: 999999 }).w).toBe(4000);
  expect(normalizeIncomingCard({ w: 999999, h: 999999 }).h).toBe(4000);
  expect(normalizeIncomingCard({ w: -50, h: 0 }).w).toBe(40);
  expect(normalizeIncomingCard({ w: 1.7 }).w).toBe(40);           // rounded, then floored to the minimum
  expect(normalizeIncomingCard({ w: 300.6 }).w).toBe(301);
});

test('non-finite geometry is dropped, not coerced to NaN', () => {
  // A NaN x poisons boundsOfCards() and scatters the whole board — the
  // scout-moodboard suite pins the same property from the other direction.
  const out = normalizeIncomingCard({ x: 'left', y: null, w: Infinity });
  expect(out.x).toBeUndefined();
  expect(out.y).toBeUndefined();
  expect(out.w).toBe(280);                                        // fell back to the default
});

test('oversized text is truncated rather than rejected', () => {
  const out = normalizeIncomingCard({ title: 'a'.repeat(5000), body: 'b'.repeat(99999) });
  expect(out.title.length).toBe(300);
  expect(out.body.length).toBe(20000);
});

test('a new card always gets an id, and two calls never collide', () => {
  const a = normalizeIncomingCard({ title: 'a' });
  const b = normalizeIncomingCard({ title: 'b' });
  expect(a.id).toBeTruthy();
  expect(a.id).not.toBe(b.id);
});

test('publicCard exposes the documented fields and nothing else', () => {
  const out = publicCard({
    id: 'c1', kind: 'image', x: 1, y: 2, w: 3, h: 4, z: 5,
    title: 't', caption: 'cap', key: 'r2/key.jpg',
    // Interior state that consumers must not learn to depend on.
    lab: [1, 2, 3], adjust: { brightness: 2 }, createdBy: 'user-1', seed: false,
  });
  expect(Object.keys(out).sort()).toEqual([
    'body', 'color', 'created_at', 'h', 'html', 'id', 'image_key',
    'kind', 'title', 'updated_at', 'url', 'w', 'x', 'y', 'z',
  ]);
  expect(out.image_key).toBe('r2/key.jpg');
  // caption stands in for body — the wire has one name for the text of a card.
  expect(out.body).toBe('cap');
});
