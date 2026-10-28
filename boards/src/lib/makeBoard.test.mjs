import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMakeFragment } from './makeLink.js';
import { composeMakeBoard, pictureShape } from './makeBoard.js';
import { normalizeIncomingCard } from '../worker-api.js';

const NOW = '2026-10-28T00:00:00.000Z';
const MOODBOARD = parseMakeFragment('title=Tokyo%20noir&section=Look'
  + '&pic=https://example.com/1.jpg|Street&pic=https://example.com/2.jpg&pic=https://example.com/3.jpg'
  + '&pic=https://example.com/4.jpg&palette=Night|%23101820%20Ink,%23f2aa4c%20Sodium'
  + '&section=Story&note=Logline|A%20night-shift%20cabbie%20and%20a%20singer.'
  + '&note=Characters|-%20Kenji%0A-%20Mariko&end=7');
const DIARY = parseMakeFragment('title=Film%20diary&section=Watched&note=Chinatown|1974.%20Polanski.'
  + '&note=Taxi%20Driver|1976&section=Next&note=Blade%20Runner|1982&note=Heat|1995'
  + '&section=Notes&note=Why|Night%20cities%20on%20film.&end=5');
const DIMS = [{ width: 1600, height: 1067 }, { width: 1000, height: 1500 }, { width: 1200, height: 800 }, { width: 800, height: 800 }];

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('every card is laid out in whole pixels, none on another', () => {
  for (const [board, pictures] of [[MOODBOARD, DIMS], [DIARY, []]]) {
    const { cards } = composeMakeBoard(board, { pictures, now: NOW });
    assert.equal(cards.length, board.count);
    for (const c of cards) {
      for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(c[k]), `${c.id}.${k} = ${c[k]}`);
      assert.ok(c.w >= 40 && c.h >= 40);
    }
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) assert.ok(!overlaps(cards[i], cards[j]), `${cards[i].id} × ${cards[j].id}`);
    }
    assert.deepEqual(cards.map((c) => c.z), cards.map((_, i) => i + 1));
  }
});

test('sections become groups in the API\'s named colours, one each', () => {
  const { groups, wireGroups, cards } = composeMakeBoard(DIARY, { now: NOW });
  assert.deepEqual(groups.map((g) => g.name), ['Watched', 'Next', 'Notes']);
  assert.equal(new Set(groups.map((g) => g.color)).size, 3);
  assert.deepEqual(wireGroups, groups.map((g) => ({ name: g.name, color: g.color })));
  for (const g of groups) assert.deepEqual([g.shape, g.outline, g.createdAt], ['box', true, NOW]);
  assert.ok(cards.every((c) => groups.some((g) => g.id === c.groupId)));
  // A colour the link gave is kept.
  const blue = composeMakeBoard(parseMakeFragment('section=A|%233f7ab5&note=x&section=B&note=y'), { now: NOW });
  assert.equal(blue.groups[0].color, '#3f7ab5');
  assert.notEqual(blue.groups[1].color, '#3f7ab5');
});

test('notes take their section\'s tint on a board of words; a moodboard\'s stay plain', () => {
  const diary = composeMakeBoard(DIARY, { now: NOW });
  assert.ok(diary.cards.every((c) => /^#[0-9a-f]{6}$/.test(c.bgColor)), 'tinted');
  assert.ok(diary.wire.every((c) => c.color === diary.cards.find((x) => x.x === c.x && x.y === c.y).bgColor));
  const mood = composeMakeBoard(MOODBOARD, { pictures: DIMS, now: NOW });
  const notes = mood.cards.filter((c) => c.kind === 'note');
  assert.ok(notes.length && notes.every((c) => c.bgColor === null));
  assert.ok(mood.wire.filter((c) => c.kind === 'note').every((c) => c.color === ''));
});

test('a picture that didn\'t load is left out, and a section left empty with it', () => {
  const b = parseMakeFragment('section=Pics&pic=https://example.com/a.jpg&section=Words&note=x&note=y');
  const out = composeMakeBoard(b, { pictures: [null], now: NOW });
  assert.equal(out.left, 1);
  assert.deepEqual(out.groups.map((g) => g.name), ['Words']);
  assert.deepEqual(out.cards.map((c) => c.kind), ['note', 'note']);
  // Pictures keep their place among the link's pictures when some fail.
  const two = composeMakeBoard(parseMakeFragment('pic=https://example.com/a.jpg&pic=https://example.com/b.jpg'),
    { pictures: [null, { width: 300, height: 200 }], now: NOW });
  assert.deepEqual(two.wire.map((c) => c.pic), [1]);
  assert.equal(two.cards[0].src, 'https://example.com/b.jpg');
});

test('pictures are their true shape, within reason', () => {
  assert.equal(pictureShape(null), null);
  assert.equal(pictureShape({ width: 0, height: 10 }), null);
  assert.equal(pictureShape({ width: 1600, height: 900 }).aspect, 1600 / 900);
  assert.equal(pictureShape({ width: 10000, height: 10 }).aspect, 8);
  const { cards } = composeMakeBoard(MOODBOARD, { pictures: DIMS, now: NOW });
  const pics = cards.filter((c) => c.kind === 'image');
  pics.forEach((c, i) => {
    const want = DIMS[i].width / DIMS[i].height;
    assert.ok(Math.abs(c.w / c.h - want) < 0.05, `${c.id}: ${c.w}×${c.h} for ${want}`);
  });
});

test('the card route stores each wire card as the page showed it', () => {
  for (const [board, pictures] of [[MOODBOARD, DIMS], [DIARY, []]]) {
    const { cards, wire } = composeMakeBoard(board, { pictures, now: NOW });
    wire.forEach((w, i) => {
      const { pic, ...sent } = w;
      const stored = normalizeIncomingCard(pic == null ? sent : { ...sent, image_key: `ws/${pic}.jpg` });
      const shown = cards[i];
      for (const k of ['kind', 'x', 'y', 'w', 'h', 'title', 'body', 'caption', 'html', 'swatches']) {
        assert.deepEqual(stored[k], shown[k], `${shown.id}.${k}`);
      }
      if (shown.kind === 'note') assert.equal(stored.bgColor, shown.bgColor, `${shown.id}.bgColor`);
      if (shown.kind === 'image') {
        assert.equal(stored.src, `r2:ws/${pic}.jpg`);
        assert.equal(shown.src, board.sections.flatMap((s) => s.items).filter((x) => x.kind === 'picture')[pic].url);
      }
    });
  }
});

test('the same link and pictures make the same board', () => {
  const a = composeMakeBoard(MOODBOARD, { pictures: DIMS, now: NOW });
  const b = composeMakeBoard(MOODBOARD, { pictures: DIMS, now: NOW });
  assert.deepEqual(a, b);
  assert.equal(a.name, 'Tokyo noir');
  assert.equal(composeMakeBoard({ title: null, sections: [] }).name, 'Untitled');
  assert.deepEqual(composeMakeBoard({ sections: [] }).cards, []);
});
