// Writing comments before and after the migration that adds mentions / edited_at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnknownColumnError, createColumnProbe, mentionIds, withMentions } from './commentColumns.js';

test('the refusal for a column the table does not have is recognised', () => {
  assert.equal(isUnknownColumnError({ code: 'PGRST204', message: "Could not find the 'mentions' column of 'comments' in the schema cache" }, 'mentions'), true);
  assert.equal(isUnknownColumnError({ code: '42703', message: 'column "mentions" of relation "comments" does not exist' }, 'mentions'), true);
  assert.equal(isUnknownColumnError({ code: 'PGRST204', message: "Could not find the 'edited_at' column" }, 'mentions'), false);
  assert.equal(isUnknownColumnError({ code: '42501', message: 'mentions' }, 'mentions'), false);
  assert.equal(isUnknownColumnError(null, 'mentions'), false);
});

test('the probe learns from a row, and from a refusal', () => {
  const p = createColumnProbe();
  assert.equal(p.has('mentions'), null);
  p.learn({ id: '1', body: 'x' });
  assert.equal(p.has('mentions'), false);
  assert.equal(p.has('edited_at'), false);
  p.learn({ id: '1', body: 'x', mentions: [], edited_at: null });
  assert.equal(p.has('mentions'), true);
  assert.equal(p.has('edited_at'), true);
  p.missing('mentions');
  assert.equal(p.has('mentions'), false);
  p.learn(null); p.learn({ nope: 1 });
  assert.equal(p.has('edited_at'), true);
});

test('mention ids: each once, ids only, at most 20', () => {
  assert.deepEqual(mentionIds([{ id: 'a', name: 'A' }, 'b', { id: 'a' }, null, { name: 'x' }]), ['a', 'b']);
  assert.equal(mentionIds(Array.from({ length: 30 }, (_, i) => `u${i}`)).length, 20);
  assert.deepEqual(mentionIds(undefined), []);
});

test('a new comment carries mentions only when someone is mentioned and the column may exist', () => {
  assert.deepEqual(withMentions({ body: 'hi' }, [], null, { insert: true }), { body: 'hi' });
  assert.deepEqual(withMentions({ body: 'hi' }, [{ id: 'a', name: 'A' }], null, { insert: true }), { body: 'hi', mentions: ['a'] });
  assert.deepEqual(withMentions({ body: 'hi' }, [{ id: 'a', name: 'A' }], true, { insert: true }), { body: 'hi', mentions: ['a'] });
  assert.deepEqual(withMentions({ body: 'hi' }, [{ id: 'a', name: 'A' }], false, { insert: true }), { body: 'hi' });
});

test('an edit clears mentions that left the words, unless the column is missing or was not asked for', () => {
  assert.deepEqual(withMentions({ body: 'hi' }, [], true), { body: 'hi', mentions: [] });
  assert.deepEqual(withMentions({ body: 'hi' }, [], null), { body: 'hi', mentions: [] });
  assert.deepEqual(withMentions({ body: 'hi', mentions: ['old'] }, [], false), { body: 'hi' });
  assert.deepEqual(withMentions({ resolved: true }, undefined, true), { resolved: true });
});

test('a pasted copy keeps who its words "@" when the table has the column', async () => {
  const { copiedMentions } = await import('./commentColumns.js');
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(copiedMentions({ id: 'x', mentions: [a, b, a] }, true), { mentions: [a, b] });
  // not asked about yet, but the original came back with the key: it exists
  assert.deepEqual(copiedMentions({ id: 'x', mentions: [a] }, null), { mentions: [a] });
  // nobody mentioned: the column's default does, and nothing is sent
  assert.deepEqual(copiedMentions({ id: 'x', mentions: [] }, true), {});
  // before the migration: the original has no such key, or the probe says no
  assert.deepEqual(copiedMentions({ id: 'x' }, null), {});
  assert.deepEqual(copiedMentions({ id: 'x', mentions: [a] }, false), {});
  assert.deepEqual(copiedMentions(null, true), {});
  assert.equal(copiedMentions({ mentions: Array.from({ length: 30 }, (_, i) => `u${i}`) }, true).mentions.length, 20);
});
