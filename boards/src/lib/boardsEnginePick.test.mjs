// The boards engine's photo picker (scripts/engine/pick.mjs): Claude's letters
// become photo ids, the prompt carries the board's own look, and the contact
// sheets hold one row per picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPicks, pickPrompt, contactSheets, wrap, PICK, unifyPhotos, unifyPrompt, readUnify, UNIFY } from '../../scripts/engine/pick.mjs';

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
    { kind: 'script', title: 'Sc. 1', fountain: 'INT. HUT - NIGHT\n\nScript line' },
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

// ── side by side ─────────────────────────────────────────────────────────────

const recipe = { title: 'Lido dawn', story: 'A commercial at a lido at dawn.', sections: [
  { name: 'Water', items: [{ kind: 'picture', search: 'lido steam dawn', caption: 'Steam, deep end' }, { kind: 'picture', search: 'pool tiles' }, { kind: 'note', title: 'Light', body: 'Low gold sun' }] },
  { name: 'Motion', items: [{ kind: 'video', search: 'pool ripples' }, { kind: 'picture', search: 'lido cabins' }, { kind: 'picture', search: 'diving board' }, { kind: 'picture', search: 'frost bench' }] },
] };

test('side by side: numbers become keys, worst first, at most a third, repeats and strays dropped', () => {
  const keys = ['0.0', '0.1', '1.0', '1.1', '1.2', '1.3'];
  const out = readUnify({ world: 'grey dawn', out: [{ n: 1, why: 'a river' }, { n: 1, why: 'again' }, { n: 9, why: 'no such' }, { n: 4, why: 'noon' }, { n: 5, why: 'one too many' }] }, keys);
  assert.deepEqual([...out], [['0.0', 'a river'], ['1.1', 'noon']]);
  assert.equal(readUnify({ world: 'x', out: [] }, keys).size, 0);
  // A last try keeps the board its pictures: here 5 of its own, 4 needed, so only one of them goes; the
  // sub-cluster's (section 1, past the board's one section) can still go.
  const floor = { onBoard: (k) => k.startsWith('0.'), keep: 4 };
  const fk = ['0.0', '0.1', '0.2', '0.3', '0.4', '1.0', '1.1', '1.2', '1.3'];
  const kept = readUnify({ world: 'x', out: [{ n: 1, why: 'a' }, { n: 2, why: 'b' }, { n: 6, why: 'c' }] }, fk, () => {}, floor);
  assert.deepEqual([...kept.keys()], ['0.0', '1.0']);
  // Nor a storyboard frame: its number is the shot list's.
  const framed = readUnify({ world: 'x', out: [{ n: 1, why: 'a' }, { n: 2, why: 'b' }] }, fk, () => {}, { ...floor, fixed: (k) => k === '0.0' });
  assert.deepEqual([...framed.keys()], ['0.1']);
  const p = unifyPrompt(recipe, '/x/together.jpg', keys);
  assert.match(p, /1\. section "Water": "Steam, deep end", found by "lido steam dawn"/);
  assert.match(p, /3\. section "Motion", a video \(its still\): found by "pool ripples"/);
  assert.match(p, /at most 2\./);
  assert.match(p, /note "Light": Low gold sun/);
  assert.match(p, /graffiti/);
});

test('side by side: every photo goes on one numbered sheet; too few to compare, no call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unify-'));
  const found = new Map();
  for (const [i, key] of ['0.0', '0.1', '1.0', '1.1', '1.2', '1.3'].entries()) {
    const file = join(dir, `${i}.jpg`);
    await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 20 * i, g: 90, b: 120 } } }).jpeg().toFile(file);
    found.set(key, { file, sha: `s${i}`, ...(key === '1.0' ? { video: '/x.mp4' } : {}) });
  }
  found.set('9.9', { media: 'sound', file: '/x.m4a' });
  let asked = null;
  const claude = async (o) => { asked = o; return { world: 'teal dawn', out: [{ n: 2, why: 'white tiles' }] }; };
  const out = await unifyPhotos({ recipe, found, dir, claude });
  assert.deepEqual([...out], [['0.1', 'white tiles']]);
  assert.match(asked.prompt, /holds the 6 photos/);
  const meta = await sharp(join(dir, 'together.jpg')).metadata();
  assert.equal(meta.width, UNIFY.cols * (UNIFY.cell[0] + UNIFY.gap) + UNIFY.gap);
  assert.equal(meta.height, 2 * (UNIFY.cell[1] + UNIFY.gap) + UNIFY.gap);
  const few = new Map([...found].slice(0, UNIFY.least - 1));
  assert.equal((await unifyPhotos({ recipe, found: few, dir, claude: () => { throw new Error('no call'); } })).size, 0);
});
