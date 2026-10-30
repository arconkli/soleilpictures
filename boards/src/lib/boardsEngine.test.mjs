// The boards engine's pure parts (scripts/engine/): the recipe's rules, the
// layout a recipe and its photos become, and the strict check every board
// passes before anyone sees it. The parts that reach out (Claude, Pexels,
// aicheck, the camera, R2, the database) are run by scripts/engine/run.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { validateRecipe, recipeContents, scriptProblems, RULES } from '../../scripts/engine/recipe.mjs';
import { buildBoard, withSources, stripBuild, SCRIPT_SHAPE } from '../../scripts/engine/build.mjs';
import { encodeBoardSnapshot, buildCardIndexRows } from '../../scripts/lib/cardEncode.mjs';
import { cardScope, getDocMode, readPages, pageContentMap } from './docState.js';
import { checkBoard, contrast, CHECK } from '../../scripts/engine/check.mjs';
import { PAGES, LATER_PAGES, MARKETING, nextMarketing, pageBrief } from '../../scripts/engine/subjects.mjs';
import { hamming, isDup } from '../../scripts/engine/photos.mjs';
import { args } from '../../scripts/engine/args.mjs';
import { libraryState } from '../../scripts/lib/showcaseWrite.mjs';

const pic = (search, caption) => ({ kind: 'picture', search, ...(caption ? { caption } : {}) });
const palette = { kind: 'palette', title: 'Palette', swatches: [
  { name: 'Night', hex: '#1d2a3a' }, { name: 'Lamp', hex: '#e8b04a' }, { name: 'Fog', hex: '#c9d1d6' }, { name: 'Rust', hex: '#8a4b2a' }] };

const SCENE = [
  'INT. LANTERN ROOM - NIGHT',
  '',
  'Rain hammers the glass. TOM (68) winds the clockwork by hand, counting under his breath.',
  '',
  'TOM',
  '(to the lamp)',
  'Forty-one years. You never once went out on me.',
  '',
  'The beam swings across the dark water. Far out, a single ship light answers.',
  '',
  'TOM (CONT\'D)',
  'Not tonight either.',
  '',
  'CUT TO:',
].join('\n');

function sample() {
  return {
    title: 'The Lighthouse Keeper',
    slug: 'lighthouse-keeper-treatment',
    story: 'A short film about the last keeper on a northern rock.',
    sections: [
      { name: 'Look', color: 'slate', items: [pic('lighthouse storm night'), pic('foggy rocky coast'), pic('old lantern room'),
        pic('waves crashing rocks'), { kind: 'note', title: 'Light', body: 'Cold blue nights, one warm lamp.' },
        { kind: 'checklist', title: 'Still to find', checks: [{ text: 'Lamp motor sound', done: true }, { text: 'Keeper coat', done: false },
          { text: 'Logbook prop', done: false }] }] },
      { name: 'Keeper', color: 'clay', items: [pic('old man wool sweater', 'Tom, 68'), pic('weathered hands rope'), pic('kettle on stove'),
        { kind: 'note', title: 'Who he is', body: 'He has kept the light for forty years.' }, palette,
        { kind: 'table', title: 'Wardrobe', rows: [['Piece', 'Fabric'], ['Sweater', 'Oiled wool'], ['Coat', 'Waxed cotton']] }] },
      { name: 'Script', color: 'plum', items: [
        { kind: 'script', title: 'Sc. 4 — The last lamp', fountain: SCENE },
        pic('ship lights at sea'), pic('stone stairs spiral'), pic('logbook handwriting old'),
        { kind: 'note', title: 'Sound', body: 'Clockwork, rain, the lamp motor. No score until the ship.' }] },
    ],
    seo: {
      title: 'Director\'s treatment example: The Lighthouse Keeper',
      description: 'A director\'s treatment board for a short film: look, keeper, script page and palette in one place.',
      body: `A treatment ${'word '.repeat(260)}`,
      keyword: 'treatment',
    },
  };
}

