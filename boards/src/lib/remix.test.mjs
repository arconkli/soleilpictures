import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeRemixParam, parseRemixParam } from './remix.js';

// The remix param is a URL-visible wire format that survives a signup and an OTP
// magic-link hop, so a value minted today may be parsed by a different build
// days later on a different device. That makes the tag→kind mapping a contract,
// not an implementation detail, and it had no test at all.
//
// Only the two pure functions are covered here. stash/read/clearRemix touch
// localStorage, which is the part the browser owns and the part that was never
// in doubt.

const KINDS = [
  ['token', 't'],     // a board share token
  ['slug', 's'],      // a published /c/<slug> board
  ['template', 'g'],  // a grid-template SHARE token
  ['gallery', 'p'],   // a PUBLISHED template's slug
  ['curated', 'k'],   // a /templates/<slug> page's shipped shape
];

test('every kind round-trips through its own tag', () => {
  for (const [kind, tag] of KINDS) {
    const encoded = encodeRemixParam({ kind, value: 'abc-123' });
    assert.equal(encoded, `${tag}_abc-123`, `${kind} should encode as ${tag}_`);
    assert.deepEqual(parseRemixParam(encoded), { kind, value: 'abc-123' });
  }
});

test('the tags are distinct — no two kinds collide', () => {
  const tags = KINDS.map(([, t]) => t);
  assert.equal(new Set(tags).size, tags.length, `duplicate tag in ${tags.join(',')}`);
});

// g_ and p_ are both grid templates and are deliberately NOT interchangeable: a
// share token is private and unguessable, a gallery slug is public and readable,
// and they are claimed by different RPCs with different authorization. Merging
// them would mean guessing which one a value is.
test('a share token and a gallery slug stay different kinds', () => {
  const token = parseRemixParam('g_9f8e7d6c-0000-4000-8000-000000000000');
  const slug = parseRemixParam('p_9f8e7d6c-0000-4000-8000-000000000000');
  assert.equal(token.kind, 'template');
  assert.equal(slug.kind, 'gallery');
  assert.equal(token.value, slug.value, 'identical values, different meaning');
});

// The encoder used to be a ternary chain ending in `: 't'`, so ANY unrecognized
// kind silently minted a board-share link. That fails far away from the typo —
// in the app, after signup, as "we could not find that board".
test('an unknown kind encodes to nothing, rather than defaulting to a token', () => {
  assert.equal(encodeRemixParam({ kind: 'nope', value: 'x' }), '');
  assert.equal(encodeRemixParam({ kind: 'Gallery', value: 'x' }), '', 'kinds are case-sensitive');
});

test('missing pieces encode to nothing', () => {
  for (const arg of [undefined, {}, { kind: 'slug' }, { value: 'x' }, { kind: 'slug', value: '' }]) {
    assert.equal(encodeRemixParam(arg), '', `${JSON.stringify(arg)} should not encode`);
  }
});

test('junk parses to null rather than a half-built intent', () => {
  for (const raw of [null, undefined, '', 'no-underscore', '_leading', 'x_unknown-tag', 's_', 42, {}]) {
    assert.equal(parseRemixParam(raw), null, `${JSON.stringify(raw)} should not parse`);
  }
});

// Slugs contain hyphens and tokens are uuids, both of which contain no
// underscore — but the value is split on the FIRST underscore only, so a value
// that somehow contains one still survives intact.
test('only the first underscore is the delimiter', () => {
  assert.deepEqual(parseRemixParam('s_my_board_name'), { kind: 'slug', value: 'my_board_name' });
});
