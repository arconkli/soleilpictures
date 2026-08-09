// /api/v1 — the boundary between a stranger's JSON and everyone's Y.Doc.
//
// normalizeIncomingCard and publicCard are the only two places an API caller's
// data crosses into (and out of) a shared document. Everything else in
// worker-api.js is routing and authorization; these two decide what is allowed
// to become a card and what a consumer is allowed to see. Tested directly
// because a route test would exercise them incidentally and prove less.
//
// pgLikeValue is here for the same reason: it is one pure function standing
// between a search box and a filter that PostgREST parses structurally.

import { test, expect } from '@playwright/test';
import { normalizeIncomingCard, publicCard, pgLikeValue } from '../src/worker-api.js';

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

// This used to coerce silently, on creates AND on patches. Coercion is right
// for an ABSENT kind (it's a default) and wrong for a present one: it told a
// caller they'd made a schedule card when they had made a note, and on a patch
// it turned an image card into a note and dropped the picture.
test('an unrecognised kind is refused rather than coerced', () => {
  expect(() => normalizeIncomingCard({ kind: 'schedule' })).toThrow(/kind must be one of/);
  expect(() => normalizeIncomingCard({ kind: '../../etc' })).toThrow(/kind must be one of/);
  expect(() => normalizeIncomingCard({ kind: 'bogus' }, { partial: true, existingKind: 'image' }))
    .toThrow(/kind must be one of/);
  // …and the refusal carries a status the route can return directly.
  try { normalizeIncomingCard({ kind: 'schedule' }); } catch (e) {
    expect(e.status).toBe(400);
    expect(e.code).toBe('bad_request');
  }
});

test('an absent kind still defaults, and a valid one is kept', () => {
  expect(normalizeIncomingCard({ title: 'x' }).kind).toBe('note');
  expect(normalizeIncomingCard({ kind: 'image' }).kind).toBe('image');
  // A patch that says nothing about kind does not invent one.
  expect(normalizeIncomingCard({ title: 'x' }, { partial: true, existingKind: 'image' }).kind)
    .toBeUndefined();
});

// The round-trip bug: publicCard mapped caption→body, but the normalizer always
// wrote `body`. Reading an image card and PATCHing its text back returned 200
// and changed nothing the app would ever display, because ImageCard reads
// `caption`. One name on the wire, translated in both directions.
test("an image card's text goes to caption, everything else to body", () => {
  const img = normalizeIncomingCard({ kind: 'image', body: 'a caption' });
  expect(img.caption).toBe('a caption');
  expect(img.body).toBeUndefined();

  const note = normalizeIncomingCard({ kind: 'note', body: 'some text' });
  expect(note.body).toBe('some text');
  expect(note.caption).toBeUndefined();

  // A partial patch has to learn the kind from the card being patched — that is
  // the whole reason updateCardOnBoard takes a function.
  const patch = normalizeIncomingCard({ body: 'new caption' }, { partial: true, existingKind: 'image' });
  expect(patch.caption).toBe('new caption');
  expect(patch.body).toBeUndefined();
});

test('an image card round-trips its text unchanged', () => {
  const written = normalizeIncomingCard({ kind: 'image', body: 'diner, night' });
  const read = publicCard({ id: 'c1', kind: 'image', ...written });
  expect(read.body).toBe('diner, night');
  const rewritten = normalizeIncomingCard({ body: read.body }, { partial: true, existingKind: 'image' });
  expect(rewritten.caption).toBe('diner, night');
});

// Image cards reference their bytes as src:"r2:<key>" — what scoutCards.js
// writes, what buildCardMeta projects and what cards.jsx resolves. The API used
// to read and write `card.key`, a field nothing in the app looks at, so an image
// card created through it rendered blank.
test('an image key becomes an r2: src, and comes back as a key', () => {
  const out = normalizeIncomingCard({ kind: 'image', image_key: 'ws-1/abc.jpg' });
  expect(out.src).toBe('r2:ws-1/abc.jpg');
  expect(out.key).toBeUndefined();
  expect(publicCard({ id: 'c', kind: 'image', src: 'r2:ws-1/abc.jpg' }).image_key).toBe('ws-1/abc.jpg');
  // A non-r2 src (external URL, local blob in QA) is not a storage key.
  expect(publicCard({ id: 'c', kind: 'image', src: 'https://example.com/x.jpg' }).image_key).toBeNull();
  expect(publicCard({ id: 'c', kind: 'image' }).image_key).toBeNull();
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
    title: 't', caption: 'cap', src: 'r2:r2/key.jpg', alt: 'a still',
    // Interior state that consumers must not learn to depend on.
    lab: [1, 2, 3], adjust: { brightness: 2 }, createdBy: 'user-1', seed: false,
  });
  expect(Object.keys(out).sort()).toEqual([
    'alt', 'body', 'color', 'created_at', 'h', 'html', 'id', 'image_key',
    'kind', 'title', 'updated_at', 'url', 'w', 'x', 'y', 'z',
  ]);
  expect(out.image_key).toBe('r2/key.jpg');
  // caption stands in for body — the wire has one name for the text of a card.
  expect(out.body).toBe('cap');
  // An image is NOT also given file_key: it would carry the same value as
  // image_key, and a duplicated field on the commonest kind is paid for in
  // every list response forever.
  expect('file_key' in out).toBe(false);
});

