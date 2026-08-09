// objectMeta — identifiers and props.
//
// The pure half is tested here because it is the half that decides what a
// stranger's JSON is allowed to become. The database half (matchIdentifiers,
// saveMeta) is exercised end to end against a real deployment instead, since
// what it is really asserting is that PostgREST and the RLS policies behave —
// which a stub would only ever assert about the stub.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProps, mergeProps, normalizeIdentifiers, parseInclude,
  pgQuote, pgInList, withMeta, indexIdentifierRows, resolveUpsert,
  MAX_PROPS_BYTES, MAX_PROP_KEYS, MAX_IDENTIFIERS, RESERVED_PREFIX,
} from './objectMeta.js';

const throws = (fn, re) => assert.throws(fn, (e) => {
  assert.equal(e.status, 400);
  assert.equal(e.code, 'bad_request');
  assert.match(e.message, re);
  return true;
});

// ── props ────────────────────────────────────────────────────────────────────

test('props accept the shape an integration actually sends', () => {
  const p = {
    scene: '14A', shot: 'ABC_0100_0010', department: 'costume',
    version: 3, approved: false, tags: ['night', 'exterior'],
    camera: { roll: 'A017', body: 'ALEXA 35' },
  };
  assert.deepEqual(normalizeProps(p), p, 'nested objects and arrays are ordinary JSON');
});

test('absent props are distinct from empty props', () => {
  assert.equal(normalizeProps(null), null, 'null means "leave alone"');
  assert.equal(normalizeProps(undefined), null);
  assert.deepEqual(normalizeProps({}), {}, 'an empty object is a real value, not an absence');
});

test('props must be an object, not an array or a scalar', () => {
  throws(() => normalizeProps([1, 2]), /must be a JSON object/);
  throws(() => normalizeProps('scene 14'), /must be a JSON object/);
  throws(() => normalizeProps(7), /must be a JSON object/);
});

test('the soleil. namespace is reserved, case-insensitively', () => {
  throws(() => normalizeProps({ [`${RESERVED_PREFIX}kind`]: 'x' }), /reserved/);
  throws(() => normalizeProps({ 'SOLEIL.kind': 'x' }), /reserved/);
  // Not a prefix match on the bare word — only the namespace is taken.
  assert.ok(normalizeProps({ soleil: 'a studio in Paris', soleilpictures: 'ok' }));
});

test('props caps are enforced on key count and serialized size', () => {
  const many = Object.fromEntries(
    Array.from({ length: MAX_PROP_KEYS + 1 }, (_, i) => [`k${i}`, 1]));
  throws(() => normalizeProps(many), new RegExp(`at most ${MAX_PROP_KEYS} keys`));
  assert.ok(normalizeProps(Object.fromEntries(
    Array.from({ length: MAX_PROP_KEYS }, (_, i) => [`k${i}`, 1]))), 'exactly at the cap is fine');

  throws(() => normalizeProps({ blob: 'x'.repeat(MAX_PROPS_BYTES) }),
    new RegExp(`under ${MAX_PROPS_BYTES} bytes`));
});

test('a merge that crosses the cap is caught, not stored', () => {
  // Each patch is legal alone; together they are not. saveMeta re-validates the
  // MERGED object for exactly this reason — checking only the patch would let a
  // caller past the ceiling one key at a time.
  const existing = { a: 'x'.repeat(MAX_PROPS_BYTES - 100) };
  const merged = mergeProps(existing, { b: 'y'.repeat(200) });
  throws(() => normalizeProps(merged), /bytes/);
});

test('a null value deletes a key; absent leaves it alone', () => {
  const before = { scene: '14A', shot: 'ABC_0100_0010', dept: 'costume' };
  assert.deepEqual(mergeProps(before, { scene: null }),
    { shot: 'ABC_0100_0010', dept: 'costume' });
  assert.deepEqual(mergeProps(before, { scene: '14B' }),
    { scene: '14B', shot: 'ABC_0100_0010', dept: 'costume' });
  assert.deepEqual(mergeProps(before, {}), before, 'an empty patch changes nothing');
  assert.deepEqual(mergeProps(null, { a: 1 }), { a: 1 }, 'no existing row is not an error');
});

test('a merge does not mutate what it was given', () => {
  const before = { a: 1 };
  mergeProps(before, { b: 2, a: null });
  assert.deepEqual(before, { a: 1 });
});

test('false, 0 and empty string survive a merge — only null removes', () => {
  assert.deepEqual(mergeProps({ a: 1, b: 1, c: 1 }, { a: false, b: 0, c: '' }),
    { a: false, b: 0, c: '' });
});

// ── identifiers ──────────────────────────────────────────────────────────────

