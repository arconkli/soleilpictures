// What the API makes of the cards an assistant writes: a note's title, text,
// colour and size, palettes, and sections named by name (lib/apiCards.js and
// normalizeIncomingCard). The routes that use them are in apiRoutes.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, SECTIONS, PICTURE, hexColour, readNoteColor, readSwatches, paletteSize, publicSwatches,
  readSections, resolveSections, sectionName, noteRepair, pictureSize,
} from './apiCards.js';
import { API_LAYOUTS } from './layoutAuto.js';
import { normalizeIncomingCard, publicCard } from '../worker-api.js';
import { composeNoteHtml } from './noteCompose.js';
import { NOTE_FIT, noteContentHeight } from './noteFit.js';
import { TOOLS } from './mcpTools.js';

// The film diary ChatGPT made on 2026-10-27, one of its notes as sent.
const MARTY = {
  kind: 'note',
  title: 'MARTY SUPREME (2025)',
  body: '9.75 / 10\n\nOne of your highest-rated films.\n\nNOTES\n• What makes the lead performance electric?\n'
    + '• How does the film build momentum?\n• Favorite scene / sequence:',
  color: '#F3DDAA',
};

test('a hex colour is read in any of its spellings, and nothing else is', () => {
  assert.equal(hexColour('#F3DDAA'), '#f3ddaa');
  assert.equal(hexColour('f3ddaa'), '#f3ddaa');
  assert.equal(hexColour(' #abc '), '#aabbcc');
  for (const bad of ['yellow', 'rgb(1,2,3)', '#abcd', '#12345', '', null, 42]) assert.equal(hexColour(bad), null, String(bad));
});

test('a note\'s colour is a hex or nothing, and says what to send when it is not', () => {
  assert.deepEqual(readNoteColor('#F3DDAA'), { color: '#f3ddaa' });
  assert.deepEqual(readNoteColor(null), { color: null });
  assert.deepEqual(readNoteColor(''), { color: null });
  assert.match(readNoteColor('yellow').problem, /hex colour like "#f3ddaa".*yellow/);
});

test('swatches come as objects or plain hexes, named or not, and only a palette\'s worth', () => {
  assert.deepEqual(readSwatches(['#1D3557', { hex: 'e63946', name: '  Signal   red ' }]).swatches,
    [{ name: 'Color', hex: '#1d3557' }, { name: 'Signal red', hex: '#e63946' }]);
  assert.match(readSwatches([]).problem, /swatches lists/);
  assert.match(readSwatches(undefined).problem, /swatches lists/);
  assert.match(readSwatches([{ name: 'Navy' }]).problem, /swatches\[0\] needs a hex/);
  const many = Array.from({ length: PALETTE.maxSwatches + 1 }, () => '#000000');
  assert.match(readSwatches(many).problem, new RegExp(`at most ${PALETTE.maxSwatches}`));
  assert.equal(readSwatches(many.slice(1)).swatches.length, PALETTE.maxSwatches);
});

test('a palette is wide enough for every swatch to show its name, and reads back without the default one', () => {
  assert.deepEqual(paletteSize(2), { w: PALETTE.minW, h: PALETTE.h });
  assert.deepEqual(paletteSize(PALETTE.maxSwatches), { w: PALETTE.maxSwatches * PALETTE.perSwatch, h: PALETTE.h });
  assert.deepEqual(publicSwatches([{ name: 'Color', hex: '#111111' }, { name: 'Ink', hex: '#222222' }]),
    [{ hex: '#111111', name: null }, { hex: '#222222', name: 'Ink' }]);
});

test('the sections a write names: the list first, in its order, then any a card names, once each', () => {
  const read = readSections([{ name: 'Canon', color: '#3f7ab5' }, 'Journal'], [
    { group: 'journal' }, { group: ' To   Watch ' }, { group: 'Canon' }, { group: '' }, {},
  ]);
  assert.deepEqual(read.wanted, [
    { name: 'Canon', color: '#3f7ab5' }, { name: 'Journal', color: null }, { name: 'To Watch', color: null },
  ]);
  assert.match(readSections('Canon', []).problem, /groups lists sections/);
  assert.match(readSections([{ color: '#fff' }], []).problem, /groups\[0\] needs a name/);
  assert.match(readSections(Array.from({ length: SECTIONS.maxPerCall + 1 }, (_, i) => `s${i}`), []).problem,
    new RegExp(`at most ${SECTIONS.maxPerCall}`));
  assert.equal(sectionName('x'.repeat(500)).length, SECTIONS.maxName);
});