test('a media card carries its own fields, and only a media card does', () => {
  const video = publicCard({
    id: 'v1', kind: 'video', src: 'r2:ws/reel.mov', poster: 'r2:ws/still.jpg',
    mime: 'video/quicktime', sizeBytes: 4096,
  });
  expect(video.file_key).toBe('ws/reel.mov');
  expect(video.poster_key).toBe('ws/still.jpg');
  expect(video.mime).toBe('video/quicktime');
  expect(video.size_bytes).toBe(4096);

  const file = publicCard({
    id: 'f1', kind: 'file', fileSrc: 'r2:ws/notes.pdf', fileName: 'notes.pdf', ext: 'pdf',
  });
  expect(file.file_key).toBe('ws/notes.pdf');
  expect(file.file_name).toBe('notes.pdf');
  expect(file.ext).toBe('pdf');

  // A note gains nothing. Six always-null fields on every note is the cost this
  // avoids.
  const note = publicCard({ id: 'n1', kind: 'note', body: 'x' });
  for (const k of ['file_key', 'poster_key', 'file_name', 'mime', 'ext', 'size_bytes']) {
    expect(k in note).toBe(false);
  }
});

// ── search filter escaping ───────────────────────────────────────────────────
//
// PostgREST parses `or=(a.ilike.X,b.ilike.Y)` structurally from the DECODED
// query string, so percent-encoding a comma does not protect it. Double-quoting
// does. Two escaping layers have to survive in the right order: LIKE
// metacharacters first, then PostgREST's own quoting, which doubles the
// backslashes the first layer added.

test('a plain query becomes a quoted contains-pattern', () => {
  expect(pgLikeValue('diner')).toBe('"%diner%"');
});

test('PostgREST structural characters stay inside the quotes', () => {
  // A bare comma here would end the filter and start another condition; a bare
  // paren would close the or() group early.
  expect(pgLikeValue('a,b')).toBe('"%a,b%"');
  expect(pgLikeValue('a)b(c')).toBe('"%a)b(c%"');
  expect(pgLikeValue('dots.and.more')).toBe('"%dots.and.more%"');
});

test('LIKE wildcards the user typed are escaped, then re-escaped for quoting', () => {
  // One backslash after PostgREST unquotes `\\` → Postgres sees \% → literal %.
  // Verified against Postgres directly: '50% off' ILIKE '%50\%%' is true and
  // '50X off' is false.
  expect(pgLikeValue('50%')).toBe('"%50\\\\%%"');
  expect(pgLikeValue('under_score')).toBe('"%under\\\\_score%"');
});

test('quotes and backslashes cannot break out of the quoted value', () => {
  expect(pgLikeValue('quo"te')).toBe('"%quo\\"te%"');
  // The user's single backslash is escaped for LIKE, then both are doubled for
  // quoting: one literal backslash in, four out.
  expect(pgLikeValue('back\\slash')).toBe('"%back\\\\\\\\slash%"');
});

test('a value can never terminate the filter it sits in', () => {
  // The property that matters, stated once: whatever comes out, every unescaped
  // double quote is at the very start and the very end.
  for (const nasty of ['a,b', 'x)', '(y', 'q"z', 'a\\"b', '%_,()."\\']) {
    const v = pgLikeValue(nasty);
    expect(v.startsWith('"')).toBe(true);
    expect(v.endsWith('"')).toBe(true);
    const inner = v.slice(1, -1);
    // Strip escaped pairs; no bare quote may survive.
    expect(inner.replace(/\\\\/g, '').replace(/\\"/g, '')).not.toContain('"');
  }
});
