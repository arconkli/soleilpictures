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
import { buildBoard, stripBuild, withSources, photoKeysOf, arrowReads, openRoom, labelClear, photoGridCard, noteCard, ARROW, LINK_SHAPE,
  photoRecipe, clusterSections, markerLoop, MARKUP, AUDIO_SHAPE, CLUSTER_SHAPE, placeBubble, voteSize, BUBBLE, tagStrip, loopBox, LOOP_REACH, frameKeys, STILL_TO_FIND } from '../../scripts/engine/build.mjs';
import { snapBubbleToBox } from './bubbleLayout.js';
import { checkBoard } from '../../scripts/engine/check.mjs';
import { readSummary, findLinks, LINK_RE } from '../../scripts/engine/links.mjs';
import { groundTheme, shotsFor, SHOTS } from '../../scripts/engine/shoot.mjs';
import { encodeBoardSnapshot, buildCardIndexRows } from '../../scripts/lib/cardEncode.mjs';
import { libraryState, ENGINE_MAKE } from '../../scripts/lib/showcaseWrite.mjs';
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
const video = { kind: 'video', search: 'waves crashing lighthouse', caption: 'Swell at the jetty' };
const audio = { kind: 'audio', title: 'Foghorn and swell', caption: 'Room tone for Sc. 4', searches: ['foghorn', 'sea waves'] };
const cluster = { kind: 'cluster', title: 'Recce — alternates', body: 'The B-list from the recce.',
  searches: ['stone cottage coast', 'rusty boat winch', 'sea fog cliffs'] };
const seo = { title: 'Lighthouse lookbook example', description: 'A lookbook board for a short film about a lighthouse keeper on a northern rock.',
  body: `A lookbook ${'word '.repeat(260)}`, keyword: 'lookbook' };

// A night lookbook: a photo grid with a note beside it, a doc, a link and arrows, and what every board holds
// (a video, a sound, a sub-cluster, tags, a comment and a vote).
function lookbook() {
  return {
    title: 'The Keeper — Lookbook', slug: 'keeper-lookbook', story: 'A lookbook for a short film about the last keeper.',
    sections: [
      { name: 'The rock', color: 'slate', grid: true, items: [pic('lighthouse storm night'), pic('foggy rocky coast'), pic('lantern room glass'),
        pic('waves on black rocks'), note('Day', 'Flat and grey; the lamp is the only colour.')] },
      { name: 'Keeper', color: 'clay', items: [pic('old man wool sweater', 'Tom, 68'), pic('weathered hands rope'), pic('kettle on stove'),
        note('Who he is', 'Forty years on the rock.'), palette, video] },
      { name: 'Plan', color: 'plum', items: [pic('ship lights at sea'), pic('stone stairs spiral'), pic('logbook on desk'),
        table, checklist, doc] },
      { name: 'References', color: 'teal', items: [pic('fresnel lens close'), pic('rain on window night'), link, note('Sound', 'Clockwork, rain.'),
        audio, cluster] },
    ],
    arrows: [{ from: 'Who he is', to: 'Tom, 68', label: 'him' }, { from: 'Prep', to: 'Call sheet' }],
    tags: [{ name: 'night', on: ['Tom, 68', 'The rock'] }, { name: 'Sc. 4', on: ['Call sheet', 'Prep'] }, { name: 'approved', on: ['The look in a page'] }],
    comments: [{ on: 'Tom, 68', by: 'Priya, DP', text: 'Love this face. Can we get him at six, before the light goes hard?',
      reply: { by: 'Sam, director', text: 'Booked for Tuesday.' } }],
    vote: { on: 'Tom, 68', label: 'Poster still?', up: 4, down: 1 },
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
  // A storyboard's frames go in a photo grid, which every board holds since 11-01: every look fits.
  for (const s of STYLES) assert.ok(fits(s, { wants: ['frames'] }), s.name);
  assert.equal(nextStyle({ wants: ['frames'] }, []).name, STYLES[0].name);
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
  assert.deepEqual(toolsOf(lookbook()), ['picture', 'note', 'palette', 'grid', 'table', 'checklist', 'doc', 'link', 'arrows', 'video',
    'audio', 'cluster', 'tags', 'comments', 'vote']);
});

