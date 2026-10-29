// The boards engine's photo picker (scripts/engine/pick.mjs): Claude's letters
// become photo ids, the prompt carries the board's own look, and the contact
// sheets hold one row per picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPicks, pickPrompt, contactSheets, wrap, PICK } from '../../scripts/engine/pick.mjs';

const slots = () => [
  { key: '0.1', section: 'Look', search: 'foggy harbour dawn', cands: ['a', 'b', 'c', 'd'].map((x) => ({ id: `pexels:${x}`, thumb: x })) },
  { key: '1.0', section: 'People', search: 'old fisherman portrait', cands: ['b', 'e'].map((x) => ({ id: `pexels:${x}`, thumb: x })) },
  { key: '2.2', section: 'Props', search: 'brass lamp', cands: [] },
];

test('picks: letters become ids, best first, at most three, a photo never on two rows', () => {
  const out = readPicks({ look: 'grey dawn', picks: [
    { slot: '0.1', order: ['b', 'D', 'a', 'c'] },
    { slot: '1.0', order: ['a', 'b'] }, // a = pexels:b, already picked for 0.1
    { slot: '9.9', order: ['a'] }, // not a row on the sheet
  ] }, slots());
  assert.equal(PICK.keep, 3);
  assert.deepEqual(out.get('0.1'), ['pexels:b', 'pexels:d', 'pexels:a']);
  assert.deepEqual(out.get('1.0'), ['pexels:e']);
  assert.deepEqual(out.get('2.2'), []); // no answer → nothing picked
  assert.equal(out.has('9.9'), false);
});

test('picks: a letter past the candidates shown is ignored', () => {
  const s = slots();
  s[0].shown = s[0].cands.slice(0, 2); // only a and b made it onto the sheet
  assert.deepEqual(readPicks({ picks: [{ slot: '0.1', order: ['c', 'b'] }] }, s).get('0.1'), ['pexels:b']);
});

test('pick prompt: the board, its own look, the sheets and the last reviewer notes', () => {
  const recipe = { title: 'Saltmarsh', story: 'A coastal short.', sections: [{ name: 'Look', items: [
    { kind: 'palette', title: 'Dawn', swatches: [{ name: 'Fog', hex: '#c9d1d6' }] },
    { kind: 'note', title: 'Light', body: 'Overcast only.' },
    { kind: 'note', title: 'INT. HUT', body: 'Script line', font: 'script' },
  ] }] };
  const p = pickPrompt(recipe, [{ file: '/x/sheet-1.jpg' }], { notes: ['the headshot is stock'] });
  assert.match(p, /\/x\/sheet-1\.jpg/);
  assert.match(p, /Saltmarsh/);
  assert.match(p, /Fog #c9d1d6/);
  assert.match(p, /Overcast only/);
  assert.doesNotMatch(p, /Script line/);
  assert.match(p, /the headshot is stock/);
  assert.match(p, /ONE world/);
  assert.match(p, /studio product shot/); // the costume trial's beanie on a plain backdrop
  assert.match(p, /never settle for the least bad candidate/);
});

test('contact sheets: one row per slot, a sheet per six rows, broken previews dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pick-'));
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } }).png().toBuffer();
  const s = Array.from({ length: 7 }, (_, i) => ({ key: `0.${i}`, section: 'Look', search: `search ${i}`,
    cands: [{ id: `p:${i}a`, thumb: 'ok' }, { id: `p:${i}b`, thumb: 'broken' }, { id: `p:${i}c`, thumb: 'ok' }] }));
  const sheets = await contactSheets(s, dir, { fetchThumb: async (u) => { if (u === 'broken') throw new Error('404'); return png; } });
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets[1].keys, ['0.6']);
  assert.deepEqual(s[0].shown.map((c) => c.id), ['p:0a', 'p:0c']);
  const meta = await sharp(sheets[0].file).metadata();
  assert.equal(meta.height, 6 * (PICK.cell[1] + PICK.gap) + PICK.gap);
});

test('labels wrap by words', () => {
  assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(wrap('a b c d e f g', 1, 3), ['a', 'b', 'c']);
});
