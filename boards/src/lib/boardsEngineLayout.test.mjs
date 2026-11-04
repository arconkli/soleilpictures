// The boards engine's layout, as the final grade looked at it (11-03: boards failing pass 4/5 for comment
// bubbles on cards or across section frames, dead areas inside and between sections, a storyboard's empty
// "Still to find" frame, and doc text that rendered as a bullet holding a list).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { styleNamed } from '../../scripts/engine/styles.mjs';
import { buildBoard, photoGridCard, ARROW, liftSections, emptyBetween, numberedBullets, STILL_TO_FIND } from '../../scripts/engine/build.mjs';
import { pdfHtml } from '../../scripts/engine/pdfs.mjs';
import { autoLayout, AUTO } from './layoutAuto.js';
import { GROUP_OUTLINE_PAD as PAD } from './layoutEngine.js';

const pic = (search, caption) => ({ kind: 'picture', search, ...(caption ? { caption } : {}) });
const note = (title, body) => ({ kind: 'note', title, body });

const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const boxOf = (cs) => {
  const x0 = Math.min(...cs.map((c) => c.x)); const y0 = Math.min(...cs.map((c) => c.y));
  return { x: x0, y: y0, w: Math.max(...cs.map((c) => c.x + c.w)) - x0, h: Math.max(...cs.map((c) => c.y + c.h)) - y0 };
};
const frameOf = (board, groupId) => {
  const b = boxOf(board.cards.filter((c) => c.groupId === groupId));
  return { x: b.x - PAD, y: b.y - PAD, w: b.w + 2 * PAD, h: b.h + 2 * PAD };
};

function photosFor(recipe) {
  const found = new Map();
  recipe.sections.forEach((s, si) => s.items.forEach((it, ii) => {
    if (it.kind !== 'picture') return;
    found.set(`${si}.${ii}`, { w: ii % 2 ? 1600 : 2400, h: ii % 2 ? 2400 : 1600, sha: `sha-${si}-${ii}`, alt: it.search, id: `pexels:${si}${ii}` });
  }));
  return found;
}
function build(recipe, style = styleNamed('night lookbook')) {
  let n = 0;
  return buildBoard(recipe, photosFor(recipe), { newId: () => `id-${(n += 1)}`, now: '2026-11-03T12:00:00.000Z', style });
}

// Four sections of different heights, a comment on a card in each and a vote.
function crowded() {
  return {
    title: 'Harbour — Board', slug: 'harbour', story: 'x',
    sections: [
      { name: 'Recce', items: [pic('harbour wall', 'Wall'), pic('boats at low tide', 'Boats'), note('Day', 'Flat and grey.'), pic('rope coil', 'Rope')] },
      { name: 'People', items: [pic('old man sweater', 'Tom'), note('Who', 'Forty years on the rock.')] },
      { name: 'Plan', items: [pic('ship lights', 'Lights'), pic('stairs', 'Stairs'), note('Call', 'Six sharp.'), pic('desk', 'Desk'), note('Gear', 'Two bodies.')] },
      { name: 'Refs', items: [pic('fresnel lens', 'Lens'), pic('rain window', 'Rain')] },
    ],
    arrows: [],
    comments: [
      { on: 'Wall', by: 'Priya, DP', text: 'Love this wall. Can we get it at six, before the light goes hard?' },
      { on: 'Tom', by: 'Sam, director', text: 'Booked for Tuesday.', reply: { by: 'Priya, DP', text: 'Great.' } },
      { on: 'Stairs', by: 'Gus, gaffer', text: 'Flag the window.' },
      { on: 'Rain', by: 'Priya, DP', text: 'Tone, not plot.' },
    ],
    vote: { on: 'Lights', label: 'Poster still?', up: 4, down: 1 },
  };
}

// ── L1: bubbles ──────────────────────────────────────────────────────────────

