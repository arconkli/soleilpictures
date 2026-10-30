// The boards engine's looks and tools (the owner, 10-30: "use more of our tools
// in each board … they all kindof look the same. add some variety"): each board
// is written to a style (its ground, layout, font and lead tools), and holds
// photo grids, tables, checklists, docs, links and arrows as the app's own cards.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { STYLES, FONTS, TOOLS, nextStyle, styleNamed, fits } from '../../scripts/engine/styles.mjs';
import { validateRecipe, toolsOf, recipePrompt, RULES } from '../../scripts/engine/recipe.mjs';
import { buildBoard, stripBuild, withSources, photoKeysOf, arrowReads, openRoom, labelClear, photoGridCard, noteCard, ARROW } from '../../scripts/engine/build.mjs';
import { checkBoard } from '../../scripts/engine/check.mjs';
import { readSummary, findLinks, LINK_RE } from '../../scripts/engine/links.mjs';
import { groundTheme, shotsFor, SHOTS } from '../../scripts/engine/shoot.mjs';
import { encodeBoardSnapshot, buildCardIndexRows } from '../../scripts/lib/cardEncode.mjs';
import { cardScope, readPages } from './docState.js';

const pic = (search, caption) => ({ kind: 'picture', search, ...(caption ? { caption } : {}) });
const note = (title, body) => ({ kind: 'note', title, body });
const palette = { kind: 'palette', title: 'Harbour', swatches: [
  { name: 'Fog', hex: '#c9ccd1' }, { name: 'Slate', hex: '#4a5560' }, { name: 'Rust', hex: '#9a4b2c' }, { name: 'Lamp', hex: '#e8b85a' }] };
const table = { kind: 'table', title: 'Call sheet', rows: [['Scene', 'Place', 'Call'], ['Sc. 4', 'Lantern room', '06:30'], ['Sc. 9', 'Jetty', '15:45']] };
const checklist = { kind: 'checklist', title: 'Prep', checks: [{ text: 'Gels on the lamp', done: true }, { text: 'Boat booked', done: false },
  { text: 'Rain bars', done: false }] };
const doc = { kind: 'doc', title: 'The look in a page', markdown: `## The look\n\n${'Cold and patient, one warm lamp per room. '.repeat(14)}\n\n- Overcast only\n- Handheld on the rocks` };
const link = { kind: 'link', title: 'Lighthouse', url: 'https://en.wikipedia.org/wiki/Lighthouse' };
const seo = { title: 'Lighthouse lookbook example', description: 'A lookbook board for a short film about a lighthouse keeper on a northern rock.',
  body: `A lookbook ${'word '.repeat(260)}`, keyword: 'lookbook' };

// A night lookbook: a photo grid with a note beside it, a doc, a link and arrows.
function lookbook() {
  return {
    title: 'The Keeper — Lookbook', slug: 'keeper-lookbook', story: 'A lookbook for a short film about the last keeper.',
    sections: [
      { name: 'The rock', color: 'slate', grid: true, items: [pic('lighthouse storm night'), pic('foggy rocky coast'), pic('lantern room glass'),
        pic('waves on black rocks'), note('Day', 'Flat and grey; the lamp is the only colour.')] },
      { name: 'Keeper', color: 'clay', items: [pic('old man wool sweater', 'Tom, 68'), pic('weathered hands rope'), pic('kettle on stove'),
        note('Who he is', 'Forty years on the rock.'), palette] },
      { name: 'Plan', color: 'plum', items: [pic('ship lights at sea'), pic('stone stairs spiral'), pic('logbook on desk'),
        table, checklist, doc] },
      { name: 'References', color: 'teal', items: [pic('fresnel lens close'), pic('rain on window night'), link, note('Sound', 'Clockwork, rain.')] },
    ],
    arrows: [{ from: 'Who he is', to: 'Tom, 68', label: 'him' }, { from: 'Prep', to: 'Call sheet' }],
    seo,
  };
}