test('a section is the board\'s oldest group of that name, else a new group made as POST /groups makes one', () => {
  let n = 0;
  const plan = resolveSections(
    [{ id: 'g1', name: 'canon', color: '#111111' }, { id: 'g2', name: 'Canon' }],
    [{ name: 'Canon', color: '#3f7ab5' }, { name: 'Journal', color: '#af6440' }],
    { userId: 'u1', now: '2026-10-27T00:00:00Z', newId: () => `new-${++n}` },
  );
  assert.deepEqual(plan.order, ['g1', 'new-1']);
  assert.equal(plan.idByKey.get('canon'), 'g1', 'an existing section keeps its own colour');
  assert.deepEqual(plan.created, [{
    id: 'new-1', name: 'Journal', color: '#af6440', shape: 'box', outline: true, kind: null,
    createdAt: '2026-10-27T00:00:00Z', createdBy: 'u1',
  }]);
});

test('a note made from a title and a body shows both, as tall as its text, in its colour', () => {
  const c = normalizeIncomingCard(MARTY);
  assert.equal(c.html, composeNoteHtml({ title: MARTY.title, body: MARTY.body }));
  assert.match(c.html, /^<h2>MARTY SUPREME \(2025\)<\/h2>/);
  assert.match(c.html, /<ul><li><p>What makes the lead performance electric\?<\/p><\/li>/);
  assert.equal(c.title, MARTY.title, 'the title is kept for search and reads');
  assert.equal(c.body, MARTY.body);
  assert.equal(c.w, NOTE_FIT.width);
  assert.ok(c.h >= noteContentHeight(c.html, c.w), `${c.h} shows the whole text`);
  assert.ok(c.h > 180, 'taller than the 180 every API note used to get');
  assert.equal(c.bgColor, '#f3ddaa', 'painted where the canvas paints a note');
  assert.equal(c.color, null);
  assert.equal(publicCard(c).color, '#f3ddaa', 'and read back as its colour');
});

test('a note keeps a size it was given, and an empty one keeps the default', () => {
  const sized = normalizeIncomingCard({ ...MARTY, w: 400, h: 150 });
  assert.deepEqual([sized.w, sized.h], [400, 150]);
  const wide = normalizeIncomingCard({ ...MARTY, w: 400 });
  assert.equal(wide.w, 400);
  assert.ok(wide.h < normalizeIncomingCard(MARTY).h, 'a wider note is shorter');
  const empty = normalizeIncomingCard({ kind: 'note' });
  assert.deepEqual([empty.w, empty.h, empty.html], [280, 180, undefined]);
});

test('a note too long to show whole is made as tall as a note grows, and says so', () => {
  const said = [];
  const long = normalizeIncomingCard({ kind: 'note', title: 'Draft', body: 'A sentence that goes on. '.repeat(400) },
    { warn: (m) => said.push(m) });
  assert.equal(long.h, NOTE_FIT.maxH);
  assert.equal(said.length, 1);
  assert.match(said[0], /write_doc/);
});

test('a note\'s own html is kept, under the title it names when it has no heading', () => {
  const c = normalizeIncomingCard({ kind: 'note', title: 'Lenses', html: '<p>Cooke S4, wide open</p>' });
  assert.equal(c.html, '<h2>Lenses</h2><p>Cooke S4, wide open</p>');
  const own = normalizeIncomingCard({ kind: 'note', title: 'Lenses', html: '<h3>Glass</h3><p>Cooke S4</p>' });
  assert.equal(own.html, '<h3>Glass</h3><p>Cooke S4</p>');
});

test('a note\'s colour must be a hex, and other kinds keep theirs as given', () => {
  assert.throws(() => normalizeIncomingCard({ kind: 'note', title: 'x', color: 'yellow' }),
    (e) => e.status === 400 && e.code === 'bad_request' && /hex colour/.test(e.message));
  assert.equal(normalizeIncomingCard({ kind: 'link', url: 'https://a.test', color: 'teal' }).color, 'teal');
});

test('a palette is made from its swatches, sized to show them, and reads back with them', () => {
  const c = normalizeIncomingCard({
    kind: 'palette',
    swatches: [{ hex: '#1d3557', name: 'Navy' }, '#e63946', '#f1faee', '#a8dadc', '#457b9d'],
  });
  assert.deepEqual([c.kind, c.title, c.w, c.h], ['palette', 'Palette', paletteSize(5).w, PALETTE.h]);
  assert.equal(c.swatches.length, 5);
  assert.deepEqual(publicCard(c).swatches[0], { hex: '#1d3557', name: 'Navy' });
  assert.throws(() => normalizeIncomingCard({ kind: 'palette', title: 'No colours' }), (e) => e.status === 400);
  const named = normalizeIncomingCard({ kind: 'palette', title: 'Tokyo noir, 1974', swatches: ['#000', '#fff'] });
  assert.equal(named.title, 'Tokyo noir, 1974');
});

// A patch reads the card as it stands (`before`), as updateCardsOnBoard hands it.
const made = (over = {}) => {
  const c = normalizeIncomingCard(MARTY);
  return { ...c, id: 'api-1', x: 80, y: 80, ...over };
};

