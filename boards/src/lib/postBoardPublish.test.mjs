// publishPostBoard (scripts/lib/showcaseWrite.mjs): a post board's unlisted public address.
// 0860's check wants a maker on every unlisted row, so the row carries created_by.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishPostBoard } from '../../scripts/lib/showcaseWrite.mjs';

// A supabase stand-in that records each public_boards upsert and answers from `errors` in turn.
function fake(errors = []) {
  const calls = [];
  const supa = { from(table) {
    return { upsert(row, opts) {
      calls.push({ table, row, opts });
      const error = errors[calls.length - 1] || null;
      return Promise.resolve({ error });
    } };
  } };
  return { supa, calls };
}

const base = { boardId: 'b1', userId: 'u1', title: 'A board', description: 'About it.' };

test('the row is unlisted, from a post, and names its maker', async () => {
  const { supa, calls } = fake();
  const r = await publishPostBoard({ ...base, supa, words: ['gaffer'] });
  assert.deepEqual(r, { slug: 'gaffer' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'public_boards');
  const row = calls[0].row;
  assert.equal(row.created_by, 'u1');
  assert.equal(row.unlisted, true);
  assert.equal(row.published_by, 'post');
  assert.equal(row.board_id, 'b1');
  assert.equal(row.slug, 'gaffer');
  assert.deepEqual(calls[0].opts, { onConflict: 'board_id' });
});

test('a taken word (23505) moves on to the next', async () => {
  const { supa, calls } = fake([{ code: '23505', message: 'dup' }]);
  const r = await publishPostBoard({ ...base, supa, words: ['gaffer', 'dolly'] });
  assert.deepEqual(r, { slug: 'dolly' });
  assert.deepEqual(calls.map((c) => c.row.slug), ['gaffer', 'dolly']);
});

test('another error stops and reports', async () => {
  const { supa, calls } = fake([{ code: '23514', message: 'check failed' }]);
  const r = await publishPostBoard({ ...base, supa, words: ['gaffer', 'dolly'] });
  assert.match(r.why, /check failed/);
  assert.equal(calls.length, 1);
});

test('a reserved or malformed word is skipped without a write', async () => {
  const { supa, calls } = fake();
  const r = await publishPostBoard({ ...base, supa, words: ['admin', 'Bad Word!', '', 'a--b', 'dolly'] });
  assert.deepEqual(r, { slug: 'dolly' });
  assert.deepEqual(calls.map((c) => c.row.slug), ['dolly']);
});

test('no usable word writes nothing', async () => {
  const { supa, calls } = fake();
  const r = await publishPostBoard({ ...base, supa, words: ['admin', 'x y'] });
  assert.ok(r.why);
  assert.equal(calls.length, 0);
});

test('no userId writes nothing', async () => {
  const { supa, calls } = fake();
  const r = await publishPostBoard({ ...base, userId: undefined, supa, words: ['gaffer'] });
  assert.deepEqual(r, { why: 'no maker' });
  assert.equal(calls.length, 0);
});
