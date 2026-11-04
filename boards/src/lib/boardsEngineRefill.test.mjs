// The boards engine's last try: what the screen takes out is refilled from the slot's next pick (and
// looked at), a photo the look read writing off is swapped while a spare pick exists, and the prompts
// and the validator keep the board's pictures different and free of writing. Pexels and the image host
// are a stubbed fetch with real small JPEGs; nothing here reaches the network or Claude.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { findPhotos, writingIn } from '../../scripts/engine/photos.mjs';
import { readUnify, applyScreen, unifyPrompt, pickPrompt, unifyBudget, finalVerdicts, backChooser, splitScreen, lastTryCuts, UNIFY } from '../../scripts/engine/pick.mjs';
import { validateRecipe } from '../../scripts/engine/recipe.mjs';

const SLOTS = 6;
const KEYS = Array.from({ length: SLOTS }, (_, i) => `0.${i}`);
const idOf = (slot, j) => 1000 * (slot + 1) + j;
const nameOf = (slot, j) => `pexels:${idOf(slot, j)}`;

const recipe = {
  title: 'Refill test',
  sections: [{ name: 'Look', items: KEYS.map((_, i) => ({ kind: 'picture', search: `refill test ${i}` })) }],
};

function noisePhoto(seed) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const w = 18;
  const h = 16;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i += 1) raw.fill(Math.floor(rand() * 256), i * 3, i * 3 + 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).resize(180, 160, { kernel: 'nearest' }).jpeg().toBuffer();
}

const realFetch = globalThis.fetch;
const jpegs = new Map();
let perSlot = 5; // candidates a search returns; 1 leaves no spare pick

