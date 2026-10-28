// The board as drawn (GET /boards/:id/canvas, the inline view's data): what
// goes out for each card, and above all which pictures get an address.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS, planCanvas, canvasAnswer, blurhashTone } from './canvasView.js';

const BOARD = { id: 'b1', name: 'Diner', bg_color: '#101014' };
const CHILD = '9d2e4f66-1c2e-4d3f-8a3b-4c5d6e7f8091';
const LINKED = '0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5';

async function answer(cards, { groups = [], imageRows = [], boardRows = [], board = BOARD } = {}) {
  const signed = [];
  const plan = planCanvas(cards, groups);
  const out = await canvasAnswer({
    board,
    boardUrl: 'https://clusters.test/?to=b:b1',
    plan,
    imageRows,
    boardRows,
    sign: async (key) => { signed.push(key); return `https://clusters.test/api/img/${key}`; },
    expiresAt: 1_800_000_000,
  });
  return { out, signed, plan };
}

test('a blurhash\'s average colour is the picture\'s tone', () => {
  // The format's own example: characters 2–5, "HV6n", are 17·83³ + 31·83² +
  // 6·83 + 49 = 0x979695 in base 83, its average sRGB colour.
  assert.equal(blurhashTone('LEHV6nWB2yk8pyo0adR*.7kCMdnj'), '#979695');
  assert.equal(blurhashTone('L5' + '0000' + 'rest'), '#000000');
  for (const bad of [null, '', 'LE', 'LE"bad', 42, 'L5~~~~xx']) assert.equal(blurhashTone(bad), null, String(bad));
});

test('what is read first: the cards drawn in reading order, the keys found on them, the clusters named', () => {
  const cards = [
    { id: 'late', kind: 'note', x: 0, y: 900 },
    { id: 'i1', kind: 'image', src: 'r2:w1/a.jpg', x: 300, y: 0 },
    { id: 'v1', kind: 'video', src: 'r2:w1/v.mp4', poster: 'r2:w1/p.jpg', x: 0, y: 0 },
    { id: 'l1', kind: 'link', image: 'r2:w1/og.jpg', url: 'https://example.com', x: 600, y: 0 },
    { id: 'x1', kind: 'image', src: 'https://example.com/hotlinked.jpg', x: 900, y: 0 },
    { id: CHILD, kind: 'board', x: 0, y: 400 },
    { id: 'bl', kind: 'boardlink', target: LINKED, x: 300, y: 400 },
    { id: 'gone', kind: 'image', src: 'r2:w1/unplaced.jpg', unplaced: true, x: 0, y: 0 },
  ];
  const plan = planCanvas(cards);
  assert.deepEqual(plan.drawn.map((c) => c.id), ['v1', 'i1', 'l1', 'x1', CHILD, 'bl', 'late']);
  assert.deepEqual(plan.keys.sort(), ['w1/a.jpg', 'w1/og.jpg', 'w1/p.jpg'], 'stored pictures only, never a web address');
  assert.deepEqual(plan.boardIds.sort(), [LINKED, CHILD].sort());
  assert.equal(plan.placed, 7, 'a card in the cluster but not on its board is not counted');
});