function photosFor(recipe) {
  const found = new Map();
  recipe.sections.forEach((s, si) => s.items.forEach((it, ii) => {
    if (it.kind !== 'picture' && it.kind !== 'video') return;
    const tall = ii % 2 === 1;
    found.set(`${si}.${ii}`, { w: tall ? 1600 : 2400, h: tall ? 2400 : 1600, sha: `sha-${si}-${ii}`, alt: it.search, id: `pexels:${si}${ii}`,
      ...(it.kind === 'video' ? { video: `v-${si}-${ii}.mp4` } : {}) });
  }));
  return found;
}

const checked = (found) => [...found].map(([key, p]) => ({ key, sha: p.sha, verdict: 'real', licence: 'Pexels' }));

function build(recipe = sample(), found = photosFor(recipe)) {
  let n = 0;
  return { recipe, found, board: buildBoard(recipe, found, { newId: () => `id-${(n += 1)}`, now: '2026-10-29T12:00:00.000Z' }) };
}

// ── the recipe ───────────────────────────────────────────────────────────────

test('a good recipe has no problems', () => {
  assert.deepEqual(validateRecipe(sample(), { wants: ['script'] }), []);
});

test('a recipe names what is wrong with it, in words Claude can act on', () => {
  const r = sample();
  r.slug = 'pricing';
  r.sections[0].items[1].search = 'lighthouse storm night';
  r.seo.keyword = 'storyboard';
  const p = validateRecipe(r, { wants: ['script'] });
  assert.ok(p.some((x) => /path the site owns/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /used twice/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /keyword must appear/.test(x)), p.join('\n'));
});

test('a recipe holds what its brief wants, and nothing it does not', () => {
  const noScript = sample();
  noScript.sections[2].items[0] = { kind: 'note', title: 'Page 1', body: 'Plain note.' };
  assert.ok(validateRecipe(noScript, { wants: ['script'] }).some((x) => /wants a script/.test(x)));
  assert.deepEqual(validateRecipe(sample(), { wants: ['script'] }), []);
  const two = sample();
  two.sections[1].items.push({ kind: 'script', title: 'Sc. 9', fountain: SCENE });
  assert.ok(validateRecipe(two, { wants: ['script'] }).some((x) => /at most 1 script/.test(x)));
  assert.ok(validateRecipe(sample(), { wants: ['frames'] }).some((x) => /storyboard/.test(x)));
  // One video is a motion reference any board may hold; more is for a brief that wants video.
  const video = sample();
  video.sections[0].items[0] = { kind: 'video', search: 'lighthouse beam turning' };
  assert.deepEqual(validateRecipe(video, { wants: ['script'] }), []);
  video.sections[1].items[0] = { kind: 'video', search: 'old man walking stairs' };
  assert.ok(validateRecipe(video, {}).some((x) => /at most 1 video/.test(x)));
  assert.ok(validateRecipe(sample(), { wants: ['video'] }).some((x) => new RegExp(`${RULES.videos[0]}–${RULES.videos[1]} videos`).test(x)));
});

test('a recipe the slug of another board already holds is refused', () => {
  assert.ok(validateRecipe(sample(), { wants: ['script'] }, { taken: ['lighthouse-keeper-treatment'] }).some((x) => /already taken/.test(x)));
});

test('too few pictures, an empty section and a bad swatch are each named', () => {
  const r = sample();
  r.sections[0].items = r.sections[0].items.filter((it) => it.kind !== 'picture');
  r.sections[1].items[4] = { ...palette, swatches: [{ name: 'Night', hex: 'navy' }, ...palette.swatches.slice(1)] };
  r.sections.push({ name: 'Extra', color: 'teal', items: [] });
  const p = validateRecipe(r, { wants: ['script'] });
  assert.ok(p.some((x) => /pictures, not 6/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /"Extra" is empty/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /hex like/.test(x)), p.join('\n'));
});

