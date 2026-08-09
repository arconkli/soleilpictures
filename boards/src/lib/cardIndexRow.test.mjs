// The card_index projection, and the seam it sits on.
//
// card_index is written from two places — the browser reading a Y.Map, and the
// server reading a plain object — and for a long time they were two hand-kept
// copies with comments asking the next person to keep them matching. They did
// not match. So the projection is one function now, and what this file asserts
// is that BOTH ways of reading a card produce the identical row.
//
// That is the test that would have caught all four drifts, and it is the one
// that keeps them from coming back.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  buildCardIndexRow, buildCardMeta, cardIndexBody, cardIndexWeight,
  htmlToText, cellsOf, isSeedCard,
} from './cardIndexRow.js';
import { buildCardIndexRows } from '../../scripts/lib/cardEncode.mjs';

const WS = 'ws-1';
const BOARD = 'board-1';

// A card as the browser sees it: a Y.Map, with nested Y.Maps for cells.
function asYMap(card) {
  const doc = new Y.Doc();
  const m = new Y.Map();
  doc.getMap('cards').set(String(card.id), m);
  for (const [k, v] of Object.entries(card)) {
    if (k === 'gridCells' && v && typeof v === 'object') {
      const cells = new Y.Map();
      for (const [ck, cv] of Object.entries(v)) {
        const cell = new Y.Map();
        for (const [a, b] of Object.entries(cv)) cell.set(a, b);
        cells.set(ck, cell);
      }
      m.set(k, cells);
    } else {
      m.set(k, v);
    }
  }
  return m;
}

const rowFromYMap = (card, groupNameById) => buildCardIndexRow({
  workspaceId: WS, boardId: BOARD, cardId: card.id,
  get: ((y) => (k) => y.get(k))(asYMap(card)),
  groupNameById,
});
const rowFromPlain = (card, groupNameById) => buildCardIndexRow({
  workspaceId: WS, boardId: BOARD, cardId: card.id,
  get: (k) => card[k], groupNameById,
});

// One card of every kind that carries structure worth getting wrong.
const CORPUS = [
  { id: 'n1', kind: 'note', title: 'Tone', html: '<p>Warm &amp; low-key</p><p>Practicals only</p>', x: 0, y: 0, w: 280, h: 180 },
  { id: 'i1', kind: 'image', src: 'r2:ws/a.jpg', alt: 'Diner counter', w: 300, h: 200, x: 10, y: 20 },
  { id: 'l1', kind: 'link', url: 'https://example.com', title: 'Ref' },
  { id: 'd1', kind: 'doc', title: 'Treatment', lines: [{ text: 'One' }, { text: 'Two', bullet: true }], pages: [{}, {}] },
  { id: 'p1', kind: 'palette', swatches: Array.from({ length: 20 }, (_, i) => `#${i}${i}${i}`) },
  { id: 's1', kind: 'shape', shape: 'ellipse', label: 'Act II' },
  { id: 'v1', kind: 'video', src: 'r2:ws/reel.mov', poster: 'r2:ws/poster.jpg' },
  { id: 'b1', kind: 'board', target: 'board-2' },
  {
    id: 'g1', kind: 'grid', rows: 2, cols: 2, seqFormat: {},
    gridCells: {
      '0': { type: 'image', src: 'r2:ws/1.jpg', alt: 'one' },
      '1': { type: 'text', html: '<p>Second</p>' },
      '2': { type: 'empty' },
      '3': { type: 'image', src: 'r2:ws/2.jpg', alt: 'two' },
    },
  },
  {
    id: 'sch1', kind: 'schedule', schedView: 'month', anchor: '2026-08-01',
    gridCells: { '2026-08-04': { type: 'text', html: 'Shoot day 1' } },
  },
  { id: 'sch2', kind: 'schedule', rows: [{ day: 'Mon', what: 'Prep', loc: 'Stage 3' }] },
  { id: 'sec', kind: 'note', title: 'ACT ONE', sectionHeader: true, sub: 'pages 1–30', x: 0, y: 900 },
];

// ── the seam ─────────────────────────────────────────────────────────────────

test('a Y.Map card and a plain card produce the SAME row, for every kind', () => {
  for (const card of CORPUS) {
    assert.deepEqual(rowFromYMap(card), rowFromPlain(card),
      `${card.kind} (${card.id}) projects differently depending on who reads it`);
  }
});

test('the server entry point agrees with the browser read, card for card', () => {
  // buildCardIndexRows is what /api/v1 and the generator call; the Y.Map read is
  // what the browser calls. This is the whole bug class in one assertion.
  const serverRows = buildCardIndexRows({ workspaceId: WS, boardId: BOARD, cards: CORPUS });
  const browserRows = CORPUS.map((c) => rowFromYMap(c)).filter(Boolean);
  assert.deepEqual(serverRows, browserRows);
});

// ── the four drifts that actually happened ───────────────────────────────────

test('an entity survives indexing — "Tom & Jerry" is not "Tom  Jerry"', () => {
  // The browser's htmlToText replaced every &entity; with a space, so an
  // ampersand in a note silently became whitespace in search.
  assert.equal(htmlToText('<p>Tom &amp; Jerry</p>'), 'Tom & Jerry');
  assert.equal(htmlToText('a &lt;b&gt; c'), 'a <b> c');
});

