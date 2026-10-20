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
  assert.equal(firstBoardKindFrom({ landingPath: '/tools/cinematography-lookbook' }), 'moodboard');
  assert.equal(firstBoardKindFrom({ landingPath: '/tools/directors-treatment' }), 'treatment');
  assert.equal(firstBoardCopy('treatment').head, 'Start your treatment');
  assert.match(firstBoardCopy('treatment').heroHint, /folder/i);
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

test('where the setup runs, the hint names links too; a phone keeps the camera roll', () => {
  assert.equal(firstBoardCopy(null, { links: true }).heroHint, 'Paste images or links from any tab, or drop a whole folder');
  assert.equal(firstBoardCopy('moodboard', { links: true }).heroHint, 'Paste images or links from any tab, or drop a whole folder');
  assert.equal(firstBoardCopy('storyboard', { links: true }).heroHint, 'Paste images or links from any tab, or drop a folder of frames');
  assert.equal(firstBoardCopy('storyboard').heroHint, 'Paste or drag images from any tab, or drop a folder of frames', 'unchanged without it');
  assert.equal(firstBoardCopy(null).heroHint, 'Paste or drag images from any tab, or drop a whole folder', 'unchanged without it');
  assert.match(firstBoardCopy(null, { links: true, coarse: true }).heroHint, /camera roll/i);
});

test('a joiner\'s empty workspace names it and whose it is, whatever the kind', () => {
  const j = firstBoardCopy('storyboard', { links: true, join: { ws: 'Lost Time', by: 'Maya' } });
  assert.equal(j.head, 'Start Lost Time with Maya');
  assert.equal(j.heroLabel, 'Add the first images');
  assert.equal(j.heroHint, 'Paste images or links from any tab, or drop a folder. Maya sees them as they land.');
  assert.equal(firstBoardCopy(null, { join: { ws: 'Lost Time', by: 'Maya' }, coarse: true }).heroHint,
    'Pick several from your camera roll at once. Maya sees them as they land.');
  const noName = firstBoardCopy(null, { join: { ws: 'Lost Time', by: '' } });
  assert.equal(noName.head, 'Start Lost Time');
  assert.equal(noName.heroHint, 'Paste images or links from any tab, or drop a folder. Everyone in it sees them as they land.');
  assert.equal(firstBoardCopy(null, { join: { ws: 'Personal Workspace', by: 'Maya' } }).head, 'Start this workspace with Maya',
    'the old default name is not read back as a name');
  assert.equal(firstBoardCopy(null, { join: { ws: '  Lost\n Time ', by: ' Maya ' } }).head, 'Start Lost Time with Maya');
  assert.equal(firstBoardCopy(null, { join: { ws: null, by: null } }).head, 'Start this workspace');
});
