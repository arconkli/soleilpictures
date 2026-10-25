// mcpValidate — a tool's arguments held to its own schema before it runs.
//
//   node --test src/lib/mcpValidate.test.mjs
//
// Two promises are kept here. Every call a tool can legitimately receive is
// still let through (the first test builds one for every tool from its own
// schema), and every refusal names the path and what would have been accepted,
// because a model can only fix what it is told about.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, ApiError, apiErrorFrom, describeApiError } from './mcpTools.js';
import { checkArgs, argsProblemText } from './mcpValidate.js';

const ID = '3f2a6c1e-8b4d-4e7a-9c1f-2d5e8a7b6c4d';
const tool = (name) => TOOLS.find((t) => t.name === name).inputSchema;

// The least a schema accepts: its required fields, each with a value that
// satisfies every constraint it declares.
function example(schema) {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum) return schema.enum[0];
  if (type === 'string') {
    if (schema.format === 'uuid') return ID;
    return 'x'.repeat(Math.max(1, schema.minLength || 1));
  }
  if (type === 'number' || type === 'integer') return schema.minimum ?? 1;
  if (type === 'boolean') return true;
  if (type === 'array') {
    return Array.from({ length: Math.max(1, schema.minItems || 0) }, () => example(schema.items || {}));
  }
  if (type === 'object') {
    return Object.fromEntries((schema.required || []).map((k) => [k, example(schema.properties[k])]));
  }
  return 'x';
}

test('every tool accepts the least call its schema describes', () => {
  assert.ok(TOOLS.length > 20);
  for (const t of TOOLS) {
    const args = example(t.inputSchema);
    const { problems } = checkArgs(t.inputSchema, args);
    assert.deepEqual(problems, [], `${t.name} refused ${JSON.stringify(args)}`);
  }
});

test('a misspelt argument is refused with the one it meant', () => {
  const { problems } = checkArgs(tool('read_board'), { boardId: ID });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^boardId is not an argument here — did you mean board_id\?$/);
  assert.match(problems[1], /^board_id is required \(an id/);
});

test('a key with no near match lists what the tool does take', () => {
  const { problems } = checkArgs(tool('arrange_board'), { board_id: ID, style: 'neat' });
  assert.match(problems[0], /style is not an argument here \(it takes board_id, layout, /);
});

test('a name where an id belongs says where ids come from', () => {
  const { problems } = checkArgs(tool('read_board'), { board_id: 'Diner — night' });
  assert.match(problems[0], /^board_id must be an id .* \(got "Diner — night"\) — use the id from a search or list result, not a name$/);
});

test('null and empty strings mean "not given", and a required one is missing once', () => {
  const ok = checkArgs(tool('search'), { q: 'neon', workspace_id: null, kind: '', limit: null });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.args, { q: 'neon' });
  const missing = checkArgs(tool('read_board'), { board_id: null });
  assert.deepEqual(missing.problems, [missing.problems[0]]);
  assert.match(missing.problems[0], /^board_id is required/);
  // Where null IS a value — moving a board to the top level — it is kept.
  const top = checkArgs(tool('rename_board'), { board_id: ID, parent_board_id: null });
  assert.deepEqual(top.problems, []);
  assert.equal(top.args.parent_board_id, null);
});

test('numbers, booleans and lists sent as text are read as what they obviously are', () => {
  const { args, problems } = checkArgs(tool('read_board'), { board_id: ID, limit: '50', full: 'true' });
  assert.deepEqual(problems, []);
  assert.equal(args.limit, 50);
  assert.equal(args.full, true);
  const moved = checkArgs(tool('move_cards'), { from_board_id: ID, to_board_id: ID, card_ids: '["a","b"]' });
  assert.deepEqual(moved.problems, []);
  assert.deepEqual(moved.args.card_ids, ['a', 'b']);
  // and the whole arguments object as JSON text, as some hosts send it
  const whole = checkArgs(tool('read_board'), JSON.stringify({ board_id: ID }));
  assert.deepEqual(whole.problems, []);
  assert.equal(whole.args.board_id, ID);
});

test('an enum value in the wrong case is the value it means; a wrong one lists the choices', () => {
  const fixed = checkArgs(tool('arrange_board'), { board_id: ID, layout: 'Masonry' });
  assert.deepEqual(fixed.problems, []);
  assert.equal(fixed.args.layout, 'masonry');
  const wrong = checkArgs(tool('arrange_board'), { board_id: ID, layout: 'spiral' });
  assert.match(wrong.problems[0], /^layout must be one of justified, masonry, grid, row, column \(got "spiral"\)$/);
});