test('a new title or body is written into a note the API wrote, and its height follows', () => {
  const before = made();
  const p = normalizeIncomingCard({ body: 'Just the score now.' }, { partial: true, existingKind: 'note', before });
  assert.equal(p.html, composeNoteHtml({ title: MARTY.title, body: 'Just the score now.' }));
  assert.ok(p.h < before.h, `${p.h} < ${before.h}`);
  assert.equal('w' in p, false, 'the width stays');
  const titled = normalizeIncomingCard({ title: 'MARTY SUPREME' }, { partial: true, existingKind: 'note', before });
  assert.match(titled.html, /^<h2>MARTY SUPREME<\/h2><p>9\.75/);
});

test('a note opened in the app, edited by someone, or sized by hand keeps its text and its size', () => {
  const seeded = made({ noteFragmentSeeded: true });
  const a = normalizeIncomingCard({ title: 'New' }, { partial: true, existingKind: 'note', before: seeded });
  assert.equal('html' in a, false, 'the note\'s own fragment holds its text now');
  const edited = made({ html: '<p>Rewritten in the app</p>', body: null });
  const b = normalizeIncomingCard({ body: 'From the API' }, { partial: true, existingKind: 'note', before: edited });
  assert.equal('html' in b, false);
  const resized = made({ manuallyResized: true });
  const c = normalizeIncomingCard({ body: 'Short' }, { partial: true, existingKind: 'note', before: resized });
  assert.equal('h' in c, false, 'a hand-sized note keeps its size');
  const given = normalizeIncomingCard({ body: 'Short', h: 300 }, { partial: true, existingKind: 'note', before: made() });
  assert.equal(given.h, 300);
  const moved = normalizeIncomingCard({ x: 500 }, { partial: true, existingKind: 'note', before: made() });
  assert.deepEqual(Object.keys(moved), ['x'], 'a move is only a move');
});

test('add_cards and update_cards take as many swatches and sections as the API does', () => {
  const tool = (name) => TOOLS.find((t) => t.name === name);
  for (const name of ['add_cards', 'update_cards']) {
    const t = tool(name).inputSchema.properties;
    assert.equal(t.cards.items.properties.swatches.maxItems, PALETTE.maxSwatches, name);
    assert.equal(t.groups.maxItems, SECTIONS.maxPerCall, name);
  }
});

test('arrange_board takes the layouts the API does, auto first', () => {
  const t = TOOLS.find((x) => x.name === 'arrange_board').inputSchema.properties;
  assert.deepEqual(t.layout.enum, API_LAYOUTS);
  for (const name of ['add_cards', 'import_urls']) {
    assert.deepEqual(TOOLS.find((x) => x.name === name).inputSchema.properties.layout.enum, API_LAYOUTS, name);
  }
});

test('a picture with no size is a note\'s width at its own shape, a tall one narrowed', () => {
  assert.deepEqual(pictureSize(1600, 900), { w: PICTURE.w, h: Math.round(PICTURE.w * 900 / 1600) });
  assert.deepEqual(pictureSize(1000, 1500), { w: PICTURE.w, h: PICTURE.maxH });
  assert.deepEqual(pictureSize(1000, 3000), { w: Math.round(PICTURE.maxH / 3), h: PICTURE.maxH });
  assert.equal(pictureSize(0, 100), null);
  assert.equal(pictureSize(undefined, undefined), null);
});

// A note as the API made one before notes showed their title and colour.
const older = (over = {}) => ({
  id: 'api-1', kind: 'note', x: 0, y: 0, w: 280, h: 180, title: MARTY.title, body: MARTY.body, color: '#F3DDAA', ...over,
});

test('a note the API made earlier is brought up to date: its title shown, its colour painted, its height its text\'s', () => {
  const fix = noteRepair(older());
  assert.equal(fix.html, composeNoteHtml({ title: MARTY.title, body: MARTY.body }));
  assert.equal(fix.bgColor, '#f3ddaa');
  assert.equal(fix.color, null);
  assert.ok(fix.h > 180);
  assert.equal(noteRepair({ ...older(), ...fix }), null, 'and then it is current');
  const titled = noteRepair(older({ html: '<p>Cooke S4</p>', body: null, color: null }));
  assert.equal(titled.html, '<h2>MARTY SUPREME (2025)</h2><p>Cooke S4</p>');
  const short = noteRepair(older({ body: 'Two lines.' }));
  assert.ok(short.h < 180, 'a short note at the old height shrinks to its text');
  assert.equal(noteRepair(older({ body: 'Two lines.', h: 300, color: null, html: composeNoteHtml({ title: MARTY.title, body: 'Two lines.' }) })), null,
    'one given room on purpose keeps it');
});

test('a note opened, sized by hand or made in the app is never rewritten by a tidy', () => {
  assert.equal(noteRepair(older({ noteFragmentSeeded: true })), null);
  assert.equal(noteRepair(older({ manuallyResized: true })), null);
  assert.equal(noteRepair(older({ id: 'n-1' })), null);
  assert.equal(noteRepair({ ...older(), kind: 'image' }), null);
  const odd = noteRepair(older({ color: 'yellow' }));
  assert.equal('bgColor' in odd, false, 'a colour that is not a hex is left as it is');
});
