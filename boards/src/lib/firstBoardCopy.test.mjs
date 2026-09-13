// firstBoardCopy.test.mjs — what the first board says, given what we already know.
//
//   node --test src/lib/firstBoardCopy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstBoardKindFrom, firstBoardCopy, FIRST_BOARD_WORDS, FIRST_BOARD_TILE_IDS } from './firstBoardCopy.js';

test('a picked intent wins over every source hint', () => {
  assert.equal(firstBoardKindFrom({ intent: 'storyboard', landingPath: '/vs/pureref' }), 'storyboard');
  assert.equal(firstBoardKindFrom({ intent: 'references', referrerHost: 'www.reddit.com' }), 'references');
  assert.equal(firstBoardKindFrom({ intent: 'exploring', landingPath: '/vs/pureref' }), 'references', '"exploring" is not a kind; the source still speaks');
});

test('landing pages and referrers map to a kind', () => {
  assert.equal(firstBoardKindFrom({ landingPath: '/vs/pureref' }), 'references');
  assert.equal(firstBoardKindFrom({ landingPath: '/tools/reference-board-maker' }), 'references');
  assert.equal(firstBoardKindFrom({ landingPath: '/tools/storyboard-maker' }), 'storyboard');
  assert.equal(firstBoardKindFrom({ landingPath: '/tools/shot-list-maker' }), 'storyboard');
  assert.equal(firstBoardKindFrom({ landingPath: '/tools/mood-board-maker' }), 'moodboard');
  assert.equal(firstBoardKindFrom({ landingPath: '/tools/look-book-maker' }), 'moodboard');
  assert.equal(firstBoardKindFrom({ referrerHost: 'chatgpt.com' }), 'references');
  assert.equal(firstBoardKindFrom({ utmSource: 'openai' }), 'references');
  assert.equal(firstBoardKindFrom({ referrerHost: 'www.reddit.com' }), 'moodboard');
  assert.equal(firstBoardKindFrom({ landingPath: '/', referrerHost: 'www.google.com' }), null);
  assert.equal(firstBoardKindFrom(null), null);
});

test('copy names the job and always asks for material from elsewhere', () => {
  const r = firstBoardCopy('references');
  assert.equal(r.head, 'Start your reference wall');
  assert.match(r.heroHint, /paste|drag/i);
  assert.match(r.heroHint, /folder/i);
  const m = firstBoardCopy('moodboard');
  assert.equal(m.head, 'Start your moodboard');
  const d = firstBoardCopy(null);
  assert.equal(d.head, null, 'no kind → rotating headline');
  assert.equal(d.heroLabel, 'Add images');
  assert.match(firstBoardCopy('references', { coarse: true }).heroHint, /camera roll/i);
});

test('the rotating list names the best-returning intent, and the first board offers only writing tiles', () => {
  assert.ok(FIRST_BOARD_WORDS.includes('reference wall'));
  assert.deepEqual([...FIRST_BOARD_TILE_IDS], ['note', 'doc']);
});