before(async () => {
  for (let s = 0; s < SLOTS; s += 1) for (let j = 0; j < 5; j += 1) jpegs.set(idOf(s, j), await noisePhoto(idOf(s, j) * 7919));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.pexels.com') {
      const slot = Number(url.searchParams.get('query').split(' ').pop());
      const photos = Array.from({ length: perSlot }, (_, j) => ({
        id: idOf(slot, j), width: 3000, height: 2000, alt: `photo ${slot}.${j}`,
        src: { original: `https://images.pexels.com/photos/${idOf(slot, j)}/pexels-photo-${idOf(slot, j)}.jpeg`, medium: `https://images.pexels.com/m/${idOf(slot, j)}.jpeg` },
        photographer: 'Test Photographer', photographer_url: 'https://www.pexels.com/@test', url: `https://www.pexels.com/photo/${idOf(slot, j)}/`,
      }));
      return Response.json({ photos });
    }
    if (url.hostname === 'api.unsplash.com') return Response.json({ results: [] });
    if (url.hostname === 'images.pexels.com') {
      const id = Number(url.pathname.match(/photos\/(\d+)\//)?.[1]);
      if (!jpegs.has(id)) return new Response('not found', { status: 404 });
      return new Response(jpegs.get(id), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response('unexpected', { status: 404 });
  };
});

after(() => { globalThis.fetch = realFetch; });

// check() answers 'real', with the look's `looks` when `looksOf` gives them.
async function run({ screen, chooseBack = null, looksOf = () => undefined, count = 5, verdictOf = () => 'real', checkFails = 0 }) {
  perSlot = count;
  const dir = mkdtempSync(join(tmpdir(), 'engine-refill-'));
  const checks = [];
  const logs = [];
  let fails = checkFails;
  const check = async (items) => {
    if (items.length === 1 && fails > 0 && checks.length > 0) { fails -= 1; throw new Error('look down'); }
    checks.push(items.map((it) => it.name));
    return items.map((it) => ({ file: it.file, verdict: verdictOf(it.name), sha: `sha-${it.name}`, why: [], looks: looksOf(it.name) }));
  };
  try {
    const result = await findPhotos(recipe, { dir, keys: { pexels: 'x', unsplash: 'y' }, check, screen, chooseBack, log: (m) => logs.push(m) });
    return { result, checks, logs };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a last-try screen out with a spare is refilled by the next pick, which is looked at', async () => {
  let spareSeen = null;
  const screen = async (picked, { spare }) => {
    spareSeen = spare;
    return { out: new Map([['0.1', 'off the world']]), stop: false, refill: true };
  };
  const { result, checks, logs } = await run({ screen });
  assert.equal(spareSeen.get('0.1'), 4, 'the screen is told how many picks the slot has left');
  assert.equal(checks.length, 2);
  assert.deepEqual(checks[1], [nameOf(1, 1)], 'the next pick is looked at');
  assert.equal(result.found.size, SLOTS);
  assert.equal(result.found.get('0.1').id, nameOf(1, 1));
  assert.deepEqual(result.missing, []);
  assert.ok(logs.some((m) => m.includes('0.1 refilled by pexels:2001')));
  assert.ok(![...result.seen].some((f) => f.includes('2001')), 'the refill was never shown to the screen');
});

test('a last-try swap whose refill cannot download keeps the original photo, looked at once after the rounds', async () => {
  const gone = [];
  for (let j = 1; j < 5; j += 1) { gone.push([j, jpegs.get(idOf(1, j))]); jpegs.delete(idOf(1, j)); } // every swap 404s
  const screen = async () => ({ out: new Map([['0.1', 'off the world']]), stop: false, refill: true });
  try {
    const { result, checks, logs } = await run({ screen });
    assert.equal(result.found.get('0.1').id, nameOf(1, 0));
    assert.deepEqual(result.missing, []);
    assert.equal(checks.length, 2);
    assert.deepEqual(checks[1], [nameOf(1, 0)], 'looked at once, after the rounds');
    assert.ok(logs.some((m) => m === `photos: 0.1 keeps ${nameOf(1, 0)}, its swap found nothing better`));
  } finally { for (const [j, b] of gone) jpegs.set(idOf(1, j), b); }
});

test('a last-try swap whose refill is rejected by the look keeps the original photo', async () => {
  const screen = async () => ({ out: new Map([['0.1', 'off the world']]), stop: false, refill: true });
  const verdictOf = (name) => (name === nameOf(1, 1) ? 'fake' : 'real');
  const { result, checks } = await run({ screen, verdictOf, count: 2 });
  assert.equal(result.found.get('0.1').id, nameOf(1, 0));
  assert.deepEqual(checks.at(-1), [nameOf(1, 0)]);
  assert.equal(result.rejected, 1);
});

test('a fallback that fails its look stays missing, and a failing look call leaves it missing', async () => {
  const screen = async () => ({ out: new Map([['0.1', 'off the world']]), stop: false, refill: true });
  const bad = await run({ screen, count: 1, verdictOf: (n) => (n === nameOf(1, 0) ? 'fake' : 'real') });
  assert.deepEqual(bad.result.missing, ['0.1']);
  assert.equal(bad.result.rejected, 1);
  perSlot = 1;
  const dir = mkdtempSync(join(tmpdir(), 'engine-refill-'));
  const logs = [];
  let calls = 0;
  const check = async (items) => {
    calls += 1;
    if (calls > 1) throw new Error('boom');
    return items.map((it) => ({ file: it.file, verdict: 'real', sha: `sha-${it.name}`, why: [] }));
  };
  try {
    const result = await findPhotos(recipe, { dir, keys: { pexels: 'x', unsplash: 'y' }, check, screen, log: (m) => logs.push(m) });
    assert.deepEqual(result.missing, ['0.1']);
    assert.equal(calls, 3, 'the look was retried once');
    assert.ok(logs.some((m) => m === 'photos: fallback look failed (boom); trying once more'));
    assert.ok(logs.some((m) => m === 'photos: fallback look failed (boom)'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a screen without refill still clears the slot (the earlier tries)', async () => {
  const screen = async () => ({ out: new Map([['0.1', 'off the world']]), stop: false });
  const { result } = await run({ screen });
  assert.deepEqual(result.missing, ['0.1']);
});

test('readUnify ignores a spare field: the floor and the fixed veto hold', () => {
  const keys = ['0.0', '0.1', '0.2', '0.3', '0.4', '0.5'];
  const answer = { out: [{ n: 1, why: 'a' }, { n: 2, why: 'b' }] };
  const floor = { onBoard: () => true, keep: 6, fixed: (k) => k === '0.1', spare: () => true };
  assert.deepEqual([...readUnify(answer, keys, () => {}, floor)], []);
  assert.deepEqual([...readUnify(answer, keys, () => {}, { ...floor, keep: 5, fixed: () => false })].map(([k]) => k), ['0.0']);
});

const WROTE = [{ marks: ['a neon sign reading "OPEN" on the left'], realSigns: ['film grain'] }];

test('readable writing sends the photo back only when the slot has a spare', async () => {
  const looksOf = (name) => (name === nameOf(2, 0) ? WROTE : undefined);
  const withSpare = await run({ looksOf });
  assert.equal(withSpare.result.found.get('0.2').id, nameOf(2, 1));
  assert.equal(withSpare.result.rejected, 1);
  assert.ok(withSpare.logs.some((m) => m.startsWith(`photos: ${nameOf(2, 0)} out (writing: a neon sign`)));

  const without = await run({ looksOf, count: 1 });
  assert.equal(without.result.found.get('0.2').id, nameOf(2, 0));
  assert.equal(without.result.rejected, 0);
  assert.ok(without.logs.some((m) => m === `photos: ${nameOf(2, 0)} writing kept (no spare)`));
});

test('a writing reject whose next pick fails keeps the writing photo with no second look', async () => {
  const looksOf = (name) => (name === nameOf(2, 0) ? WROTE : undefined);
  const gone = [];
  for (let j = 1; j < 5; j += 1) { gone.push([j, jpegs.get(idOf(2, j))]); jpegs.delete(idOf(2, j)); }
  try {
    const { result, checks, logs } = await run({ looksOf });
    assert.equal(result.found.get('0.2').id, nameOf(2, 0));
    assert.equal(checks.flat().filter((n) => n === nameOf(2, 0)).length, 1, 'looked at once only');
    assert.ok(logs.some((m) => m === `photos: 0.2 keeps ${nameOf(2, 0)}, its swap found nothing better`));
  } finally { for (const [j, b] of gone) jpegs.set(idOf(2, j), b); }
});

test('applyScreen: a deferred misfit goes above the floor, stays at it, and a storyboard frame stays', () => {
  const ph = (f) => ({ file: f });
  const mkFound = () => new Map(['0.0', '0.1', '0.2', '0.3'].map((k) => [k, ph(`${k}.jpg`)]));
  const files = new Map([...mkFound()].map(([k, p]) => [k, p.file]));
  const named = new Map([['0.0', 'a'], ['0.1', 'b'], ['0.2', 'c']]);
  const onBoard = () => true;
  let found = mkFound(); let missing = []; const logs = [];
  applyScreen(found, missing, named, files, { onBoard, keep: 2, fixed: () => false }, (m) => logs.push(m));
  assert.deepEqual([...found.keys()], ['0.2', '0.3']);
  assert.deepEqual(missing, ['0.0', '0.1']);
  assert.ok(logs.includes('unify: 0.2 kept, the board needs 2 pictures'));
  found = mkFound(); missing = [];
  applyScreen(found, missing, named, files, { onBoard, keep: 0, fixed: (k) => k === '0.0' }, (m) => logs.push(m));
  assert.ok(found.has('0.0'));
  assert.deepEqual(missing, ['0.1', '0.2']);
  assert.ok(logs.includes('unify: 0.0 kept, a storyboard frame'));
  found = mkFound(); found.set('0.0', ph('swapped.jpg')); missing = [];
  applyScreen(found, missing, new Map([['0.0', 'a']]), files, { onBoard, keep: 0, fixed: () => false });
  assert.equal(found.get('0.0').file, 'swapped.jpg');
  assert.deepEqual(missing, []);
  found = mkFound(); missing = [];
  applyScreen(found, missing, new Map([['0.3', 'z']]), files, { onBoard: (k) => k !== '0.3', keep: 9, fixed: () => false });
  assert.deepEqual(missing, ['0.3']);
});

test('writingIn wants a quoted transcription beside a word for writing', () => {
  assert.ok(writingIn({ looks: WROTE }));
  assert.equal(writingIn({ looks: [{ marks: [], realSigns: ['a sign above the door'] }] }), '', 'no quotation');
  assert.equal(writingIn({ looks: [{ marks: ['"x" in the corner'], realSigns: [] }] }), '', 'one character, no word for writing');
  assert.equal(writingIn({ look: { marks: ['label "Kodak 400" on the film'], realSigns: [] } }), 'label "Kodak 400" on the film');
  assert.equal(writingIn({}), '');
});

test('the unify prompt names near-duplicates, and the pick prompt judges place and era', () => {
  const r = { title: 'T', story: 'S', sections: [{ name: 'A', items: [{ kind: 'picture', search: 'x y' }] }] };
  assert.ok(unifyPrompt(r, 'together.jpg', ['0.0']).includes('Two photos of the same subject or the same shot (two mirror balls, two rain-on-glass close-ups, two of one road): name the weaker one; the board needs each picture to show something new.'));
  assert.ok(pickPrompt(r, [{ file: 's.jpg' }]).includes('against the board\'s place and era'));
});

test('the recipe validator rejects a search for something that carries writing', () => {
  const problemsFor = (search) => validateRecipe({ title: 'T', slug: 't', story: 's', sections: [{ name: 'A', color: 'blue', items: [{ kind: 'picture', search }] }] })
    .filter((p) => p.includes('carries writing'));
  assert.equal(problemsFor('neon sign at night').length, 1);
  assert.match(problemsFor('neon sign at night')[0], /neon sign at night/);
  assert.equal(problemsFor('roller rink at night').length, 0);
});

// Two slots (0.1, 0.2) are screened out with no refill to find, so each falls back to an unlooked photo.
const twoOut = async () => ({ out: new Map([['0.1', 'a'], ['0.2', 'b']]), stop: false, refill: true });

test('chooseBack: only the chosen unlooked fallbacks are looked at and restored; the rest stay missing', async () => {
  const gone = [];
  for (const s of [1, 2]) for (let j = 1; j < 5; j += 1) { gone.push([s, j, jpegs.get(idOf(s, j))]); jpegs.delete(idOf(s, j)); }
  try {
    let asked = null;
    const { result, checks, logs } = await run({ screen: twoOut, chooseBack: (keys) => { asked = keys; return ['0.2']; } });
    assert.deepEqual(asked, ['0.1', '0.2'], 'in the order the screen named them');
    assert.deepEqual(checks.at(-1), [nameOf(2, 0)], 'only the chosen one gets a look');
    assert.ok(result.found.has('0.2'));
    assert.deepEqual(result.missing, ['0.1']);
    assert.ok(logs.includes('photos: 0.1 left out, the board has the pictures it needs'));
  } finally { for (const [s, j, b] of gone) jpegs.set(idOf(s, j), b); }
});

test('backChooser: a fixed frame is chosen, an onBoard one only below the floor, one not onBoard never', () => {
  const found = new Map(['0.0', '0.1', '0.2'].map((k) => [k, { file: `${k}.jpg` }]));
  const floor = { onBoard: (k) => k.startsWith('0.'), keep: 5, fixed: (k) => k === '0.9' };
  // 3 on the board, keep 5: 0.3 and the frame 0.9 reach it, so 0.4 and 0.5 are left out; with 1.0 that is three
  // left out against a budget of 2 (8 photos and keys), so the last, 1.0, comes back.
  assert.deepEqual(backChooser(floor)(['0.3', '0.9', '0.4', '0.5', '1.0'], found), ['0.3', '0.9', '1.0']);
  assert.deepEqual(backChooser({ ...floor, keep: 3 })(['0.3', '0.9', '1.0'], found), ['0.9'], 'at the floor already');
});

test('backChooser: more left out than the budget allows, the last of them come back', () => {
  // 5 found photos + 4 keys = 9, budget 3: all four sub-cluster keys are left out, one over.
  const found = new Map(Array.from({ length: 5 }, (_, i) => [`0.${i}`, { file: `${i}.jpg` }]));
  const floor = { onBoard: (k) => k.startsWith('0.'), keep: 5 };
  assert.equal(unifyBudget(9), 3);
  assert.deepEqual(backChooser(floor)(['1.0', '1.1', '1.2', '1.3'], found), ['1.3']);
});

test('backChooser: fewer than UNIFY.least photos in all, every key comes back', () => {
  const found = new Map([['0.0', { file: 'a.jpg' }]]);
  const floor = { onBoard: (k) => k.startsWith('0.'), keep: 1 };
  assert.ok(1 + 2 < UNIFY.least);
  assert.deepEqual(backChooser(floor)(['1.0', '0.5'], found), ['1.0', '0.5']);
});

test('backChooser: a fixed onBoard frame counts toward the floor', () => {
  // 12 found + 3 keys = 15, budget 5, so leaving one out is allowed. 3 on the board, keep 4: the frame makes 4.
  const found = new Map(Array.from({ length: 12 }, (_, i) => [`${i < 3 ? 0 : 1}.${i}`, { file: `${i}.jpg` }]));
  const floor = { onBoard: (k) => k.startsWith('0.'), keep: 4, fixed: (k) => k === '0.9' };
  assert.deepEqual(backChooser(floor)(['0.9', '0.8'], found), ['0.9']);
  assert.deepEqual(backChooser({ ...floor, keep: 5 })(['0.9', '0.8'], found), ['0.9', '0.8'], 'one short of the floor still takes it');
});

test('a throwing fallback look is retried once; a second throw leaves them missing', async () => {
  const gone = [];
  for (let j = 1; j < 5; j += 1) { gone.push([j, jpegs.get(idOf(1, j))]); jpegs.delete(idOf(1, j)); }
  const screen = async () => ({ out: new Map([['0.1', 'a']]), stop: false, refill: true });
  try {
    const once = await run({ screen, checkFails: 1 });
    assert.ok(once.result.found.has('0.1'), 'the retry succeeded');
    assert.ok(once.logs.some((m) => m.startsWith('photos: fallback look failed (look down)')));
    const twice = await run({ screen, checkFails: 2 });
    assert.deepEqual(twice.result.missing, ['0.1']);
  } finally { for (const [j, b] of gone) jpegs.set(idOf(1, j), b); }
});

test('the screen and the final unify share one budget: never more than a third of what the screen was shown', () => {
  assert.equal(unifyBudget(12), Math.floor(12 * UNIFY.most));
  const ph = (f) => ({ file: f });
  const found = new Map(Array.from({ length: 12 }, (_, i) => [`0.${i}`, ph(`${i}.jpg`)]));
  const files = new Map([...found].map(([k, p]) => [k, p.file]));
  const named = new Map([['0.0', 'a'], ['0.1', 'b'], ['0.2', 'c'], ['0.3', 'd'], ['0.4', 'e']]);
  const missing = [];
  const budget = unifyBudget(12);
  const removed = applyScreen(found, missing, named, files, { onBoard: () => true, keep: 0, fixed: () => false }, () => {}, budget);
  assert.equal(removed, 4);
  assert.deepEqual(missing, ['0.0', '0.1', '0.2', '0.3'], 'worst first; the rest wait out the budget');
  // The final unify names a seen key (ignored) and two new ones.
  found.set('0.9', ph('swap.jpg'));
  found.set('0.8', ph('swap2.jpg'));
  const odd = new Map([['0.5', 'seen'], ['0.9', 'new'], ['0.8', 'new']]);
  assert.deepEqual([...finalVerdicts(odd, found, new Set(files.values()), budget - removed)], [], 'budget spent');
  assert.deepEqual([...finalVerdicts(odd, found, new Set(files.values()), 1)], [['0.9', 'new']], 'seen ignored, one left');
});

// The last try's step after findPhotos: found = n photos, each its own file.
const cutsFor = ({ n, namedKeys = [], seenKeys, leftOut = [], odd = new Map(), fixed = () => false, keep = 0 }) => {
  const found = new Map(Array.from({ length: n }, (_, i) => [`0.${i}`, { file: `${i}.jpg` }]));
  const files = new Map([...found].map(([k, p]) => [k, p.file]));
  const seen = new Set((seenKeys || [...found.keys()]).map((k) => found.get(k)?.file));
  const missing = [];
  return { found, missing, run: () => lastTryCuts({ found, missing, named: new Map(namedKeys.map((k) => [k, 'x'])), screenFiles: files, seen, leftOut, floor: { onBoard: () => true, keep, fixed }, unify: async () => odd }) };
};

test('lastTryCuts: the screen saw 18, named 6 with no spare, the look rejected 3 more: no more than 5 removed in all', async () => {
  // HEAD's final unify over the 15 found would take at most 5.
  const c = cutsFor({ n: 15, namedKeys: ['0.0', '0.1', '0.2', '0.3', '0.4', '0.5'] });
  const { removed, budget } = await c.run();
  assert.equal(budget, 5);
  assert.ok(removed.length <= 5);
  assert.equal(c.found.size, 15 - removed.length);
});

test('lastTryCuts: left-outs, screen removals and an unseen photo named by the final unify stay within one budget', async () => {
  const c = cutsFor({ n: 11, namedKeys: ['0.0', '0.1'], seenKeys: Array.from({ length: 10 }, (_, i) => `0.${i}`), leftOut: ['1.0'], odd: new Map([['0.10', 'new'], ['0.5', 'seen']]) });
  const { removed, budget } = await c.run();
  // n = 11 found + 1 left out = 12 -> 4; the left-out takes 1, leaving 3: two screened, one unseen.
  assert.equal(budget, 3);
  assert.deepEqual(removed, ['0.0', '0.1', '0.10']);
  assert.ok(removed.length + 1 <= unifyBudget(12));
  const tight = cutsFor({ n: 11, namedKeys: ['0.0', '0.1', '0.2'], seenKeys: Array.from({ length: 10 }, (_, i) => `0.${i}`), leftOut: ['1.0'], odd: new Map([['0.10', 'new']]) });
  assert.deepEqual((await tight.run()).removed, ['0.0', '0.1', '0.2'], 'the unseen one waits out the spent budget');
});

test('lastTryCuts: fewer than UNIFY.least photos, nothing is removed', async () => {
  const c = cutsFor({ n: UNIFY.least - 1, namedKeys: ['0.0'], seenKeys: [], odd: new Map([['0.1', 'new']]) });
  assert.deepEqual((await c.run()).removed, []);
  assert.equal(c.found.size, UNIFY.least - 1);
});

test('lastTryCuts: a fixed frame is never removed, by the screen or by the final unify', async () => {
  const c = cutsFor({ n: 12, namedKeys: ['0.0', '0.1'], seenKeys: Array.from({ length: 11 }, (_, i) => `0.${i}`), odd: new Map([['0.11', 'new']]), fixed: (k) => k === '0.0' || k === '0.11' });
  const { removed } = await c.run();
  assert.deepEqual(removed, ['0.1']);
  assert.ok(c.found.has('0.0') && c.found.has('0.11'));
});

test('splitScreen: a misfit with a spare is swapped, but a storyboard frame never is', () => {
  const all = new Map([['0.0', 'a'], ['0.1', 'b'], ['0.2', 'c']]);
  const spare = new Map([['0.0', 3], ['0.1', 3], ['0.2', 0]]);
  const { out, kept } = splitScreen(all, spare, (k) => k === '0.0');
  assert.deepEqual([...out.keys()], ['0.1']);
  assert.deepEqual([...kept.keys()], ['0.0', '0.2']);
});