test('a problem inside a list names its place in it', () => {
  const { problems } = checkArgs(tool('add_cards'), {
    board_id: ID,
    cards: [{ kind: 'note', title: 'ok' }, { kind: 'text', title: 'no' }],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^cards\[1\]\.kind must be one of note, image, /);
});

test('too many items says to split the call, and ranges say what they allow', () => {
  const urls = Array.from({ length: 101 }, (_, i) => `https://example.com/${i}.jpg`);
  const { problems } = checkArgs(tool('import_urls'), { board_id: ID, urls });
  assert.match(problems[0], /^urls takes at most 100 items \(got 101\) — split it across calls$/);
  const range = checkArgs(tool('read_board'), { board_id: ID, limit: 9000 });
  assert.match(range.problems[0], /^limit must be at most 500 \(got 9000\)$/);
  const short = checkArgs(tool('search'), { q: 'a' });
  assert.match(short.problems[0], /^q must be at least 2 characters \(got 1\)$/);
});

test('free-form properties keep every key, nulls included — null is how a key is removed', () => {
  const { args, problems } = checkArgs(tool('set_metadata'), {
    board_id: ID, props: { 'shot.status': 'final', 'shot.notes': null },
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(args.props, { 'shot.status': 'final', 'shot.notes': null });
});

test('a value of the wrong kind says what it is and what was wanted', () => {
  const { problems } = checkArgs(tool('add_cards'), { board_id: ID, cards: { kind: 'note' } });
  assert.match(problems[0], /^cards must be a list \(got an object\)$/);
  const bad = checkArgs(tool('arrange_board'), { board_id: ID, dry_run: 'perhaps' });
  assert.match(bad.problems[0], /^dry_run must be true or false \(got the string "perhaps"\)$/);
});

test('arguments that are not an object are refused outright', () => {
  for (const v of [[], 'not json', 42]) {
    const { problems } = checkArgs(tool('whoami'), v);
    assert.match(problems[0], /^arguments must be an object/);
  }
  assert.deepEqual(checkArgs(tool('whoami'), undefined).problems, []);
});

test('a refusal lists at most a handful of problems, under the tool\'s name', () => {
  const cards = Array.from({ length: 20 }, () => ({ kind: 'nope' }));
  const { problems } = checkArgs(tool('add_cards'), { board_id: ID, cards });
  assert.ok(problems.length <= 6);
  const text = argsProblemText('add_cards', problems);
  assert.match(text, /^Invalid arguments for add_cards:\n- cards\[0\]\.kind/);
});

// ── the sentence a failed call becomes ───────────────────────────────────────

test('an API refusal reads as the API wrote it, with its code', () => {
  const e = apiErrorFrom(402, { error: 'Demo accounts are limited to 50 cards', code: 'limit_reached' });
  assert.ok(e instanceof ApiError);
  assert.equal(describeApiError(e), 'Demo accounts are limited to 50 cards [limit_reached]');
});

test('a missing scope says what the connection may do and how to get more', () => {
  const e = apiErrorFrom(403, {
    error: 'this token cannot delete', code: 'insufficient_scope', required_scope: 'delete', scopes: ['read', 'write'],
  });
  const text = describeApiError(e);
  assert.match(text, /^this token cannot delete\. This connection may: read, write\. To allow more, connect again/);
  assert.match(text, /Settings → Connections/);
  assert.match(text, /\[insufficient_scope\]$/);
});

test('a rate limit carries the token\'s own limit and when to retry', () => {
  const headers = new Headers({ 'retry-after': '42', 'x-ratelimit-limit': '1000' });
  const text = describeApiError(apiErrorFrom(429, { error: 'rate limit exceeded' }, headers));
  assert.equal(text, 'Rate limited by Clusters (1000 requests an hour for this token). Retry in 42s. [rate_limited]');
});

test('a tool\'s own refusal reads as written; a bug never shows its internals', () => {
  assert.equal(describeApiError(new Error('upload_file needs a local filesystem')),
    'upload_file needs a local filesystem');
  const bug = describeApiError(new TypeError("Cannot read properties of undefined (reading 'cards')"));
  assert.doesNotMatch(bug, /undefined|cards/);
  assert.match(bug, /\[internal_error\]$/);
  const raw = describeApiError(Object.assign(new SyntaxError('Unexpected token < in JSON'), {}));
  assert.doesNotMatch(raw, /Unexpected token/);
  assert.match(describeApiError(new TypeError('fetch failed')), /Could not reach Clusters.*\[network\]$/);
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  assert.match(describeApiError(timeout), /took too long.*\[timeout\]$/);
});
