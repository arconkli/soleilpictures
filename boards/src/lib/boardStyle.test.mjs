// The colours a board the API makes wears by default (lib/boardStyle.js). The
// routes that use them are in apiRoutes.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTION_COLOURS, COLOUR_WORDS, namedColour, sectionColour, nextSectionColours, tintOf, tintsNotes, tintNewNotes,
} from './boardStyle.js';
import { readableInk } from './paletteLayout.js';

// WCAG's contrast ratio (paletteLayout's relLuminance is a luma for picking ink).
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin((n >> 16) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// The canvases a section's outline and name are drawn on (styles.css --bg-0
// and --bg-1, dark and light), and the app's gold (--soleil).
const CANVASES = ['#0a0a0c', '#111114', '#f5f5f7', '#fafafc'];
const GOLD = '#ffa500';

test('eight named colours, each readable on both canvases, none the app\'s gold', () => {
  assert.equal(SECTION_COLOURS.length, 8);
  assert.equal(new Set(SECTION_COLOURS.map((c) => c.name)).size, 8);
  for (const c of SECTION_COLOURS) {
    assert.match(c.tone, /^#[0-9a-f]{6}$/);
    assert.match(c.tint, /^#[0-9a-f]{6}$/);
    for (const bg of CANVASES) assert.ok(contrast(c.tone, bg) >= 4, `${c.name} on ${bg}: ${contrast(c.tone, bg).toFixed(2)}`);
    assert.notEqual(c.tone, GOLD);
    assert.equal(readableInk(c.tint), '#0a0a0c', `${c.name}'s tint takes dark ink`);
  }
});

test('a colour is named by its name, in any case', () => {
  assert.equal(namedColour(' Teal ').tone, '#008686');
  assert.equal(namedColour('vermilion'), null);
  assert.equal(sectionColour('BLUE'), '#3f7ab5');
  assert.equal(sectionColour('#c8a04a'), '#c8a04a', 'anything else as given');
  assert.equal(sectionColour('rebeccapurple'), 'rebeccapurple');
  assert.equal(sectionColour(''), null);
  assert.equal(sectionColour(null), null);
});

test('a plain colour word is the named colour nearest it, gold never the app\'s gold', () => {
  const name = (w) => namedColour(w)?.name ?? null;
  assert.equal(name('red'), 'rose');
  assert.equal(name('Dark Red'), 'rose');
  assert.equal(name('light-blue'), 'blue');
  assert.equal(name('orange'), 'clay');
  assert.equal(name('brown'), 'clay');
  assert.equal(name('yellow'), 'moss');
  assert.equal(name('gold'), 'moss');
  assert.equal(name('purple'), 'plum');
  assert.equal(name('cyan'), 'teal');
  assert.equal(name('navy'), 'blue');
  assert.equal(name('gray'), 'slate');
  assert.equal(name('dark'), null, 'a shade alone is no colour');
  assert.equal(sectionColour('red'), '#b25e6c');
  assert.equal(tintOf('yellow'), '#dae4c2');
  // Every word belongs to a named colour, once, and none is a name itself.
  const names = new Set(SECTION_COLOURS.map((c) => c.name));
  const words = Object.entries(COLOUR_WORDS).flatMap(([n, list]) => {
    assert.ok(names.has(n), n);
    return list;
  });
  assert.equal(new Set(words).size, words.length);
  for (const w of words) assert.equal(names.has(w), false, w);
});

test('new sections take the named colours in order, passing over ones the board wears', () => {
  assert.deepEqual(nextSectionColours([], 3), ['#3f7ab5', '#af6440', '#3d8550']);
  assert.deepEqual(nextSectionColours(['#3F7AB5', '#c8a04a'], 2), ['#af6440', '#3d8550']);
  const all = SECTION_COLOURS.map((c) => c.tone);
  assert.deepEqual(nextSectionColours(all, 2), ['#3f7ab5', '#af6440'], 'round again once all are worn');
});

test('a note\'s tint: the named one for a named colour, else the colour made as light', () => {
  for (const c of SECTION_COLOURS) {
    assert.equal(tintOf(c.tone), c.tint);
    assert.equal(tintOf(c.name), c.tint);
  }
  for (const hex of ['#d9a441', '#7896b5', '#000000', '#ffffff', '#c8323c']) {
    const tint = tintOf(hex);
    assert.match(tint, /^#[0-9a-f]{6}$/);
    assert.equal(readableInk(tint), '#0a0a0c', `${hex} → ${tint} takes dark ink`);
  }
  assert.equal(tintOf('#000000'), tintOf('#808080'), 'a grey stays a grey');
  assert.equal(tintOf('var(--x)'), null);
  assert.equal(tintOf(null), null);
});

const note = (id, groupId, extra = {}) => ({ id, kind: 'note', groupId, w: 280, h: 120, ...extra });
const pic = (id, groupId) => ({ id, kind: 'image', groupId, w: 280, h: 180 });

test('notes take their section\'s tint on a board of two sections or more that isn\'t mostly pictures', () => {
  assert.equal(tintsNotes([note('a', 'g1'), note('b', 'g2')]), true);
  assert.equal(tintsNotes([note('a', 'g1'), note('b', 'g1')]), false, 'one section: nothing to tell apart');
  assert.equal(tintsNotes([pic('p1', 'g1'), pic('p2', 'g1'), note('a', 'g2')]), false, 'the pictures lead');
});

test('only a new note sent with no colour, in a section with one, is tinted', () => {
  const colours = new Map([['g1', '#3f7ab5'], ['g2', 'teal'], ['g3', null]]);
  const fresh = [
    note('plain', 'g1'),
    note('named', 'g2'),
    note('own', 'g1', { bgColor: '#f3ddaa' }),
    note('none', 'g1', { bgColor: null }),
    note('uncoloured section', 'g3'),
    note('loose', null),
    { id: 'link', kind: 'link', groupId: 'g1', w: 280, h: 120 },
  ];
  const out = new Map(tintNewNotes(fresh, [], colours).map((c) => [c.id, c]));
  assert.equal(out.get('plain').bgColor, '#cae2fd');
  assert.equal(out.get('named').bgColor, '#bce7e7');
  assert.equal(out.get('own').bgColor, '#f3ddaa', 'its own colour kept');
  assert.equal(out.get('none').bgColor, null, 'asked for no colour');
  assert.equal('bgColor' in out.get('uncoloured section'), false);
  assert.equal('bgColor' in out.get('loose'), false);
  assert.equal('bgColor' in out.get('link'), false);
  const moodboard = [pic('p1', 'g1'), pic('p2', 'g1'), pic('p3', 'g1')];
  assert.equal('bgColor' in tintNewNotes([note('n', 'g2')], moodboard, colours)[0], false,
    'not on a board the pictures lead');
});

test('the tools and the instructions name the colours the API takes by name', async () => {
  const { COLOUR_NAMES } = await import('./mcpTools.js');
  const { INSTRUCTIONS } = await import('./mcpServer.js');
  assert.equal(COLOUR_NAMES, SECTION_COLOURS.map((c) => c.name).join(', '));
  for (const c of SECTION_COLOURS) assert.match(INSTRUCTIONS, new RegExp(`\\b${c.name}\\b`), c.name);
});

test('over MCP a null colour means "not given", so "" is how a note is kept plain', async () => {
  const { TOOLS } = await import('./mcpTools.js');
  const { checkArgs } = await import('./mcpValidate.js');
  const add = TOOLS.find((t) => t.name === 'add_cards');
  const { args, problems } = checkArgs(add.inputSchema, {
    board_id: '00000000-0000-4000-8000-000000000001',
    cards: [{ kind: 'note', title: 'a', color: null }, { kind: 'note', title: 'b', color: '' }],
  });
  assert.deepEqual(problems, []);
  assert.equal('color' in args.cards[0], false, 'ChatGPT sends null for every field it leaves out');
  assert.equal(args.cards[1].color, '', 'kept, and the card route reads it as no colour');
  assert.match(add.inputSchema.properties.cards.items.properties.color.description, /"" for none/);
});