test('scope is case-folded and value is left exactly as given', () => {
  // "ShotGrid" and "shotgrid" are one system. If both could exist, the unique
  // index would not stop the same upstream record being claimed twice, which is
  // the entire point of the index.
  assert.deepEqual(
    normalizeIdentifiers([{ scope: '  ShotGrid ', value: '  Shot:12345  ' }]),
    [{ scope: 'shotgrid', value: 'Shot:12345' }]);
});

test('identifiers dedupe after normalization', () => {
  const out = normalizeIdentifiers([
    { scope: 'shotgrid', value: 'Shot:1' },
    { scope: 'SHOTGRID', value: 'Shot:1' },
    { scope: 'ftrack', value: 'Shot:1' },
  ]);
  assert.deepEqual(out, [
    { scope: 'shotgrid', value: 'Shot:1' },
    { scope: 'ftrack', value: 'Shot:1' },
  ], 'same value under a different scope is a different identifier');
});

test('an empty array clears identifiers; null leaves them alone', () => {
  assert.deepEqual(normalizeIdentifiers([]), [], 'an explicit empty set is a removal');
  assert.equal(normalizeIdentifiers(null), null);
});

test('identifiers are refused rather than silently truncated', () => {
  throws(() => normalizeIdentifiers('shotgrid:1'), /must be an array/);
  throws(() => normalizeIdentifiers([{ scope: 'x' }]), /value must be/);
  throws(() => normalizeIdentifiers([{ value: 'x' }]), /scope must be/);
  throws(() => normalizeIdentifiers([{ scope: 'x', value: '  ' }]), /value must be/);
  throws(() => normalizeIdentifiers([{ scope: 'x', value: 'y'.repeat(201) }]), /value must be/);
  throws(() => normalizeIdentifiers(
    Array.from({ length: MAX_IDENTIFIERS + 1 }, (_, i) => ({ scope: 's', value: `v${i}` }))),
  new RegExp(`at most ${MAX_IDENTIFIERS}`));
});

test('a non-string value is coerced, not accepted as an object', () => {
  assert.deepEqual(normalizeIdentifiers([{ scope: 'shotgrid', value: 12345 }]),
    [{ scope: 'shotgrid', value: '12345' }]);
});

// ── upsert resolution ────────────────────────────────────────────────────────
//
// THE BUG THESE EXIST FOR. matchIdentifiers built its lookup keys one way and
// the upsert resolver read them another, so every match missed silently: a
// re-run created a second copy of everything and the first visible symptom was
// a unique-constraint violation three calls later, in an unrelated-looking
// place. Both halves were individually correct and individually tested.
//
// So the round trip is what gets asserted here, not either half — and
// `matchRows` below builds its map the way matchIdentifiers really does, via
// the same exported key function.

const matchRows = (rows) => indexIdentifierRows(rows);

const idRow = (scope, value, board, object) =>
  ({ scope, value, board_id: board, object_id: object ?? board, object_type: 'board' });

test('an identifier that exists resolves to the object holding it', () => {
  const matches = matchRows([idRow('shotgrid', 'Sequence:88', 'board-1')]);
  const out = resolveUpsert(
    [{ identifiers: [{ scope: 'shotgrid', value: 'Sequence:88' }] }],
    matches, { objectType: 'board' });
  assert.equal(out[0].existing?.board_id, 'board-1',
    'if this misses, every import silently duplicates itself');
});

test('the key survives values full of separators', () => {
  // A scope or value is arbitrary text from someone else's system. These are
  // the pairs that collide under a naive separator.
  const matches = matchRows([
    idRow('a b', 'c', 'board-1'),
    idRow('a', 'b c', 'board-2'),
    idRow('x', 'y:z/w', 'board-3'),
  ]);
  const hit = (scope, value) => resolveUpsert(
    [{ identifiers: [{ scope, value }] }], matches, { objectType: 'board' })[0].existing?.board_id;
  assert.equal(hit('a b', 'c'), 'board-1');
  assert.equal(hit('a', 'b c'), 'board-2', 'must not collide with the one above');
  assert.equal(hit('x', 'y:z/w'), 'board-3');
});

test('an unmatched identifier is a create, not an error', () => {
  const out = resolveUpsert(
    [{ identifiers: [{ scope: 'shotgrid', value: 'Sequence:99' }] }],
    new Map(), { objectType: 'board' });
  assert.equal(out[0].existing, null);
});

test('an item with no identifiers is always a create', () => {
  const matches = matchRows([idRow('shotgrid', 'Sequence:88', 'board-1')]);
  assert.equal(resolveUpsert([{}], matches, { objectType: 'board' })[0].existing, null);
  assert.equal(resolveUpsert([{ identifiers: [] }], matches, { objectType: 'board' })[0].existing, null);
});