// ── the layout ───────────────────────────────────────────────────────────────

test('every item becomes one card, in its own section, with fresh ids', () => {
  const { recipe, board } = build();
  const items = recipe.sections.flatMap((s) => s.items);
  assert.equal(board.cards.length, items.length);
  assert.deepEqual(board.groups.map((g) => g.name), ['Look', 'Keeper', 'Script']);
  const ids = new Set(board.cards.map((c) => c.id));
  assert.equal(ids.size, board.cards.length);
  assert.ok(board.cards.every((c) => !String(c.id).startsWith('make-')));
  const groupIds = new Set(board.groups.map((g) => g.id));
  assert.ok(board.cards.every((c) => groupIds.has(c.groupId)));
  assert.deepEqual(board.dropped, []);
});

test('each picture card carries the photo it came from, at that photo\'s shape', () => {
  const { found, board } = build();
  const pics = board.cards.filter((c) => c.kind === 'image');
  assert.equal(pics.length, found.size);
  for (const c of pics) {
    const ph = found.get(c.photo);
    assert.ok(ph, `card ${c.id} has photo ${c.photo}`);
    assert.ok(Math.abs(c.w / c.h - ph.w / ph.h) < 0.02, `card ${c.photo} keeps its shape`);
    assert.equal(c.src, undefined);
  }
});

test('a script must read as a scene: a heading, action and a speech, a page or so long', () => {
  assert.deepEqual(scriptProblems({ title: 'Sc. 4', fountain: SCENE }), []);
  const p = scriptProblems({ title: '', fountain: 'Tom winds the clock. He says nothing at all.' });
  assert.ok(p.some((x) => /needs a title/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /characters of Fountain, not \d+/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /scene heading/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /needs a speech/.test(x)), p.join('\n'));
});

test('a script becomes the app\'s screenplay doc: a doc card in its column, at a page\'s shape', () => {
  const { board } = build();
  const doc = board.cards.find((c) => c.kind === 'doc');
  assert.ok(doc);
  assert.equal(doc.title, 'Sc. 4 — The last lamp');
  assert.equal(doc.script, SCENE);
  assert.ok(Math.abs(doc.w / doc.h - SCRIPT_SHAPE.width / SCRIPT_SHAPE.height) < 0.02);
  assert.equal(doc.groupId, board.groups.find((g) => g.name === 'Script').id);
  // The three notes and the checklist (a note of ticked lines); the script isn't one of them.
  assert.equal(board.cards.filter((c) => c.kind === 'note').length, 4);
});

test('a script is written into the card\'s own doc store in screenplay mode, and never stored as a field', () => {
  const { board } = build();
  const cards = stripBuild(board.cards);
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, Buffer.from(encodeBoardSnapshot(cards, [], { groups: board.groups }), 'base64'));
  const doc = cards.find((c) => c.kind === 'doc');
  const ym = ydoc.getMap('cards').get(doc.id);
  assert.equal(ym.get('script'), undefined);
  assert.equal(ym.get('kind'), 'doc');
  const scope = cardScope(ym);
  assert.equal(getDocMode(ydoc, scope), 'screenplay');
  const pages = readPages(ydoc, scope);
  assert.deepEqual(pages.map((p) => p.name), ['Sc. 4 — The last lamp']);
  const elements = pageContentMap(ydoc, scope).get(pages[0].id).toArray().map((n) => n.getAttribute('element'));
  assert.deepEqual(elements, ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'action', 'character', 'dialogue', 'transition']);
  const row = buildCardIndexRows({ workspaceId: 'w', boardId: 'b', cards }).find((r) => r.card_id === doc.id);
  assert.match(row.body, /^INT\. LANTERN ROOM - NIGHT\n/);
  assert.match(row.body, /Forty-one years/);
});

test('a picture with no checked photo is dropped, not left empty', () => {
  const recipe = sample();
  const found = photosFor(recipe);
  found.delete('0.2');
  const { board } = build(recipe, found);
  assert.deepEqual(board.dropped, ['0.2']);
  assert.equal(board.cards.filter((c) => c.kind === 'image').length, found.size);
});

