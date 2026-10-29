// The boards engine keeps a board even and buildable (scripts/engine/): every
// section is a column on the board, so no notes-only tower beside short
// picture columns, no lone picture, and a subject stock sites can't show is
// sent back to be rethought rather than built with holes in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecipe, recipePrompt, RULES } from '../../scripts/engine/recipe.mjs';
import { buildBoard } from '../../scripts/engine/build.mjs';
import { checkBoard, missingPhotos, CHECK } from '../../scripts/engine/check.mjs';
import { PAGES, MARKETING } from '../../scripts/engine/subjects.mjs';

const pic = (search) => ({ kind: 'picture', search });
const note = (title, body) => ({ kind: 'note', title, body });
const palette = { kind: 'palette', title: 'Palette', swatches: [
  { name: 'Night', hex: '#1d2a3a' }, { name: 'Lamp', hex: '#e8b04a' }, { name: 'Fog', hex: '#c9d1d6' }, { name: 'Rust', hex: '#8a4b2a' }] };

function sample() {
  return {
    title: 'Harbour Winter — Costume Board',
    slug: 'harbour-winter-costume-board',
    story: 'Costume reference for a winter drama in a working harbour town.',
    sections: [
      { name: 'Silhouettes', color: 'slate', items: [pic('fisherman oilskin coat'), pic('wool peacoat harbour'), pic('rain jacket dock winter')] },
      { name: 'Fabrics', color: 'clay', items: [pic('cable knit wool close'), pic('waxed cotton texture'), pic('oilskin fabric close'), palette] },
      { name: 'Characters', color: 'plum', items: [note('Mara', 'Skipper, 52. Same coat all film.'), pic('woman knit hat harbour'),
        note('Ed', 'Her brother. Borrowed clothes.'), pic('man rubber boots pier'), note('The buyers', 'City coats, wrong shoes.')] },
    ],
    seo: { title: 'Costume design mood board example', description: 'A costume design mood board for a winter harbour drama: silhouettes, fabrics and characters.',
      body: `A costume design mood board ${'word '.repeat(260)}`, keyword: 'costume design mood board' },
  };
}

const sectionProblems = (r) => validateRecipe(r).filter((x) => x.startsWith('section "'));

test('a balanced recipe has no section problems', () => {
  assert.deepEqual(sectionProblems(sample()), []);
});

test('four notes stacked in one section are refused, and so is a wall of text', () => {
  const r = sample();
  r.sections[2].items.push(note('Pip', 'The kid. Hand-me-downs.'));
  assert.match(sectionProblems(r).join('\n'), /"Characters" holds 4 notes; at most 3/);
  const t = sample();
  t.sections[2].items[0].body = 'x'.repeat(RULES.sectionText);
  assert.match(sectionProblems(t).join('\n'), /"Characters" holds \d+ characters of notes; at most 1200/);
});

test('a section of one or two pictures alone is refused; pictures beside a note are fine', () => {
  const r = sample();
  r.sections[0].items.pop();
  assert.match(sectionProblems(r).join('\n'), /"Silhouettes" is 2 pictures alone; a section of pictures holds at least 3/);
  const ok = sample();
  ok.sections[0].items = [pic('fisherman oilskin coat'), note('Shape', 'Long and heavy.')];
  assert.deepEqual(sectionProblems(ok), []);
});

test('the prompt asks for modern colour stock photos and even columns', () => {
  const p = recipePrompt({ brief: 'A costume board.' });
  assert.match(p, /modern colour photograph/);
  assert.match(p, /never\s+archival, sepia or black-and-white/);
  assert.match(p, /one column on the board/);
});

test('a section left with one card after missing photos is refused', () => {
  const r = sample();
  const found = new Map();
  r.sections.forEach((s, si) => s.items.forEach((it, ii) => {
    if (it.kind === 'picture' && !(si === 0 && ii > 0)) found.set(`${si}.${ii}`, { w: 2400, h: 1600, sha: `sha-${si}-${ii}`, id: `p:${si}${ii}` });
  }));
  let n = 0;
  const board = buildBoard(r, found, { newId: () => `id-${(n += 1)}`, now: '2026-10-29T12:00:00.000Z' });
  const photos = [...found].map(([key, ph]) => ({ key, sha: ph.sha, verdict: 'real', licence: 'Pexels' }));
  assert.ok(checkBoard(board, photos).includes(`section "Silhouettes" is left with 1 card (at least ${CHECK.sectionCards})`));
});

test('more than a few searches with no photo send the recipe back, naming them', () => {
  const r = sample();
  assert.deepEqual(missingPhotos(r, ['0.0', '0.1', '1.0']), []);
  const [why] = missingPhotos(r, ['0.0', '0.1', '1.0', '1.1']);
  assert.match(why, /^4 searches found no real photo/);
  assert.match(why, /"fisherman oilskin coat", "wool peacoat harbour", "cable knit wool close", "waxed cotton texture"/);
});

test('no brief asks for period dress stock sites cannot show', () => {
  for (const b of [...PAGES, ...MARKETING]) assert.doesNotMatch(b.brief, /\b1[5-8]\d0s\b|period drama|fresh period/i, b.page || b.subject);
});
