// The boards engine's pure parts (scripts/engine/): the recipe's rules, the
// layout a recipe and its photos become, and the strict check every board
// passes before anyone sees it. The parts that reach out (Claude, Pexels,
// aicheck, the camera, R2, the database) are run by scripts/engine/run.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecipe, RULES } from '../../scripts/engine/recipe.mjs';
import { buildBoard, withSources, stripBuild, SCRIPT_FONT } from '../../scripts/engine/build.mjs';
import { checkBoard, contrast, CHECK } from '../../scripts/engine/check.mjs';
import { PAGES, LATER_PAGES, MARKETING, nextMarketing, pageBrief } from '../../scripts/engine/subjects.mjs';
import { hamming, isDup } from '../../scripts/engine/photos.mjs';

const pic = (search, caption) => ({ kind: 'picture', search, ...(caption ? { caption } : {}) });
const palette = { kind: 'palette', title: 'Palette', swatches: [
  { name: 'Night', hex: '#1d2a3a' }, { name: 'Lamp', hex: '#e8b04a' }, { name: 'Fog', hex: '#c9d1d6' }, { name: 'Rust', hex: '#8a4b2a' }] };

function sample() {
  return {
    title: 'The Lighthouse Keeper',
    slug: 'lighthouse-keeper-treatment',
    story: 'A short film about the last keeper on a northern rock.',
    sections: [
      { name: 'Look', color: 'slate', items: [pic('lighthouse storm night'), pic('foggy rocky coast'), pic('old lantern room'),
        pic('waves crashing rocks'), { kind: 'note', title: 'Light', body: 'Cold blue nights, one warm lamp.' }] },
      { name: 'Keeper', color: 'clay', items: [pic('old man wool sweater', 'Tom, 68'), pic('weathered hands rope'), pic('kettle on stove'),
        { kind: 'note', title: 'Who he is', body: 'He has kept the light for forty years.' }, palette] },
      { name: 'Script', color: 'plum', items: [
        { kind: 'note', title: 'Page 1', body: 'INT. LANTERN ROOM - NIGHT\n\nTOM winds the clockwork. Outside, nothing but weather.', font: 'script' },
        pic('ship lights at sea'), pic('stone stairs spiral'), pic('logbook handwriting old')] },
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
  assert.ok(validateRecipe(noScript, { wants: ['script'] }).some((x) => /script excerpt/.test(x)));
  assert.ok(validateRecipe(sample(), { wants: ['frames'] }).some((x) => /storyboard/.test(x)));
  const video = sample();
  video.sections[0].items[0] = { kind: 'video', search: 'lighthouse beam turning' };
  assert.ok(validateRecipe(video, {}).some((x) => /no video/.test(x)));
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

test('a script excerpt is set in Courier Prime and pushes the cards under it down', () => {
  const { board } = build();
  const script = board.cards.find((c) => c.fontFamily === SCRIPT_FONT);
  assert.ok(script);
  const below = board.cards.filter((c) => c !== script && c.x < script.x + script.w && c.x + c.w > script.x && c.y > script.y);
  assert.ok(below.length);
  assert.ok(below.every((c) => c.y >= script.y + script.h), 'nothing under the script note is covered by it');
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