function photosFor(recipe) {
  const found = new Map();
  recipe.sections.forEach((s, si) => s.items.forEach((it, ii) => {
    if (it.kind !== 'picture') return;
    found.set(`${si}.${ii}`, { w: ii % 2 ? 1600 : 2400, h: ii % 2 ? 2400 : 1600, sha: `sha-${si}-${ii}`, alt: it.search, id: `pexels:${si}${ii}` });
  }));
  return found;
}
const links = new Map([['3.2', { url: link.url, title: 'Lighthouse', description: 'A lighthouse is a tower.', image: 'https://upload.wikimedia.org/x.jpg' }]]);
function build(recipe = lookbook(), style = styleNamed('night lookbook')) {
  let n = 0;
  return buildBoard(recipe, photosFor(recipe), { newId: () => `id-${(n += 1)}`, now: '2026-10-30T12:00:00.000Z', links, style });
}

// ── the looks ────────────────────────────────────────────────────────────────

test('the fonts a style sets are the toolbar\'s own font picker values', () => {
  const bar = readFileSync(new URL('../components/ToolOptionsBar.jsx', import.meta.url), 'utf8');
  for (const f of Object.values(FONTS).filter(Boolean)) assert.ok(bar.includes(f), f);
});

test('every style is distinct, names real tools, and never a schedule', () => {
  assert.equal(new Set(STYLES.map((s) => s.name)).size, STYLES.length);
  assert.equal(new Set(STYLES.map((s) => `${s.ground}|${s.arrangement}|${s.font}`)).size, STYLES.length);
  for (const s of STYLES) {
    assert.ok(s.needs.every((t) => TOOLS.includes(t)), s.name);
    assert.ok(['pictures', 'columns', 'blocks'].includes(s.arrangement), s.name);
    assert.ok(s.ground === null || /^#[0-9a-f]{6}$/.test(s.ground), s.name);
    assert.ok(s.font in FONTS, s.name);
  }
  assert.ok(!TOOLS.includes('schedule'));
});

test('the looks go by turns: never used first, then the one used longest ago', () => {
  assert.equal(nextStyle({}, []).name, STYLES[0].name);
  const used = STYLES.slice(0, -1).map((s) => s.name);
  assert.equal(nextStyle({}, used).name, STYLES.at(-1).name);
  assert.equal(nextStyle({}, [...STYLES.map((s) => s.name).reverse()]).name, STYLES.at(-1).name);
  // A storyboard needs a look with a photo grid for its frames.
  for (const s of STYLES) assert.equal(fits(s, { wants: ['frames'] }), s.needs.includes('grid'));
  assert.ok(nextStyle({ wants: ['frames'] }, []).needs.includes('grid'));
});

test('a board with its own ground is shot only in the theme the ground suits', () => {
  assert.equal(groundTheme(null), null);
  assert.equal(groundTheme('#0e1013'), 'dark');
  assert.equal(groundTheme('#f2ede3'), 'light');
  assert.equal(shotsFor(null), SHOTS);
  const dark = shotsFor('#121418');
  assert.ok(dark.every((s) => s.theme === 'dark'));
  assert.deepEqual(dark.filter((s) => /^(desk|board)-/.test(s.kind)).map((s) => s.kind), ['desk-dark', 'board-dark']);
  assert.equal(dark.length, SHOTS.length - 2);
  assert.ok(shotsFor('#e8ebee').every((s) => s.theme === 'light'));
});

// ── the recipe ───────────────────────────────────────────────────────────────

test('a lookbook that uses its look\'s tools passes', () => {
  assert.deepEqual(validateRecipe(lookbook(), {}, { style: styleNamed('night lookbook') }), []);
  assert.deepEqual(toolsOf(lookbook()), ['picture', 'note', 'palette', 'grid', 'table', 'checklist', 'doc', 'link', 'arrows']);
});

test('a board short of its look\'s tools, or of a wide spread, is told what to add', () => {
  const r = lookbook();
  r.sections[2].items = r.sections[2].items.filter((it) => it.kind !== 'doc');
  assert.ok(validateRecipe(r, {}, { style: styleNamed('night lookbook') }).some((x) => /night lookbook: it needs a doc/.test(x)));
  const plain = lookbook();
  plain.arrows = [];
  plain.sections.forEach((s) => { delete s.grid; s.items = s.items.filter((it) => ['picture', 'note', 'palette'].includes(it.kind)); });
  assert.ok(validateRecipe(plain, {}).some((x) => new RegExp(`shows 3 tools.*at least ${RULES.tools}`).test(x)));
});

test('tables, checklists, docs and links are held to their shapes', () => {
  const r = lookbook();
  r.sections[2].items[3] = { ...table, rows: [['Scene', 'Place'], ['Sc. 4']] };
  r.sections[2].items[4] = { ...checklist, checks: checklist.checks.map((c) => ({ ...c, done: true })) };
  r.sections[2].items[5] = { ...doc, markdown: 'Too short.' };
  r.sections[3].items[2] = { ...link, url: 'https://example.com/lighthouse' };
  const p = validateRecipe(r, {}, { style: styleNamed('night lookbook') }).join('\n');
  assert.match(p, /table "Call sheet" holds 3–9 rows/);
  assert.match(p, /some items ticked \(done\) and some still open/);
  assert.match(p, /doc "The look in a page" must be 400–2500 characters/);
  assert.match(p, /English Wikipedia article/);
});

test('a photo grid needs a card beside it; an arrow joins two named cards in one section', () => {
  const r = lookbook();
  r.sections[0].items = r.sections[0].items.filter((it) => it.kind === 'picture');
  r.arrows = [{ from: 'Who he is', to: 'Call sheet' }, { from: 'Nobody', to: 'Tom, 68' }, { from: 'Prep', to: 'Call sheet', label: 'x'.repeat(30) }];
  const p = validateRecipe(r, {}, { style: styleNamed('night lookbook') }).join('\n');
  assert.match(p, /photo grid "The rock" needs a note, palette, table or checklist beside it/);
  assert.match(p, /joins two sections/);
  assert.match(p, /must name two cards by their exact title or caption/);
  assert.match(p, /arrow label .* is over 24 characters/);
});

test('the prompt describes the look and every tool', () => {
  const p = recipePrompt({ brief: 'A lookbook.' }, { style: styleNamed('production binder') });
  assert.match(p, /production binder on warm paper/);
  assert.match(p, /it must use: a table; a checklist; a doc; two or three arrows/);
  for (const k of ['"table"', '"checklist"', '"doc"', '"link"', '"grid": true', 'arrows:']) assert.ok(p.includes(k), k);
});

// ── the board ────────────────────────────────────────────────────────────────

test('a photo-grid section becomes one grid card of its pictures, beside its note', () => {
  const board = build();
  const grids = board.cards.filter((c) => c.kind === 'grid' && photoKeysOf(c).length);
  assert.equal(grids.length, 1);
  assert.deepEqual(photoKeysOf(grids[0]), ['0.0', '0.1', '0.2', '0.3']);
  const cells = Object.values(grids[0].gridCells).filter((x) => x.type === 'image');
  assert.deepEqual(cells.map((x) => x.photo), ['0.0', '0.1', '0.2', '0.3']);
  assert.equal(grids[0].groupId, board.groups.find((g) => g.name === 'The rock').id);
  assert.ok(board.cards.some((c) => c.kind === 'note' && c.title === 'Day' && c.groupId === grids[0].groupId));
  assert.ok(!board.cards.some((c) => c.kind === 'image' && String(c.alt).includes('lighthouse storm')));
});

test('a grid\'s photos get sources for the shot and lose their build keys on write', () => {
  const r = lookbook();
  const board = build(r);
  const found = photosFor(r);
  const staged = withSources(board.cards, found, (ph) => `/engine-photos/${ph.sha}.jpg`);
  const grid = staged.find((c) => c.kind === 'grid' && c.photos);
  assert.ok(Object.values(grid.gridCells).filter((x) => x.type === 'image').every((x) => x.src.startsWith('/engine-photos/sha-0-')));
  const stored = stripBuild(staged).find((c) => c.id === grid.id);
  assert.equal(stored.photos, undefined);
  assert.ok(Object.values(stored.gridCells).every((x) => x.photo === undefined));
});

test('a table is a grid of text, a checklist a note of ticked lines, a link the app\'s link card', () => {
  const board = build();
  const t = board.cards.find((c) => c.kind === 'grid' && !c.photos);
  const texts = Object.values(t.gridCells).map((x) => x.html);
  assert.ok(texts.some((h) => /<strong>Scene<\/strong>/.test(h)));
  assert.ok(texts.some((h) => /Lantern room/.test(h)));
  const c = board.cards.find((x) => x.kind === 'note' && x.title === 'Prep');
  assert.match(c.body, /^\[x\] Gels on the lamp\n\[ \] Boat booked/);
  const l = board.cards.find((x) => x.kind === 'link');
  assert.equal(l.link, link.url);
  assert.equal(l.title, 'Lighthouse');
  assert.equal(l.image, 'https://upload.wikimedia.org/x.jpg');
  assert.equal(board.bg, '#0e1013');
  assert.ok(board.cards.filter((x) => x.kind === 'note').every((x) => x.fontFamily === FONTS.serif));
});

test('a link that wasn\'t found is dropped, as a missing photo is', () => {
  const r = lookbook();
  let n = 0;
  const board = buildBoard(r, photosFor(r), { newId: () => `id-${(n += 1)}`, style: styleNamed('night lookbook') });
  assert.ok(!board.cards.some((c) => c.kind === 'link'));
  assert.ok(board.dropped.includes('3.2'));
});

test('a doc is written as the app\'s doc, its page named for the card, its words in the card index', () => {
  const board = build();
  const cards = stripBuild(board.cards);
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, Buffer.from(encodeBoardSnapshot(cards, board.arrows, { groups: board.groups }), 'base64'));
  const d = cards.find((c) => c.kind === 'doc');
  const ym = ydoc.getMap('cards').get(d.id);
  assert.equal(ym.get('prose'), undefined);
  assert.deepEqual(readPages(ydoc, cardScope(ym)).map((p) => p.name), ['The look in a page']);
  const row = buildCardIndexRows({ workspaceId: 'w', boardId: 'b', cards }).find((r) => r.card_id === d.id);
  assert.match(row.body, /^The look\nCold and patient/);
  assert.equal(ydoc.getArray('arrows').length, board.arrows.length);
});