test('a video is laid out as a picture and becomes a video card with its poster', () => {
  const recipe = sample();
  recipe.sections[0].items[0] = { kind: 'video', search: 'lighthouse beam turning', caption: 'The beam' };
  const found = photosFor(recipe);
  const { board } = build(recipe, found);
  const v = board.cards.find((c) => c.kind === 'video');
  assert.ok(v);
  assert.equal(v.title, 'The beam');
  const staged = withSources(board.cards, found, (ph, what) => `/engine-photos/${ph.sha}.${what}`);
  const sv = staged.find((c) => c.kind === 'video');
  assert.equal(sv.src, '/engine-photos/sha-0-0.video');
  assert.equal(sv.poster, '/engine-photos/sha-0-0.poster');
});

test('sources are filled in for the stored board and the build key is stripped on write', () => {
  const { found, board } = build();
  const withSrc = withSources(board.cards, found, (ph) => `r2:${ph.sha}.jpg`);
  assert.ok(withSrc.filter((c) => c.kind === 'image').every((c) => /^r2:/.test(c.src)));
  assert.ok(stripBuild(withSrc).every((c) => !('photo' in c)));
});

// ── the strict check ─────────────────────────────────────────────────────────

test('the sample board passes the strict check', () => {
  const { found, board } = build();
  assert.deepEqual(checkBoard(board, checked(found)), []);
});

test('the check refuses overlapping cards, a photo not proven real, and a photo used twice', () => {
  const { found, board } = build();
  const cards = board.cards.map((c) => ({ ...c }));
  cards[1].x = cards[0].x;
  cards[1].y = cards[0].y;
  const photos = checked(found);
  photos[2].verdict = 'unsure';
  photos[3].sha = photos[4].sha;
  photos[5].licence = '';
  const p = checkBoard({ cards, groups: board.groups }, photos);
  assert.ok(p.some((x) => /overlap/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /proven real \(unsure\)/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /twice/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /licence/.test(x)), p.join('\n'));
});