test('several identifiers pointing at the SAME object is fine', () => {
  const matches = matchRows([
    idRow('shotgrid', 'Sequence:88', 'board-1'),
    idRow('ftrack', 'abc', 'board-1'),
  ]);
  const out = resolveUpsert([{ identifiers: [
    { scope: 'shotgrid', value: 'Sequence:88' }, { scope: 'ftrack', value: 'abc' },
  ] }], matches, { objectType: 'board' });
  assert.equal(out[0].existing?.board_id, 'board-1');
});

test('identifiers pointing at two different objects is a 409, not a coin toss', () => {
  const matches = matchRows([
    idRow('shotgrid', 'Sequence:88', 'board-1'),
    idRow('ftrack', 'abc', 'board-2'),
  ]);
  assert.throws(() => resolveUpsert([{ identifiers: [
    { scope: 'shotgrid', value: 'Sequence:88' }, { scope: 'ftrack', value: 'abc' },
  ] }], matches, { objectType: 'board' }), (e) => {
    assert.equal(e.status, 409);
    assert.equal(e.code, 'identifier_conflict');
    return true;
  });
});

test('a card whose identifier lives on another board is a 409 naming that board', () => {
  const matches = matchRows([
    { ...idRow('shotgrid', 'Asset:1', 'board-other', 'card-9'), object_type: 'card' }]);
  assert.throws(() => resolveUpsert(
    [{ identifiers: [{ scope: 'shotgrid', value: 'Asset:1' }] }],
    matches, { objectType: 'card', boardId: 'board-here' }),
  (e) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /board-other/, 'the caller has to be told where it went');
    return true;
  });
});

test('a card matched on its OWN board is an ordinary update', () => {
  const matches = matchRows([
    { ...idRow('shotgrid', 'Asset:1', 'board-here', 'card-9'), object_type: 'card' }]);
  const out = resolveUpsert(
    [{ identifiers: [{ scope: 'shotgrid', value: 'Asset:1' }] }],
    matches, { objectType: 'card', boardId: 'board-here' });
  assert.equal(out[0].existing?.object_id, 'card-9');
});

test('a mixed batch is partitioned item by item, in order', () => {
  const matches = matchRows([idRow('sg', 'b', 'board-2')]);
  const out = resolveUpsert([
    { identifiers: [{ scope: 'sg', value: 'a' }] },
    { identifiers: [{ scope: 'sg', value: 'b' }] },
    { identifiers: [{ scope: 'sg', value: 'c' }] },
  ], matches, { objectType: 'board' });
  assert.deepEqual(out.map((r) => r.existing?.board_id ?? null), [null, 'board-2', null]);
  assert.deepEqual(out.map((r) => r.index), [0, 1, 2]);
});

// ── PostgREST quoting ────────────────────────────────────────────────────────

test('a value containing a comma cannot break out of an in.() list', () => {
  // PostgREST parses in.(…) from the DECODED query string, so percent-encoding
  // does not protect it — only quoting does. An identifier value is arbitrary
  // text from someone else's system, so this is reachable input.
  assert.equal(pgQuote('a,b'), '"a,b"');
  assert.equal(pgInList(['a,b', 'c']), '("a,b","c")');
});

test('quotes and backslashes in a value are escaped', () => {
  assert.equal(pgQuote('say "hi"'), '"say \\"hi\\""');
  assert.equal(pgQuote('back\\slash'), '"back\\\\slash"');
  assert.equal(pgQuote('")) or 1=1--'), '"\\")) or 1=1--"');
});

test('parentheses and empty strings survive quoting', () => {
  assert.equal(pgInList(['(x)', '']), '("(x)","")');
});

// ── include ──────────────────────────────────────────────────────────────────

test('include parses a list and refuses a typo', () => {
  const u = (q) => new URL(`https://x/api/v1/boards${q}`);
  assert.deepEqual([...parseInclude(u(''), ['props', 'identifiers'])], []);
  assert.deepEqual([...parseInclude(u('?include=props'), ['props', 'identifiers'])], ['props']);
  assert.deepEqual(
    [...parseInclude(u('?include=Props, identifiers'), ['props', 'identifiers'])],
    ['props', 'identifiers'], 'case and spaces are forgiven');
  // Silently ignoring this is the difference between "my props are missing" and
  // "I misspelled the parameter", and only one of those is debuggable.
  throws(() => parseInclude(u('?include=propz'), ['props', 'identifiers']), /include must be one of/);
});

test('withMeta fills both fields or neither', () => {
  assert.deepEqual(withMeta({ id: 'a' }, null), { id: 'a' }, 'not requested → not present');
  assert.deepEqual(withMeta({ id: 'a' }, { props: null, identifiers: [] }),
    { id: 'a', props: {}, identifiers: [] },
    'requested but empty → present and empty, so a caller can tell the difference');
});