test('no comment or vote bubble covers a card or crosses a section frame; each sits inside its own', () => {
  for (const name of ['night lookbook', 'field notes', 'moodboard']) {
    const board = build(crowded(), styleNamed(name));
    assert.ok(board.marks.length > 0, name);
    for (const m of board.marks) {
      for (const c of board.cards) assert.equal(area(m, c), 0, `${name}: ${m.kind} on a ${c.kind}`);
      const own = frameOf(board, m.groupId);
      assert.equal(area(m, own), m.w * m.h, `${name}: ${m.kind} leaves its own frame`);
      for (const g of board.groups) if (g.id !== m.groupId && board.cards.some((c) => c.groupId === g.id)) assert.equal(area(m, frameOf(board, g.id)), 0, `${name}: ${m.kind} on another frame`);
    }
    // Every bubble that was kept is a comment or the vote that was asked for; the rest (or a card the grid took in) are in `dropped`.
    assert.equal(board.marks.length + board.dropped.filter((d) => /^(comment|vote) on/.test(d)).length, 5, name);
  }
});

test('a comment with no clear spot is left off and said so; a lone card in its section has none', () => {
  const r = {
    title: 'Solo — Board', slug: 'solo', story: 'x',
    sections: [
      { name: 'Alone', items: [pic('lone tree', 'Tree')] },
      { name: 'Many', items: [pic('a one', 'One'), pic('a two', 'Two'), note('N', 'Words.'), pic('a three', 'Three')] },
    ],
    arrows: [],
    comments: [{ on: 'Tree', by: 'Priya, DP', text: 'Tall.' }],
    vote: { on: 'Tree', label: 'Keep?', up: 3, down: 1 },
  };
  const board = build(r);
  assert.deepEqual(board.dropped.filter((d) => /no clear spot/.test(d)), ['comment on Tree (no clear spot)', 'vote on Tree (no clear spot)']);
  assert.equal(board.comments.length, 0);
  assert.equal(board.vote, null);
  assert.equal(board.marks.length, 0);
});

// ── L2a: arrow labels ────────────────────────────────────────────────────────

test('an arrow label never opens a gap past 160; a longer label is left off', () => {
  assert.equal(ARROW.roomMax, 160);
  const r = crowded();
  r.comments = []; delete r.vote;
  r.arrows = [{ from: 'Wall', to: 'Boats', label: 'the tide' }, { from: 'Stairs', to: 'Lights', label: 'a label far too long to read along a stub between two neighbouring cards' }];
  const board = build(r);
  const gap = (a) => {
    const f = board.cards.find((c) => c.id === a.from); const t = board.cards.find((c) => c.id === a.to);
    return Math.max(0, Math.max(f.x, t.x) - Math.min(f.x + f.w, t.x + t.w), Math.max(f.y, t.y) - Math.min(f.y + f.h, t.y + t.h));
  };
  assert.equal(board.arrows.length, 2);
  for (const a of board.arrows.filter((x) => x.label)) assert.ok(gap(a) <= ARROW.roomMax, `${a.label}: ${gap(a)}`);
  assert.ok(!board.arrows.some((a) => /too long/.test(a.label || '')));
});

// ── L2b: inside a section ────────────────────────────────────────────────────

const fillOf = (cs) => { const b = boxOf(cs); return cs.reduce((n, c) => n + c.w * c.h, 0) / (b.w * b.h); };
const swatches = [1, 2, 3, 4].map((i) => ({ name: `s${i}`, hex: `#aaaaa${i}` }));
const sheet = (noteH) => [
  { id: 'g', kind: 'grid', groupId: 's', w: 584, h: 300 },
  { id: 'p', kind: 'palette', groupId: 's', swatches, w: 280, h: 120 },
  { id: 'n', kind: 'note', groupId: 's', w: 280, h: noteH },
];

test('a grid and palette over one tall narrow note fill better with the note beside them', () => {
  const items = sheet(400);
  const plain = autoLayout(items);
  const beside = autoLayout(items, { beside: true });
  assert.ok(fillOf(beside) > fillOf(plain) + 0.08, `${fillOf(plain)} → ${fillOf(beside)}`);
  const n = beside.find((c) => c.id === 'n'); const g = beside.find((c) => c.id === 'g');
  assert.ok(n.x >= g.x + g.w && n.y === g.y);
  // Where it would not fill better by the margin, the block is the one it was.
  assert.deepEqual(autoLayout(sheet(200), { beside: true }), autoLayout(sheet(200)));
});