test('paragraph structure survives indexing', () => {
  // The public /c/<slug> article renders from this body. Collapsing every
  // block to a space turned an article into one paragraph.
  assert.equal(htmlToText('<p>One</p><p>Two</p>'), 'One\nTwo');
  assert.equal(htmlToText('a<br>b'), 'a\nb');
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText(null), '');
});

test('a doc reports both page and line counts', () => {
  const meta = buildCardMeta('doc', (k) => ({ pages: [{}, {}], lines: [{}, {}, {}] }[k]));
  assert.deepEqual(meta, { pageCount: 2, lineCount: 3 },
    'the server used to omit pageCount, so the same doc had two different metas');
});

test('a grid weighs its filled cells — the cap must not move under the user', () => {
  // The server always wrote 1. So a 25-image grid created through the API
  // counted as ONE card against the demo cap, until a human opened the board
  // and it became twenty-five.
  const grid = CORPUS.find((c) => c.id === 'g1');
  assert.equal(rowFromPlain(grid).weight, 3, 'three filled cells of four');
  assert.equal(rowFromYMap(grid).weight, 3);
  assert.equal(rowFromPlain(CORPUS.find((c) => c.id === 'n1')).weight, 1);
  // A LEGACY rows schedule weighs 1; only a cell container is weighed.
  assert.equal(rowFromPlain(CORPUS.find((c) => c.id === 'sch2')).weight, 1);
});

test('group context is recorded, and identically from both sides', () => {
  const card = { id: 'gc', kind: 'note', title: 'x', groupId: 'grp-1' };
  const names = new Map([['grp-1', 'Costume']]);
  assert.equal(rowFromYMap(card, names).meta.groupName, 'Costume');
  assert.deepEqual(rowFromYMap(card, names), rowFromPlain(card, names));
  // Without a groups map — which is the server's situation — the keys are
  // still written, so the shape does not depend on the writer.
  assert.equal(rowFromPlain(card).meta.groupId, 'grp-1');
  assert.equal('groupId' in rowFromPlain({ id: 'q', kind: 'note' }).meta, false);
});

// ── the rest of the row ──────────────────────────────────────────────────────

test('cells are read from a Y.Map, a plain object, or nothing', () => {
  const y = asYMap({ id: 'g', gridCells: { a: { type: 'text', html: 'hi' } } });
  assert.deepEqual(cellsOf((k) => y.get(k)), { a: { type: 'text', html: 'hi' } });
  assert.deepEqual(cellsOf((k) => ({ gridCells: { a: 1 } }[k])), { gridCells: { a: 1 } }.gridCells);
  assert.deepEqual(cellsOf(() => undefined), {});
});

test('onboarding seeds never reach the index', () => {
  // Keeping these out is what stops the activation triggers stamping at seed
  // time. Both the id prefix and the durable flag are honoured, because the
  // seeded Ideas board uses a real UUID.
  assert.equal(isSeedCard('onb-1', () => undefined), true);
  assert.equal(isSeedCard('a-real-uuid', (k) => ({ seed: true }[k])), true);
  assert.equal(rowFromPlain({ id: 'onb-x', kind: 'note' }), null);
  assert.equal(rowFromPlain({ id: 'u1', kind: 'note', seed: true }), null);
});

test('title falls back through the fields a card might actually have', () => {
  const t = (card) => rowFromPlain({ id: 'x', kind: 'note', ...card }).title;
  assert.equal(t({ title: 'A', name: 'B' }), 'A');
  assert.equal(t({ name: 'B', label: 'C' }), 'B');
  assert.equal(t({ label: 'C', url: 'D' }), 'C');
  assert.equal(t({ url: 'https://e.com' }), 'https://e.com');
  assert.equal(t({}), '');
});

test('title and body are truncated, and identically on both sides', () => {
  const card = { id: 'big', kind: 'note', title: 'T'.repeat(500), body: 'B'.repeat(2000) };
  assert.equal(rowFromPlain(card).title.length, 200);
  assert.equal(rowFromPlain(card).body.length, 500);
  assert.deepEqual(rowFromYMap(card), rowFromPlain(card));
});

test('a schedule indexes its days as text, not as an empty string', () => {
  const legacy = cardIndexBody('schedule', (k) => ({ rows: [{ day: 'Mon', what: 'Prep', loc: 'Stage 3' }] }[k]));
  assert.equal(legacy, 'Mon — Prep — Stage 3');
});

test('position and section meta ride along for the public article', () => {
  const r = rowFromPlain(CORPUS.find((c) => c.id === 'sec'));
  assert.deepEqual(r.meta.pos, { x: 0, y: 900, w: 0, h: 0 });
  assert.equal(r.meta.sectionHeader, true);
  assert.equal(r.meta.sub, 'pages 1–30');
});

test('an image card with no src still projects, so recovery can fill it in', () => {
  // The browser looks for exactly this to graft a storage_path afterwards.
  const r = rowFromPlain({ id: 'i0', kind: 'image', alt: 'pending' });
  assert.equal(r.meta.src, null);
  assert.equal(r.kind, 'image');
});

test('an unmodelled kind gets an empty meta rather than throwing', () => {
  assert.equal(buildCardMeta('hologram', () => undefined), null);
  assert.deepEqual(rowFromPlain({ id: 'h', kind: 'hologram', title: 'x' }).meta, {});
});

test('weight is never zero — an empty grid still counts as a card', () => {
  assert.ok(cardIndexWeight('grid', (k) => ({ gridCells: {} }[k])) >= 1);
});