test('a picture gets an address only once the caller\'s own read has found it, at its small size', async () => {
  const { out, signed } = await answer([
    { id: 'i1', kind: 'image', src: 'r2:w1/a.jpg', x: 0, y: 0, w: 300, h: 200 },
    // On the board, but the caller can't read its row: no address, no picture.
    { id: 'i2', kind: 'image', src: 'r2:elsewhere/secret.jpg', x: 400, y: 0, w: 300, h: 200 },
    // Large, with no renditions: drawn in its colour, never served whole.
    { id: 'i3', kind: 'image', src: 'r2:w1/huge.jpg', x: 800, y: 0, w: 300, h: 200 },
    { id: 'i4', kind: 'image', src: 'r2:w1/small.png', x: 1200, y: 0, w: 300, h: 200 },
  ], {
    imageRows: [
      { storage_path: 'w1/a.jpg', preview_sm_path: 'w1/a_sm.webp', preview_sm_w: 640, preview_sm_h: 427,
        preview_path: 'w1/a_pv.webp', width: 6000, height: 4000, size_bytes: 9_000_000, blur_hash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' },
      { storage_path: 'w1/huge.jpg', width: 8000, height: 6000, size_bytes: 30_000_000, blur_hash: 'L5000000' },
      { storage_path: 'w1/small.png', width: 300, height: 200, size_bytes: 20_000 },
    ],
  });
  assert.deepEqual(signed, ['w1/a_sm.webp', 'w1/small.png'], 'the small rendition, or an original that is small');
  const by = Object.fromEntries(out.cards.map((c) => [c.id, c]));
  assert.deepEqual(by.i1.picture, { url: 'https://clusters.test/api/img/w1/a_sm.webp', width: 640, height: 427, tone: '#979695' });
  assert.equal(by.i2.picture, undefined);
  assert.deepEqual(by.i3.picture, { width: 8000, height: 6000, tone: '#000000' });
  assert.equal(by.i4.picture.url, 'https://clusters.test/api/img/w1/small.png');
  assert.equal(out.picture_count, 3);
  assert.ok(!JSON.stringify(out).includes('secret'), 'a key the caller can\'t read never leaves');
  assert.equal(out.expires_at, new Date(1_800_000_000 * 1000).toISOString());
});

test('past the picture budget, pictures are drawn in their colour', async () => {
  const n = CANVAS.maxPictures + 5;
  const cards = Array.from({ length: n }, (_, i) => ({ id: `i${i}`, kind: 'image', src: `r2:w1/${i}.jpg`, x: i * 10, y: 0 }));
  const rows = cards.map((_, i) => ({ storage_path: `w1/${i}.jpg`, preview_sm_path: `w1/${i}_sm.webp`, blur_hash: 'L5000000' }));
  const { out, signed } = await answer(cards, { imageRows: rows });
  assert.equal(signed.length, CANVAS.maxPictures);
  assert.equal(out.picture_count, n);
  assert.equal(out.cards.filter((c) => c.picture?.url).length, CANVAS.maxPictures);
  assert.ok(out.cards.every((c) => c.picture?.tone === '#000000'));
});

test('a cluster\'s card is its thumbnail and its name; a linked one is named after its target', async () => {
  const { out, signed } = await answer([
    { id: CHILD, kind: 'board', x: 0, y: 0, w: 200, h: 150 },
    { id: 'bl', kind: 'boardlink', target: LINKED, note: 'see also', x: 300, y: 0, w: 200, h: 80 },
  ], {
    boardRows: [
      { id: CHILD, name: 'Locations', thumb_key: 'w1/thumbs/loc.webp' },
      { id: LINKED, name: 'Wardrobe', thumb_key: 'w1/thumbs/ward.webp' },
    ],
  });
  assert.deepEqual(signed, ['w1/thumbs/loc.webp'], 'a link to a cluster is drawn as a card, not its picture');
  const [board, link] = out.cards;
  assert.equal(board.title, 'Locations');
  assert.equal(board.picture.url, 'https://clusters.test/api/img/w1/thumbs/loc.webp');
  assert.equal(link.title, 'Wardrobe');
  assert.equal(link.text, 'see also');
  assert.equal(link.picture, undefined);
  // A cluster the caller can't read keeps its place and nothing else.
  const hidden = await answer([{ id: CHILD, kind: 'board', x: 0, y: 0 }]);
  assert.equal(hidden.out.cards[0].title, undefined);
  assert.deepEqual(hidden.signed, []);
});

test('what a card shows at a glance, clipped, with colours only as plain hex', async () => {
  const long = 'Neon '.repeat(60);
  const { out } = await answer([
    { id: 'n1', kind: 'note', html: `<p>${long}</p><script>alert(1)</script>`, bgColor: '#FFF3C4', textColor: 'url(javascript:1)', x: 0, y: 0 },
    { id: 'n2', kind: 'note', body: 'Bare', bgColor: 'transparent', textColor: '#3A2E00', x: 300, y: 0 },
    { id: 'n3', kind: 'note', body: 'Red', bgColor: 'red', x: 600, y: 0 },
    { id: 'p1', kind: 'palette', x: 0, y: 300,
      swatches: ['#0B1A2E', { hex: '#e8a33d', name: 'Sodium' }, { color: '#c2185b' }, 'tomato', { hex: 'expression(x)' },
        ...Array.from({ length: 20 }, () => '#123456')] },
    { id: 'l1', kind: 'link', url: 'https://www.criterion.com/films/1', title: 'T'.repeat(200), x: 300, y: 300 },
    { id: 'd1', kind: 'doc', title: 'Treatment', lines: ['A night-shift detective', { t: 'walks Shinjuku' }, { text: 'at dawn' }], x: 600, y: 300 },
    { id: 'f1', kind: 'pdf', fileName: 'Sides.pdf', x: 900, y: 300 },
  ]);
  const by = Object.fromEntries(out.cards.map((c) => [c.id, c]));
  assert.equal(by.n1.text.length, CANVAS.textMax);
  assert.ok(by.n1.text.endsWith('…'));
  assert.ok(!by.n1.text.includes('<'), 'text, never markup');
  assert.equal(by.n1.color, '#fff3c4');
  assert.equal(by.n1.ink, undefined, 'only a hex colour reaches a style');
  assert.equal(by.n2.color, 'transparent');
  assert.equal(by.n2.ink, '#3a2e00');
  assert.equal(by.n3.color, undefined);
  assert.equal(by.p1.swatches.length, CANVAS.swatchesMax);
  assert.deepEqual(by.p1.swatches.slice(0, 3), [{ hex: '#0b1a2e' }, { hex: '#e8a33d', name: 'Sodium' }, { hex: '#c2185b' }]);
  assert.equal(by.l1.domain, 'criterion.com');
  assert.equal(by.l1.title.length, CANVAS.titleMax);
  assert.equal(by.d1.text, 'A night-shift detective walks Shinjuku at dawn');
  assert.equal(by.f1.title, 'Sides.pdf');
});

// The API writes a note's title as the heading of its html (noteCompose), and
// the view would then show it twice: once as the card's title, once as the
// start of its text.
test('a note that opens with a heading is titled by it, and its text is what follows', async () => {
  const { out } = await answer([
    { id: 'n1', kind: 'note', x: 0, y: 0, title: 'MARTY SUPREME (2025)',
      html: '<h2>MARTY SUPREME (2025)</h2><p>9.75 / 10</p><p></p><p>One of your highest-rated films.</p>' },
    { id: 'n2', kind: 'note', x: 300, y: 0, html: '<h1>Shot list</h1><ul><li><p>Wide</p></li></ul>' },
    { id: 'n3', kind: 'note', x: 600, y: 0, title: 'Kept', html: '<p>No heading here</p>' },
  ]);
  const [a, b, c] = out.cards;
  assert.deepEqual([a.title, a.text], ['MARTY SUPREME (2025)', '9.75 / 10 One of your highest-rated films.']);
  assert.deepEqual([b.title, b.text], ['Shot list', 'Wide']);
  assert.deepEqual([c.title, c.text], ['Kept', 'No heading here']);
});

test('cards come in their stacking order, groups round their members, and the board\'s extent', async () => {
  const { out } = await answer([
    { id: 'top', kind: 'note', z: 5, x: 0, y: 0, w: 100, h: 100, groupId: 'g1' },
    { id: 'under', kind: 'note', z: 1, x: 50, y: 50, w: 100, h: 100, groupId: 'g1', rotation: 4 },
    { id: 'plain', kind: 'note', x: 500, y: 20, w: 120.04, h: 80 },
  ], {
    groups: [
      { id: 'g1', name: 'Streets', color: '#E8A33D', outline: false },
      { id: 'empty', name: 'Nothing in it' },
    ],
  });
  assert.deepEqual(out.cards.map((c) => c.id), ['plain', 'under', 'top'], 'z first, unset z at the bottom');
  assert.equal(out.cards.find((c) => c.id === 'under').rotation, 4);
  assert.equal(out.cards.find((c) => c.id === 'plain').w, 120);
  assert.deepEqual(out.groups, [{ id: 'g1', x: 0, y: 0, w: 150, h: 150, name: 'Streets', color: '#e8a33d', outline: false }]);
  assert.deepEqual(out.bounds, { x: 0, y: 0, w: 620, h: 150 });
  assert.deepEqual(out.board, { id: 'b1', name: 'Diner', url: 'https://clusters.test/?to=b:b1', card_count: 3, background: '#101014' });
  assert.equal(out.hidden, 0);
});

test('a board past the drawing budget draws the first cards in reading order and counts the rest', async () => {
  const n = CANVAS.maxCards + 7;
  const cards = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: 'note', body: 'x', x: (i % 20) * 100, y: Math.floor(i / 20) * 100 }));
  const { out } = await answer(cards);
  assert.equal(out.cards.length, CANVAS.maxCards);
  assert.equal(out.hidden, 7);
  assert.equal(out.board.card_count, n);
  assert.ok(!out.cards.some((c) => c.id === `n${n - 1}`), 'the last in reading order is the one left out');
  // Small enough for any host: Claude writes a tool result over ~150,000
  // characters to a file, and the view would then get nothing.
  assert.ok(JSON.stringify(out).length < 120_000, `${JSON.stringify(out).length} characters`);
});

test('an empty board has no extent, and a board with no colour of its own says none', async () => {
  const { out } = await answer([], { board: { id: 'b1', name: 'Empty', bg_color: 'not a colour' } });
  assert.equal(out.bounds, null);
  assert.deepEqual(out.cards, []);
  assert.equal('background' in out.board, false);
  assert.equal(out.picture_count, 0);
});