// The Worker's /api/v1 auto layout is autoLayout without `beside`; its output is pinned to what it was before
// `beside` existed (digests taken from the layoutAuto.js of 11-02).
test('without `beside`, auto layout comes out exactly as it did', () => {
  const digest = (items, o) => createHash('sha1').update(JSON.stringify(autoLayout(items, o))).digest('hex').slice(0, 12);
  const mixed = [
    ...sheet(400),
    { id: 'a', kind: 'image', groupId: 't', w: 300, h: 200 }, { id: 'b', kind: 'image', groupId: 't', w: 200, h: 300 },
    { id: 'c', kind: 'image', groupId: 't', w: 400, h: 200 }, { id: 'd', kind: 'note', groupId: 't', w: 280, h: 240 },
    { id: 'e', kind: 'note', w: 280, h: 200 }, { id: 'f', kind: 'note', w: 280, h: 300 },
  ];
  assert.equal(digest(sheet(400)), '9af13396212f');
  assert.equal(digest(mixed), 'f92595832314');
  assert.equal(digest(mixed, { arrangement: 'columns' }), 'f92595832314');
  assert.equal(digest(mixed, { gap: 10 }), '9905f6dddcd3');
  // And `beside: false` is no option at all.
  assert.deepEqual(autoLayout(mixed, { beside: false }), autoLayout(mixed));
});

// ── L2c: between sections ────────────────────────────────────────────────────

test('lifting closes the gap under a short section', () => {
  const col = (id, g, x, y, h) => ({ id, groupId: g, x, y, w: 280, h });
  const bx = 280 + 2 * PAD + AUTO.across;
  const cards = [col('a', 'A', 0, 0, 800), col('b', 'B', bx, 0, 200), col('c', 'C', bx, 800 + 2 * PAD + AUTO.down, 200)];
  const lifted = liftSections(cards);
  assert.equal(lifted.find((c) => c.id === 'c').y, 200 + 2 * PAD + AUTO.down);
  assert.deepEqual(lifted.filter((c) => c.id !== 'c'), cards.filter((c) => c.id !== 'c'));
  assert.ok(emptyBetween(lifted) < emptyBetween(cards));
  // Nothing in a section: the board is left as it is.
  const loose = [...cards, { id: 'x', x: 900, y: 0, w: 100, h: 100 }];
  assert.equal(liftSections(loose), loose);
});

// ── L3: storyboards ──────────────────────────────────────────────────────────

test('a storyboard with a lost frame has no "Still to find" cell; the rest keep the shot list\'s numbers', () => {
  let n = 0;
  const mk = () => `c${(n += 1)}`;
  const pics = Array.from({ length: 6 }, (_, i) => ({ key: `0.${i}`, it: { caption: `${i + 1} · WIDE — shot ${i + 1}` }, ph: i === 1 ? null : { alt: '' } }));
  const g = photoGridCard(pics, { title: 'Frames 1–6', frames: true, mk });
  // 5 frames: 3 wide keeps 3, 4 wide keeps 4.
  assert.equal(g.photos.length, 4);
  const texts = Object.values(g.gridCells).filter((c) => c.type === 'text').map((c) => c.html);
  assert.ok(!texts.some((t) => t.includes(STILL_TO_FIND)));
  assert.deepEqual(texts.map((t) => t.match(/<p>(\d+) /)[1]), ['1', '3', '4', '5']);
  assert.equal(g.title, 'Frames 1–5');
});

// ── 6b: "- 1. X" ─────────────────────────────────────────────────────────────

test('"- 1. X" loses its bullet in a doc card and in a PDF, so the list renders as a list', () => {
  assert.equal(numberedBullets('Intro\n- 1. First\n  * 2) Second\n- plain\n1. Third'), 'Intro\n1. First\n  2) Second\n- plain\n1. Third');
  const r = { ...crowded(), comments: [], vote: undefined };
  r.sections[0].items.push({ kind: 'doc', title: 'List', markdown: '- 1. One\n- 2. Two' });
  const doc = build(r).cards.find((c) => c.kind === 'doc');
  assert.equal(doc.prose, '1. One\n2. Two');
  const html = pdfHtml({ title: 'List', markdown: '- 1. One\n- 2. Two', print: false });
  assert.match(html, /<ol>/);
  assert.doesNotMatch(html, /<ul>/);
});