test('arrows join the cards they name, set side by side, and one that would cross the board is dropped', () => {
  const board = build();
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  assert.equal(board.arrows.length, 2, board.dropped.join('; '));
  for (const a of board.arrows) {
    assert.ok(byId.has(a.from) && byId.has(a.to));
    assert.ok(arrowReads(a, board.cards) > 0);
    assert.equal(byId.get(a.from).groupId, byId.get(a.to).groupId);
  }
  const prep = board.cards.find((c) => c.title === 'Prep');
  assert.ok(board.arrows.some((a) => a.from === prep.id));
  // A hop across other cards doesn't read.
  const far = { from: board.cards[0].id, to: board.cards.at(-1).id };
  assert.equal(arrowReads(far, [...board.cards, { id: 'wall', x: -1e5, y: -1e5, w: 2e5, h: 2e5 }]), 0);
});

test('the check counts a grid\'s photos as pictures and proves each one real', () => {
  const r = lookbook();
  const board = build(r);
  const photos = [...photosFor(r)].map(([key, ph]) => ({ key, sha: ph.sha, verdict: 'real', licence: 'Pexels' }));
  assert.deepEqual(checkBoard(board, photos), []);
  const fake = photos.map((ph) => (ph.key === '0.2' ? { ...ph, verdict: 'ai' } : ph));
  assert.ok(checkBoard(board, fake).some((x) => /wasn't proven real/.test(x)));
});

// ── the links ────────────────────────────────────────────────────────────────

test('a link is a real Wikipedia article read from its summary; anything else is dropped', async () => {
  assert.ok(LINK_RE.test('https://en.wikipedia.org/wiki/Film_noir'));
  assert.ok(!LINK_RE.test('https://en.wikipedia.org/wiki/Film_noir?x=1'));
  assert.equal(readSummary('u', { type: 'disambiguation', title: 'Mercury' }), null);
  const l = readSummary('u', { type: 'standard', title: 'Film noir', extract: `Film noir is a style. ${'More words here. '.repeat(20)}`,
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Film_noir' } }, thumbnail: { source: 'https://upload.wikimedia.org/a.jpg' } });
  assert.equal(l.url, 'https://en.wikipedia.org/wiki/Film_noir');
  assert.ok(l.description.length <= 160);
  const r = { sections: [{ items: [link, { kind: 'link', url: 'https://example.com' }, { kind: 'link', url: 'https://en.wikipedia.org/wiki/Nope' }] }] };
  const { found, missing } = await findLinks(r, { fetchJson: async (u) => {
    if (u.endsWith('/Nope')) throw new Error('HTTP 404');
    return { type: 'standard', title: 'Lighthouse', extract: 'A tower.' };
  } });
  assert.deepEqual([...found.keys()], ['0.0']);
  assert.deepEqual(missing, ['0.1', '0.2']);
});

test('a stub between neighbours gets room: the rest of the column moves down, and only that column', () => {
  const g = 'sec';
  const cards = [
    { id: 'a', groupId: g, x: 0, y: 0, w: 280, h: 200 },
    { id: 'b', groupId: g, x: 0, y: 224, w: 280, h: 200 },
    { id: 'c', groupId: g, x: 0, y: 448, w: 280, h: 200 },
    { id: 'side', groupId: g, x: 304, y: 224, w: 280, h: 200 },
  ];
  const room = openRoom(cards, 'b', 'a');
  const at = (id) => room.find((c) => c.id === id);
  assert.equal(at('b').y - (at('a').y + at('a').h), ARROW.minLen);
  assert.equal(at('c').y - at('b').y, 224, 'what follows keeps its spacing');
  assert.equal(at('side').y, 224, 'the next column stays');
  // The line runs the gap, less the few pixels it stands off each card.
  assert.ok(arrowReads({ from: 'b', to: 'a' }, room) >= ARROW.minLen - 16);
  // Room already there: nothing moves.
  assert.equal(openRoom(room, 'b', 'a'), room);
  // It never pushes into a card of a section that can't move with it (one that
  // starts beside it, up the board, and wraps under it).
  const crowded = [...cards, { id: 'below', groupId: 'other', x: 0, y: 660, w: 280, h: 100 },
    { id: 'beside', groupId: 'other', x: 640, y: 0, w: 280, h: 100 }];
  assert.equal(openRoom(crowded, 'b', 'a'), null);
});

test('beside: the columns after it and the sections beside it move along together', () => {
  const cards = [
    { id: 'l', groupId: 'g1', x: 0, y: 0, w: 280, h: 200 },
    { id: 'r', groupId: 'g1', x: 304, y: 0, w: 280, h: 200 },
    { id: 'next', groupId: 'g2', x: 660, y: 0, w: 280, h: 300 },
  ];
  const room = openRoom(cards, 'l', 'r', 120);
  const at = (id) => room.find((c) => c.id === id);
  assert.equal(at('r').x - 280, 120);
  assert.equal(at('next').x - at('r').x, 660 - 304, 'the next section keeps its distance');
});

test('a label stays only where it sits clear of every card', () => {
  const cards = [
    { id: 'a', x: 0, y: 0, w: 280, h: 200 },
    { id: 'b', x: 0, y: 500, w: 280, h: 200 },
  ];
  const arrow = { from: 'b', to: 'a', label: 'grade to this' };
  assert.equal(labelClear(arrow, cards, 1), true);
  // A card beside the line, where the label sits.
  assert.equal(labelClear(arrow, [...cards, { id: 'x', x: 100, y: 300, w: 280, h: 100 }], 1), false);
  // Zoomed far out, the label is longer than the gap.
  assert.equal(labelClear(arrow, cards, 0.2), false);
});

test('built arrows keep their room: no stub, and every label clear of the cards', () => {
  const board = build();
  for (const a of board.arrows) {
    assert.ok(arrowReads(a, board.cards) >= ARROW.minLen / 2, 'no stub');
    assert.ok(labelClear(a, board.cards));
  }
});

test('a storyboard sheet holds full strips only', () => {
  let n = 0;
  const mk = () => `c${(n += 1)}`;
  const pics = (k) => Array.from({ length: k }, (_, i) => ({ key: `0.${i}`, it: { caption: `Fr ${i + 1}` }, ph: { alt: '' } }));
  for (const [k, kept] of [[6, 6], [7, 6], [8, 8], [9, 9], [10, 9], [11, 9], [12, 12]]) {
    const g = photoGridCard(pics(k), { title: 'Frames', frames: true, mk });
    assert.equal(g.photos.length, kept, `${k} frames`);
    const cells = Object.values(g.gridCells);
    assert.equal(cells.filter((c) => c.type === 'image').length, kept);
    assert.equal(cells.filter((c) => c.type === 'empty').length, 0, `${k} frames leave no gaps`);
  }
});

test('a note in the typewriter mono is sized to its whole text, past the app\'s own ceiling', () => {
  const body = Array.from({ length: 8 }, (_, i) => `- Line ${i + 1}: one warm tungsten source per interior, never a face`).join('\n');
  const sans = noteCard('Practicals', body, null);
  const mono = noteCard('Practicals', body, FONTS.mono);
  assert.equal(mono.w, sans.w);
  assert.ok(mono.h > sans.h * 1.2);
  assert.ok(mono.h > 480);
  assert.ok(noteCard('Practicals', body, FONTS.serif).h > sans.h, 'the serif is measured wider too');
});

test('under a card spanning the section, every column moves, so an arrow up to it runs clear', () => {
  const g = 'sec';
  const cards = [
    { id: 'table', groupId: g, x: 0, y: 0, w: 888, h: 200 },
    { id: 'note', groupId: g, x: 0, y: 224, w: 280, h: 200 },
    { id: 'mid', groupId: g, x: 304, y: 224, w: 280, h: 200 },
    { id: 'end', groupId: g, x: 608, y: 224, w: 280, h: 200 },
  ];
  const room = openRoom(cards, 'note', 'table');
  for (const id of ['note', 'mid', 'end']) assert.equal(room.find((c) => c.id === id).y, 200 + ARROW.minLen);
  assert.ok(arrowReads({ from: 'note', to: 'table' }, room) > 0);
});

test('a stub in a section that sits over another pushes that one down too', () => {
  const cards = [
    { id: 'a', groupId: 'top', x: 0, y: 0, w: 280, h: 200 },
    { id: 'b', groupId: 'top', x: 0, y: 224, w: 280, h: 200 },
    { id: 'low', groupId: 'next', x: 0, y: 500, w: 280, h: 200 },
  ];
  const room = openRoom(cards, 'b', 'a');
  assert.ok(room);
  assert.equal(room.find((c) => c.id === 'low').y, 500 + ARROW.minLen - 24);
});

test('a sheet that lost frames is numbered as it stands', () => {
  let n = 0;
  const mk = () => `c${(n += 1)}`;
  const caps = ['1 · WIDE — pool hall', '2 · MID — torch', '4 · INSERT — footprints', '5 · MID — locker', '6 · WIDE — deck', '7 · CLOSE — eyes', '8 · WIDE — exit'];
  const pics = caps.map((caption, i) => ({ key: `0.${i}`, it: { caption }, ph: { alt: '' } }));
  const g = photoGridCard(pics, { title: 'Frames 1–8', frames: true, mk });
  assert.equal(g.title, 'Frames 1–6');
  const texts = Object.values(g.gridCells).filter((c) => c.type === 'text').map((c) => c.html);
  assert.deepEqual(texts.map((t) => t.match(/<p>(\d+) /)[1]), ['1', '2', '3', '4', '5', '6']);
  assert.match(texts[2], /3 · INSERT — footprints/);
});
