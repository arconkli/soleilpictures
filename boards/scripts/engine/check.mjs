// check.mjs — the strict check every engine board passes before anyone sees it
// (the owner, #70: "after that it runs automatically behind a strict check").
//
// Two halves. checkBoard is pure (check.test.mjs): the rules a board breaks or
// doesn't, from its cards alone. gradeShot asks Claude to look at the board's
// desktop shot against a written bar; a board under GRADE.pass gets one redo
// with Claude's notes, and is dropped if the redo falls short too.

export const CHECK = Object.freeze({
  pictures: 8,
  notes: 3,
  cards: [14, 45],
  shape: [1.0, 2.4], // the board's width over its height: no strips, no towers
  contrast: 4.5,
  ink: '#1c1c1e', // the dark ink the app sets on a tinted note
  sectionCards: 2, // a section left with one card after missing photos reads as broken
  missing: 3, // more searches than this with no photo that fits: rethink the subject
});

export const GRADE = Object.freeze({ pass: 4 });

/**
 * Too many searches came back with no photo that fits: the recipe asked for
 * things stock sites don't hold (the costume trial's 1890s dress). Named
 * search by search, so the next recipe can swap them. → [] or [problem]
 *   missing: ['si.ii', …] from findPhotos
 */
export function missingPhotos(recipe, missing = []) {
  if (missing.length <= CHECK.missing) return [];
  const search = (key) => {
    const [si, ii] = key.split('.').map(Number);
    return recipe?.sections?.[si]?.items?.[ii]?.search || key;
  };
  return [`${missing.length} searches found no real photo that fits (${missing.map((k) => `"${search(k)}"`).join(', ')}); `
    + 'swap them for places, objects, textures and light a stock site holds today, in one modern colour look'];
}

const isPicture = (c) => c.kind === 'image' || c.kind === 'video';

function luminance(hex) {
  const m = String(hex || '').match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const overlap = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

/**
 * board: { cards, groups }; photos: the found photos the cards use (each with
 * sha and verdict-passed). → problems[] ([] when the board passes).
 */
export function checkBoard({ cards = [], groups = [] } = {}, photos = []) {
  const p = [];
  const pics = cards.filter(isPicture);
  const notes = cards.filter((c) => c.kind === 'note');
  if (pics.length < CHECK.pictures) p.push(`only ${pics.length} pictures (at least ${CHECK.pictures})`);
  if (notes.length < CHECK.notes) p.push(`only ${notes.length} notes (at least ${CHECK.notes})`);
  if (!cards.some((c) => c.kind === 'palette')) p.push('no palette');
  if (cards.length < CHECK.cards[0] || cards.length > CHECK.cards[1]) p.push(`${cards.length} cards (${CHECK.cards[0]}–${CHECK.cards[1]})`);

  for (let i = 0; i < cards.length; i += 1) {
    const a = cards[i];
    if (![a.x, a.y, a.w, a.h].every(Number.isFinite) || a.w <= 0 || a.h <= 0) { p.push(`card ${i + 1} has no place or size`); continue; }
    for (let j = i + 1; j < cards.length; j += 1) {
      if (overlap(a, cards[j])) p.push(`cards ${i + 1} and ${j + 1} overlap`);
    }
  }

  if (cards.length) {
    const x0 = Math.min(...cards.map((c) => c.x));
    const y0 = Math.min(...cards.map((c) => c.y));
    const x1 = Math.max(...cards.map((c) => c.x + c.w));
    const y1 = Math.max(...cards.map((c) => c.y + c.h));
    const shape = (x1 - x0) / Math.max(1, y1 - y0);
    if (shape < CHECK.shape[0] || shape > CHECK.shape[1]) p.push(`the board is ${shape.toFixed(2)}:1 (${CHECK.shape[0]}–${CHECK.shape[1]})`);
  }

  for (const n of notes) {
    if (!n.bgColor || n.bgColor === 'transparent') continue;
    const k = contrast(n.bgColor, CHECK.ink);
    if (k != null && k < CHECK.contrast) p.push(`a note on ${n.bgColor} reads at ${k.toFixed(1)}:1 (at least ${CHECK.contrast})`);
  }

  const names = new Map(groups.map((g) => [g.id, String(g.name || '').trim()]));
  for (const g of groups) if (!names.get(g.id)) p.push('a section has no name');
  for (const c of cards) if (c.groupId && !names.has(c.groupId)) p.push('a card sits in a section that doesn\'t exist');
  for (const g of groups) {
    const held = cards.filter((c) => c.groupId === g.id).length;
    if (held < CHECK.sectionCards) p.push(`section "${names.get(g.id)}" is left with ${held} card${held === 1 ? '' : 's'} (at least ${CHECK.sectionCards})`);
  }

  const byKey = new Map(photos.map((ph) => [ph.key, ph]));
  const shas = new Set();
  for (const c of pics) {
    const ph = byKey.get(c.photo);
    if (!ph) { p.push('a picture has no checked photo behind it'); continue; }
    if (ph.verdict !== 'real') p.push(`a photo wasn't proven real (${ph.verdict})`);
    if (!ph.licence) p.push('a photo has no licence recorded');
    if (shas.has(ph.sha)) p.push('a photo is on the board twice');
    shas.add(ph.sha);
  }
  return [...new Set(p)];
}

export const GRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'summary', 'fixes'],
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 5 },
    summary: { type: 'string' },
    fixes: { type: 'array', items: { type: 'string' } },
  },
};

export function gradePrompt(file, recipe) {
  return [
    `Read the image ${file}. It is a screenshot of a board in Clusters, a canvas app for film crews and creative`,
    `teams. The board is "${recipe.title}": ${recipe.story}`,
    '',
    'It will be used, unedited, as an example on our website and in our ads. Grade it 1–5 against this bar:',
    '5: a board a working professional would be proud of: the photos belong together (one light, one world), each',
    '   section reads at a glance, the notes sound like a real person on a real project, nothing looks staged or stock.',
    '4: good enough to show; small things you would still change.',
    '3: fine but forgettable, or one thing that would embarrass us (a photo that doesn\'t fit, a cheesy stock look,',
    '   a note that sounds like marketing, a section that makes no sense).',
    '2 or 1: wrong subject, clashing photos, broken layout, text you can\'t read, or anything that looks AI-made.',
    '',
    'Be strict: most boards are a 3. summary: one sentence. fixes: up to 5 concrete changes that would raise it, each',
    'naming the card or section ("swap the beach photo in Locations for one at dusk"; "cut the second palette").',
  ].join('\n');
}

/** Claude's grade of a shot. claude: claudeJson; cwd: the folder holding `file`. */
export async function gradeShot(file, recipe, { claude, cwd, log = () => {} }) {
  return claude({
    prompt: gradePrompt(file, recipe), schema: GRADE_SCHEMA, tools: ['Read'],
    model: 'opus', effort: 'medium', budgetUsd: 1.5, cwd, log,
  });
}