test('the check refuses a strip, a picture with nothing behind it, and a card in no section', () => {
  const { found, board } = build();
  const cards = board.cards.map((c, i) => ({ ...c, x: i * 400, y: 0 }));
  cards[0].groupId = 'gone';
  const photos = checked(found).filter((ph) => ph.key !== cards.find((c) => c.photo).photo);
  const p = checkBoard({ cards, groups: board.groups }, photos);
  assert.ok(p.some((x) => /the board is .*:1/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /no checked photo/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /doesn't exist/.test(x)), p.join('\n'));
});

test('a note on a dark tint is refused for contrast', () => {
  const { found, board } = build();
  const cards = board.cards.map((c) => (c.kind === 'note' ? { ...c, bgColor: '#333333' } : c));
  assert.ok(checkBoard({ cards, groups: board.groups }, checked(found)).some((x) => /reads at/.test(x)));
  assert.ok(contrast('#ffffff', CHECK.ink) > 15);
  assert.equal(contrast('navy', '#000000'), null);
});

// ── subjects and photos ──────────────────────────────────────────────────────

test('every page brief is for its own page, and the held pages have none yet', () => {
  const pages = PAGES.map((p) => p.page);
  assert.equal(new Set(pages).size, pages.length);
  for (const p of PAGES) {
    assert.match(p.page, /^\/[a-z0-9/-]+$/);
    assert.ok(p.brief.length > 40 && p.cluster && /^[a-z0-9-]+$/.test(p.subject), p.page);
  }
  for (const held of LATER_PAGES) assert.equal(pageBrief(held), null, held);
});

test('the daily subject is the one made least recently, never-made first', () => {
  assert.equal(nextMarketing([]).subject, MARKETING[0].subject);
  const made = MARKETING.map((m, i) => ({ subject: m.subject, made_at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() }));
  assert.equal(nextMarketing(made).subject, MARKETING[0].subject);
  made[0].made_at = '2026-10-29T06:00:00Z';
  assert.equal(nextMarketing(made).subject, MARKETING[1].subject);
  assert.equal(nextMarketing(made.slice(1)).subject, MARKETING[0].subject);
});

test('two pictures a few bits apart are one photo', () => {
  assert.equal(hamming('ffffffffffffffff', 'fffffffffffffff0'), 4);
  assert.ok(isDup('ffffffffffffffff', ['fffffffffffffff0']));
  assert.ok(!isDup('ffffffffffffffff', ['0000000000000000']));
});

// ── the command line, and boards made for a post ─────────────────────────────

test('--brief is a mode of its own, landing in the TikTok cluster unless told otherwise', () => {
  const a = args(['--brief', 'x']);
  assert.equal(a.mode, 'brief');
  assert.equal(a.brief, 'x');
  assert.equal(a.cluster, 'TikTok');
  const b = args(['--brief', 'x', '--cluster', 'Film', '--json', '/tmp/o.json', '--dry-run']);
  assert.deepEqual([b.mode, b.brief, b.cluster, b.json, b.dryRun], ['brief', 'x', 'Film', '/tmp/o.json', true]);
  assert.equal(args(['--daily', '--json', '/tmp/o.json']).json, '/tmp/o.json');
  assert.equal(args(['--daily', '--cluster', 'Film']).mode, 'daily');
});

test('the command line refuses what it does not know, no mode, and a brief with no text', () => {
  assert.throws(() => args(['--daily', '--bogus']), /unknown argument --bogus/);
  assert.throws(() => args([]), /say --daily/);
  assert.throws(() => args(['--dry-run']), /say --daily/);
  assert.throws(() => args(['--brief']), /needs the text/);
  assert.throws(() => args(['--brief', '--dry-run']), /needs the text/);
});

test('what is on a recipe comes out as short plain strings, at most forty', () => {
  const lines = recipeContents(sample());
  assert.equal(lines[0], 'Title: The Lighthouse Keeper');
  assert.ok(lines.includes('Section: Keeper'));
  assert.ok(lines.includes('Photo "Tom, 68" (old man wool sweater)'));
  assert.ok(lines.some((l) => l.startsWith('Note "Who he is": He has kept the light')));
  assert.ok(lines.some((l) => l.startsWith('Palette Palette: Night, Lamp')));
  assert.ok(lines.every((l) => typeof l === 'string' && l.length <= 140));
  assert.equal(recipeContents(sample(), 5).length, 5);
});

// A stand-in for the supabase client: from(table).select() resolves to that table's rows.
// A select answers awaited as is or after .order() (the library reads its rows oldest first).
const stubSupa = (tables) => ({ from: (t) => ({ select: () => {
  const res = Promise.resolve({ data: tables[t], error: null });
  return Object.assign(res, { order: async () => ({ data: tables[t], error: null }) });
} }) });

test('a board made for a post never counts as a library board made, but its slug and photos stay taken', async () => {
  const row = (slug, subject, extra = {}) => ({ slug, subject, page_path: null, made_at: '2026-10-30T06:00:00Z', credits: [{ id: `p:${slug}` }], phash: [`h-${slug}`], status: 'new', ...extra });
  const lib = await libraryState(stubSupa({
    showcase_boards: [row('costume-one', 'costume'), row('post-one', 'tiktok'), row('page-one', 'look-book', { page_path: '/tools/x' })],
    public_boards: [{ slug: 'public-one' }],
  }));
  assert.deepEqual(lib.made.map((m) => m.subject), ['costume']);
  assert.deepEqual(lib.taken, ['costume-one', 'post-one', 'page-one', 'public-one']);
  assert.ok(lib.used.ids.has('p:post-one'));
  assert.ok(lib.used.hashes.includes('h-post-one'));
});