test('a board short of its look\'s tools, or of a wide spread, is told what to add', () => {
  const r = lookbook();
  r.sections[2].items = r.sections[2].items.filter((it) => it.kind !== 'doc');
  assert.ok(validateRecipe(r, {}, { style: styleNamed('night lookbook') }).some((x) => /night lookbook: it needs a doc/.test(x)));
  const plain = lookbook();
  plain.arrows = [];
  plain.sections.forEach((s) => { delete s.grid; s.items = s.items.filter((it) => ['picture', 'note', 'palette'].includes(it.kind)); });
  plain.tags = []; plain.comments = []; delete plain.vote;
  assert.ok(validateRecipe(plain, {}).some((x) => new RegExp(`shows \\d+ tools.*at least ${RULES.toolsPlain}`).test(x)));
  // Every look also needs what every board holds.
  const bare = lookbook();
  bare.sections[3].items = bare.sections[3].items.filter((it) => it.kind !== 'audio');
  delete bare.vote;
  const p = validateRecipe(bare, {}, { style: styleNamed('night lookbook') }).join('\n');
  assert.match(p, /needs a sound/);
  assert.match(p, /needs a vote/);
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

test('sounds, PDFs, sub-clusters, tags, comments and the vote are held to their shapes', () => {
  const ok = lookbook();
  ok.sections[2].items.push({ kind: 'pdf', title: 'Call sheet, day 3', markdown: `# Call sheet\n\n${'Crew call 05:30 at the jetty. '.repeat(12)}` });
  assert.deepEqual(validateRecipe(ok, {}, { style: styleNamed('night lookbook') }), []);

  const r = lookbook();
  r.sections[3].items[4] = { ...audio, searches: ['the sound of a foghorn at night'] };
  r.sections[3].items[5] = { ...cluster, searches: ['stone cottage coast'] };
  r.sections[2].items.push({ kind: 'pdf', title: 'Call sheet', markdown: 'Too short.' });
  r.tags = [{ name: 'night', on: ['Tom, 68'] }, { name: 'Night', on: ['A card that is not there'] }];
  r.comments = [{ on: 'Nowhere', by: '', text: 'x' }, { on: 'Tom, 68', by: 'Gus, gaffer', text: 'Flag the window.' }];
  r.vote = { on: 'Who he is', label: 'Poster still?', up: 40, down: 1 };
  const p = validateRecipe(r, {}, { style: styleNamed('night lookbook') }).join('\n');
  assert.match(p, /sound search "the sound of a foghorn at night" must be 1–3 words/);
  assert.match(p, /cluster "Recce — alternates" holds 3–6 pictures/);
  assert.match(p, /PDF "Call sheet" must be 300–1600 characters/);
  assert.match(p, /a board holds 3–6 tags, not 2/);
  assert.match(p, /tag "Night" is there twice/);
  assert.match(p, /names "A card that is not there", which is no card's/);
  assert.match(p, /comment on "Nowhere" must name a card/);
  assert.match(p, /a comment needs "by"/);
  assert.match(p, /signed "Gus, gaffer": it must be one of the crew \(Priya, Sam/);
  assert.match(p, /vote on "Who he is" must name a picture, a video or a photo grid/);
  assert.match(p, new RegExp(`vote has ${RULES.voteUp[0]}–${RULES.voteUp[1]} votes for it`));

  // A board written to no look may skip the tags, comments and vote.
  const plain = lookbook();
  plain.tags = []; plain.comments = []; delete plain.vote;
  assert.deepEqual(validateRecipe(plain, {}).filter((x) => /tag|comment|vote/.test(x)), []);
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
  assert.match(p, /it must use: a table; a checklist; a doc; a PDF; two or three arrows/);
  assert.match(p, /Every board, whatever its look, also holds: a photo-grid section; a video; a sound; a sub-cluster; tags/);
  for (const k of ['"table"', '"checklist"', '"doc"', '"link"', '"grid": true', 'arrows:', '"audio"', '"pdf"', '"cluster"', 'tags:',
    'comments:', 'a vote:']) assert.ok(p.includes(k), k);
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
  assert.equal(l.image, undefined, 'a link card goes on as words: the article picture is never from the board\'s world');
  assert.equal(l.h, LINK_SHAPE.h);
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

test('a storyboard that lost a frame leaves it off and keeps the shot list\'s numbers, with no "Still to find" cell', () => {
  let n = 0;
  const mk = () => `c${(n += 1)}`;
  const caps = ['1 · WIDE — pool hall', '2 · MID — torch', '3 · INSERT — footprints', '4 · MID — locker', '5 · WIDE — deck', '6 · CLOSE — eyes', '7 · WIDE — exit', '8 · CLOSE — door'];
  const pics = caps.map((caption, i) => ({ key: `0.${i}`, it: { caption }, ph: i === 2 ? null : { alt: '' } }));
  const g = photoGridCard(pics, { title: 'Frames 1–8', frames: true, mk });
  // 7 frames left: strips of 3 keep 6, strips of 4 keep 4, so it is 3 wide.
  assert.equal(g.title, 'Frames 1–7');
  assert.deepEqual(g.photos, ['0.0', '0.1', '0.3', '0.4', '0.5', '0.6']);
  const texts = Object.values(g.gridCells).filter((c) => c.type === 'text').map((c) => c.html);
  assert.ok(!texts.some((t) => t.includes(STILL_TO_FIND)));
  assert.deepEqual(texts.map((t) => t.match(/<p>(\d+) /)[1]), ['1', '2', '4', '5', '6', '7']);
  assert.match(texts[2], /4 · MID — locker/);
  assert.equal(Object.values(g.gridCells).filter((c) => c.type === 'empty').length, 0);
});

test('a storyboard that lost frame 4 of 10 shows 1,2,3,5..10, and its title range ends at 10', () => {
  let n = 0;
  const mk = () => `c${(n += 1)}`;
  const pics = Array.from({ length: 10 }, (_, i) => ({ key: `0.${i}`, it: { caption: `${i + 1} · SHOT ${i + 1}` }, ph: i === 3 ? null : { alt: '' } }));
  const g = photoGridCard(pics, { title: 'Frames 1–10', frames: true, mk });
  const texts = Object.values(g.gridCells).filter((c) => c.type === 'text').map((c) => c.html);
  assert.deepEqual(texts.map((t) => t.match(/<p>(\d+) /)[1]), ['1', '2', '3', '5', '6', '7', '8', '9', '10']);
  assert.equal(g.title, 'Frames 1–10');
});

test('a storyboard takes the strip width that keeps the most frames', () => {
  let n = 0;
  const mk = () => `c${(n += 1)}`;
  const pics = Array.from({ length: 9 }, (_, i) => ({ key: `0.${i}`, it: { caption: `${i + 1} · SHOT` }, ph: i === 4 ? null : { alt: '' } }));
  // 8 frames left: 3 wide keeps 6, 4 wide keeps all 8.
  const g = photoGridCard(pics, { title: 'Frames 1–9', frames: true, mk });
  assert.equal(g.photos.length, 8);
  assert.equal(g.title, 'Frames 1–9', 'the title runs to the last kept frame\'s own number');
});

test('a contact sheet that lost a picture is numbered as it stands', () => {
  let n = 0;
  const mk = () => `c${(n += 1)}`;
  const caps = ['Pool hall', 'Torch', 'Footprints', 'Locker', 'Deck', 'Eyes', 'Exit'];
  const pics = caps.map((caption, i) => ({ key: `0.${i}`, it: { caption }, ph: i === 2 ? null : { alt: '' } }));
  const g = photoGridCard(pics, { title: 'Recce', frames: true, mk });
  assert.equal(g.photos.length, 6);
  const texts = Object.values(g.gridCells).filter((c) => c.type === 'text').map((c) => c.html);
  assert.deepEqual(texts, ['<p>Pool hall</p>', '<p>Torch</p>', '<p>Locker</p>', '<p>Deck</p>', '<p>Eyes</p>', '<p>Exit</p>']);
});

test('a contact sheet with a frame left uncaptioned numbers every frame, leaving no empty box', () => {
  let n = 0;
  const mk = () => `c${(n += 1)}`;
  const caps = ['Drone, if cleared', 'West bank channels', 'Zé\'s sluice', '', 'Tool shed', ''];
  const pics = caps.map((caption, i) => ({ key: `0.${i}`, it: { caption }, ph: { alt: 'stock alt text' } }));
  const g = photoGridCard(pics, { title: 'Recce', frames: true, mk });
  const texts = Object.values(g.gridCells).filter((c) => c.type === 'text').map((c) => c.html);
  assert.deepEqual(texts, ['<p>1 · Drone, if cleared</p>', '<p>2 · West bank channels</p>', "<p>3 · Zé's sluice</p>", '<p>4</p>', '<p>5 · Tool shed</p>', '<p>6</p>']);
  assert.equal(Object.values(g.gridCells).filter((c) => c.type === 'empty').length, 0);
});

test('a page board an older make of the engine made, or skipped, is made again by --batch', async () => {
  const rows = [
    { slug: 'a', page_path: '/tools/a', status: 'ok', decided_by: 'u', score: { style: 'moodboard', make: ENGINE_MAKE } },
    { slug: 'b', page_path: '/tools/b', status: 'new', score: { score: 4 } },
    { slug: 'c', page_path: '/tools/c', status: 'skipped', score: { style: 'pitch', make: ENGINE_MAKE } },
    { slug: 'e', page_path: '/tools/e', status: 'ok', decided_by: 'u', score: { style: 'pitch', make: ENGINE_MAKE - 1 } },
    { slug: 'd', page_path: null, status: 'new', subject: 'costume', made_at: '2026-10-30', score: { style: 'pitch' } },
  ];
  const query = (data) => ({ order: async () => ({ data, error: null }), then: (f) => f({ data, error: null }) });
  const supa = { from: (t) => ({ select: () => query(t === 'showcase_boards' ? rows : []) }) };
  const lib = await libraryState(supa);
  assert.deepEqual([...lib.pages], ['/tools/a']);
  assert.deepEqual(lib.styles, ['moodboard', 'pitch', 'pitch', 'pitch']);
});

// ── what every board holds since 11-01 ──────────────────────────────────────

function fullBoard() {
  const r = lookbook();
  r.sections[2].items.push({ kind: 'pdf', title: 'Call sheet, day 3', markdown: '# Call sheet' });
  const found = photosFor(photoRecipe(r));
  found.set('1.5', { w: 1920, h: 1080, sha: 'sha-video', video: '/tmp/v.mp4', file: '/tmp/v.jpg', alt: 'swell' });
  found.set('3.4', { media: 'sound', file: '/tmp/s.m4a', duration: 75, peaks: 'AAEC', bytes: 1500000, sha: 'sha-sound' });
  found.set('2.6', { media: 'pdf', file: '/tmp/p.pdf', thumb: '/tmp/p.webp', name: 'Call sheet, day 3.pdf', pageCount: 1, w: 300, h: 388 });
  let n = 0;
  const board = buildBoard(r, found, { newId: () => `id-${(n += 1)}`, now: '2026-11-01T12:00:00.000Z', links, style: styleNamed('night lookbook') });
  return { r, found, board };
}

test('a sub-cluster\'s pictures are found with the board\'s, after its own sections', () => {
  const r = lookbook();
  assert.deepEqual(clusterSections(r), [{ name: 'Recce — alternates', items: ['stone cottage coast', 'rusty boat winch', 'sea fog cliffs'].map((search) => ({ kind: 'picture', search })) }]);
  const pr = photoRecipe(r);
  assert.equal(pr.sections.length, r.sections.length + 1);
  assert.equal(r.sections.length, 4, 'the recipe itself is left as it was');
});

test('a board holds a sound, a PDF, a sub-cluster and a video that plays by itself', () => {
  const { board } = fullBoard();
  const audio = board.cards.find((c) => c.kind === 'audio');
  assert.equal(audio.title, 'Foghorn and swell');
  assert.equal(audio.photo, '3.4');
  assert.equal(audio.coverPhoto, '4.2', 'the sub-cluster\'s last picture, not one beside it');
  assert.equal(audio.peaks, 'AAEC');
  assert.equal(audio.mime, 'audio/mp4');
  assert.deepEqual([audio.w, audio.h], [AUDIO_SHAPE.w, AUDIO_SHAPE.h]);
  const pdf = board.cards.find((c) => c.kind === 'pdf');
  assert.deepEqual([pdf.name, pdf.pageCount, pdf.w, pdf.h], ['Call sheet, day 3.pdf', 1, 300, 388]);
  const video = board.cards.find((c) => c.kind === 'video');
  assert.equal(video.autoplay, true);

  const sub = board.cards.find((c) => c.kind === 'board');
  assert.deepEqual([sub.w, sub.h], [CLUSTER_SHAPE.w, CLUSTER_SHAPE.h]);
  assert.equal(board.children.length, 1);
  const child = board.children[0];
  assert.equal(child.id, sub.id, 'the card is the cluster');
  assert.equal(child.name, 'Recce — alternates');
  assert.equal(child.bg, board.bg);
  assert.deepEqual(child.cards.filter((c) => c.kind === 'image').map((c) => c.photo).sort(), ['4.0', '4.1', '4.2']);
  assert.ok(child.cards.some((c) => c.kind === 'note' && c.body === 'The B-list from the recce.'));
  assert.ok(!board.cards.some((c) => c.childId), 'the build key is gone');
});

test('tags, the crew\'s comments and the vote land on the cards they name, the voted one marked up', () => {
  const { board } = fullBoard();
  const id = (pred) => board.cards.find(pred)?.id;
  const tom = id((c) => c.kind === 'image' && c.caption === 'Tom, 68');
  const rock = id((c) => c.kind === 'grid' && photoKeysOf(c).length);
  assert.deepEqual(board.tags.find((t) => t.name === 'night').cardIds, [tom, rock]);
  assert.equal(board.tags.length, 3);
  assert.equal(board.comments.length, 1);
  const c = board.comments[0];
  assert.deepEqual([c.cardId, c.by, c.reply.by], [tom, 'priya', 'sam']);
  assert.ok(Number.isFinite(c.offset.x) && Number.isFinite(c.offset.y));
  assert.deepEqual([board.vote.cardId, board.vote.label, board.vote.up, board.vote.down], [tom, 'Poster still?', 4, 1]);
  const [loop] = board.strokes;
  assert.equal(loop.brush, 'marker');
  assert.equal(loop.color, MARKUP.color);
  // It rings the card and the tags under it, never running through a chip.
  const box = board.cards.find((x) => x.id === tom);
  const strip = tagStrip(box, board.tags.filter((t) => t.cardIds.includes(tom)).map((t) => t.name));
  const ring = loopBox(box, strip);
  assert.ok(strip && ring.y + ring.h === strip.y + strip.h, 'its tags are inside the loop');
  const reach = MARKUP.pad + 2 * MARKUP.wobble + 1;
  for (const [x, y] of loop.points) {
    assert.ok(!(x > ring.x && x < ring.x + ring.w && y > ring.y && y < ring.y + ring.h), 'never over the card or its tags');
    assert.ok(x >= ring.x - reach && x <= ring.x + ring.w + reach && y >= ring.y - reach && y <= ring.y + ring.h + reach, 'close round it');
  }
  // The next card down its column was moved clear of the loop.
  const under = board.cards.filter((o) => o.id !== tom && o.groupId === box.groupId && o.y >= box.y + box.h && o.x < ring.x + ring.w && o.x + o.w > ring.x);
  assert.ok(under.length, 'a card sits under it');
  for (const o of under) assert.ok(o.y >= ring.y + ring.h + LOOP_REACH, `${o.kind} ${o.id} clear of the loop`);
  // A card without tags is ringed as it stands.
  assert.deepEqual(loopBox({ x: 1, y: 2, w: 30, h: 40 }), { x: 1, y: 2, w: 30, h: 40 });
});

test('a bubble sits where the app draws it, clear of the other cards, the section names and each other', () => {
  const { board } = fullBoard();
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const bubbles = [...board.comments.map((c) => ({ ...c, size: c.reply ? BUBBLE.thread : BUBBLE.comment })),
    { ...board.vote, size: voteSize(board.vote.label) }];
  assert.equal(board.marks.length, bubbles.length);
  bubbles.forEach((b, i) => {
    const box = board.cards.find((c) => c.id === b.cardId);
    const drawn = snapBubbleToBox(box, b.offset.x, b.offset.y, b.size.w, b.size.h).bubble;
    assert.deepEqual([board.marks[i].x, board.marks[i].y, board.marks[i].w, board.marks[i].h], [drawn.x, drawn.y, b.size.w, b.size.h]);
    for (const c of board.cards) if (c.id !== b.cardId) assert.equal(overlap(board.marks[i], c), 0, `clear of ${c.kind} ${c.id}`);
  });
  assert.equal(overlap(board.marks[0], board.marks[1]), 0);
  // Nor over a tagged card's tags, in the strip just under it.
  for (const c of board.cards) {
    const strip = tagStrip(c, board.tags.filter((t) => t.cardIds.includes(c.id)).map((t) => t.name));
    if (strip) for (const m of board.marks) assert.equal(overlap(m, strip), 0, `tags of ${c.id}`);
  }
  // Set close, this card had no clear side: room was made in its column, and the cards still never touch.
  for (const [i, a] of board.cards.entries()) for (const c of board.cards.slice(i + 1)) assert.equal(overlap(a, c), 0, `${a.id} and ${c.id}`);

  // A lone card's bubble takes the app's first side, the right; a neighbour there sends it elsewhere.
  const box = { x: 0, y: 0, w: 300, h: 200 };
  const lone = placeBubble(box, BUBBLE.comment);
  assert.equal(lone.side, 'right');
  assert.deepEqual([lone.rect.x, lone.rect.y], [300, snapBubbleToBox(box, lone.offset.x, lone.offset.y, 240, 76).bubble.y]);
  const right = { x: 320, y: -40, w: 300, h: 300 };
  const moved = placeBubble(box, BUBBLE.comment, { obstacles: [right] });
  assert.notEqual(moved.side, 'right');
  assert.equal(overlap(moved.rect, right), 0);
  // A second bubble on the same card keeps off the first.
  const second = placeBubble(box, BUBBLE.comment, { obstacles: [right], placed: [moved.rect] });
  assert.equal(overlap(second.rect, moved.rect), 0);
  // Hemmed in, with its tags under it, a bubble takes the app's reach past the corner to clear them.
  const tom = { x: 0, y: 0, w: 280, h: 187 };
  const hemmed = [{ x: 304, y: 0, w: 280, h: 400 }, { x: -304, y: 0, w: 280, h: 400 }, { x: 0, y: -174, w: 280, h: 150 }, tagStrip(tom, ['hero'])];
  const reach = placeBubble(tom, BUBBLE.comment, { obstacles: hemmed });
  assert.deepEqual([reach.side, reach.covers, reach.rect.x], ['bottom', 0, tom.w - BUBBLE.comment.w + 18]);
  // Inside the board beats outside it, when both are clear.
  const edge = { x: -600, y: 0, w: 900, h: 200 };
  assert.equal(placeBubble(box, BUBBLE.comment, { obstacles: [right], edge }).side, 'left');
});

test('a grid of six or more mostly captioned pictures is a storyboard sheet, its frames known before a photo is found', () => {
  const frames = [1, 2, 3, 4, 5, 6].map((i) => pic(`frame ${i}`, i < 5 ? `${i} · WIDE` : ''));
  const r = { sections: [
    { name: 'Mood', grid: true, items: ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => pic(s)) },
    { name: 'Frames 1–6', grid: true, items: [note('Boards', 'In order.'), ...frames] },
    { name: 'Loose', items: frames },
    { name: 'Recce', grid: true, items: ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => pic(s, `The ${s}`)) },
  ] };
  // The recce is a contact sheet (captions, no numbers): it can lose a picture without contradicting anything.
  assert.deepEqual([...frameKeys(r)], ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6']);
  assert.equal(frameKeys({}).size, 0);
});

test('a comment by someone outside the crew, or on no card, is dropped; a loop is the same each time', () => {
  const r = lookbook();
  r.comments.push({ on: 'Nothing here', by: 'Priya', text: 'x' }, { on: 'Tom, 68', by: 'Gus', text: 'y' });
  r.vote.on = 'Nowhere';
  const board = buildBoard(r, photosFor(photoRecipe(r)), { newId: (() => { let n = 0; return () => `id-${(n += 1)}`; })(), links, style: styleNamed('night lookbook') });
  assert.equal(board.comments.length, 1);
  assert.equal(board.vote, null);
  assert.deepEqual(board.strokes, []);
  assert.ok(board.dropped.includes('comment on Nothing here'));
  assert.ok(board.dropped.includes('vote on Nowhere'));
  const box = { x: 10, y: 20, w: 300, h: 200 };
  assert.deepEqual(markerLoop(box), markerLoop(box));
});

test('a sound, its cover and a PDF get their own sources, and lose their build keys on write', () => {
  const { found, board } = fullBoard();
  const staged = withSources(board.cards, found, (it, what, card) => `${what}:${it.sha || it.name}${what === 'cover' ? `:${card.id}` : ''}`);
  const audio = staged.find((c) => c.kind === 'audio');
  assert.equal(audio.src, 'sound:sha-sound');
  assert.equal(audio.cover, `cover:sha-4-2:${audio.id}`);
  const pdf = staged.find((c) => c.kind === 'pdf');
  assert.equal(pdf.pdfSrc, 'pdf:Call sheet, day 3.pdf');
  assert.equal(pdf.src, 'thumb:Call sheet, day 3.pdf');
  const stored = stripBuild(staged);
  assert.ok(!stored.some((c) => 'photo' in c || 'coverPhoto' in c));
});
