// pick.mjs — Claude chooses the photos, so a board's pictures belong together.
//
// A search's first hit is rarely the right one, and seventeen first hits from
// seventeen searches are seventeen different photographers' light: the grader
// turns that board down as "not one world". So before anything is downloaded
// at full size, every picture slot's first few candidates go onto contact
// sheets (one row per slot, a letter per candidate), and Claude picks, per
// slot, the ones that fit the board's look, best first. Only picked photos go
// on to aicheck; a slot with no pick stays empty and the board is built
// without it.

import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadImage } from '../lib/imageSources.mjs';

export const PICK = Object.freeze({
  perSlot: 6,       // candidates shown per slot
  rows: 6,          // slots per sheet
  cell: [300, 225], // a candidate's box
  label: 260,       // the slot's label column
  gap: 8,
  keep: 3,          // picks kept per slot, best first
});

export const LETTERS = 'abcdefgh';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Words wrapped to lines of about `n` characters. */
export function wrap(text, n, max = 6) {
  const lines = [];
  let line = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + w).length > n) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.slice(0, max);
}

function labelSvg(slot, w, h) {
  const lines = [`${slot.key} · ${slot.section}`, ...wrap(`"${slot.search}"`, 26, 4), ...(slot.caption ? wrap(`caption: ${slot.caption}`, 26, 2) : [])];
  const text = lines.map((l, i) => `<text x="10" y="${26 + i * 22}" font-family="Helvetica, Arial, sans-serif" font-size="${i ? 16 : 18}" font-weight="${i ? 400 : 700}" fill="#f2f0ea">${xml(l)}</text>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#26252a"/>${text}</svg>`);
}

function badgeSvg(letter) {
  const w = letter.length > 1 ? 44 : 34;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="34"><rect width="${w}" height="34" rx="6" fill="#111" fill-opacity="0.82"/><text x="${w / 2}" y="24" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="#fff">${xml(letter)}</text></svg>`);
}

/**
 * The contact sheets.
 *   slots: [{ key, section, search, caption?, cands: [{ id, thumb }] }]
 * → [{ file, keys }]  (cands without a thumb that loads are dropped from their slot)
 */
export async function contactSheets(slots, dir, { fetchThumb = async (url) => (await downloadImage(url)).bytes, log = () => {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const [cw, ch] = PICK.cell;
  const sheets = [];
  for (let s = 0; s < slots.length; s += PICK.rows) {
    const rows = slots.slice(s, s + PICK.rows);
    const width = PICK.label + PICK.perSlot * (cw + PICK.gap) + PICK.gap;
    const height = rows.length * (ch + PICK.gap) + PICK.gap;
    const layers = [];
    for (const [r, slot] of rows.entries()) {
      const top = PICK.gap + r * (ch + PICK.gap);
      layers.push({ input: labelSvg(slot, PICK.label - PICK.gap, ch), left: PICK.gap, top });
      const shown = [];
      for (const cand of slot.cands.slice(0, PICK.perSlot)) {
        try {
          const bytes = await fetchThumb(cand.thumb);
          const img = await sharp(bytes).rotate().resize(cw, ch, { fit: 'contain', background: '#18171b' }).jpeg().toBuffer();
          shown.push(cand);
          const left = PICK.label + (shown.length - 1) * (cw + PICK.gap);
          layers.push({ input: img, left, top }, { input: badgeSvg(LETTERS[shown.length - 1]), left: left + 6, top: top + 6 });
        } catch (e) { log(`pick: ${cand.id} preview: ${e.message}`); }
      }
      slot.shown = shown;
    }
    const file = join(dir, `sheet-${sheets.length + 1}.jpg`);
    await sharp({ create: { width, height, channels: 3, background: '#0f0f12' } }).composite(layers).jpeg({ quality: 82 }).toFile(file);
    sheets.push({ file, keys: rows.map((r) => r.key) });
  }
  return sheets;
}

export const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['look', 'picks'],
  properties: {
    look: { type: 'string' },
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'order'],
        properties: {
          slot: { type: 'string' },
          order: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

/** What the board is meant to look like, from its own palettes and notes. */
function lookOf(recipe) {
  const lines = [];
  for (const s of recipe.sections || []) {
    for (const it of s.items || []) {
      if (it.kind === 'palette') lines.push(`palette "${it.title || s.name}": ${(it.swatches || []).map((w) => `${w.name} ${w.hex}`).join(', ')}`);
      if (it.kind === 'note') lines.push(`note "${it.title}": ${String(it.body || '').replace(/\s+/g, ' ').slice(0, 280)}`);
    }
  }
  return lines;
}

export function pickPrompt(recipe, sheets, { notes = [] } = {}) {
  return [
    `Read these contact sheets: ${sheets.map((s) => s.file).join(', ')}.`,
    '',
    `They hold the candidate photos for one board in Clusters, a canvas app for film crews and creative teams.`,
    `The board is "${recipe.title}": ${recipe.story}`,
    'Each row is one picture on the board: its id and section, the search that found the photos, and its caption.',
    'The lettered photos to its right are the candidates.',
    '',
    'What the board says its look is:',
    ...lookOf(recipe).map((l) => `- ${l}`),
    ...(notes.length ? ['', 'A reviewer turned the last version of this board down for:', ...notes.map((n) => `- ${n}`)] : []),
    '',
    'Pick, for every row, the candidates that belong on this board, best first, at most three. The board is shown',
    'unedited as an example of a professional\'s working board, so the photos must read as ONE world: the same',
    'light, season, place, era and colour as the look above, as if from one shoot or one careful hunt. Leave a',
    'candidate out when it is: off that light or palette, a posed or smiling stock model, a generic stock look,',
    'over-saturated or HDR, an illustration, a 3D render or anything that looks AI-made, carrying any writing at all',
    '(graffiti, a sign, a shop name, a poster, a label, a logo, a watermark, words on clothing: even writing too small',
    'to read, since it is read at full size on the board), a studio product shot on a plain or white backdrop, sunshine or a landscape the look doesn\'t have',
    '(a forest on a harbour board), or the wrong subject for its row. A row where nothing fits gets an empty list:',
    'a board one picture short is better than one that clashes, so never settle for the least bad candidate.',
    'Never pick the same photo for two rows.',
    '',
    'look: one sentence on the light and colour you held the picks to.',
    'picks: one entry per row: slot is the row id exactly as written (e.g. "2.3"), order the letters, best first.',
  ].join('\n');
}

// ── side by side ─────────────────────────────────────────────────────────────
// Picked a row at a time, each photo is the best its search found; side by
// side, one can still be a river where the rest are a lido, or noon where the
// rest are dawn, and the grader turns the board down as "not one world". So
// every photo that passed goes onto one numbered sheet, Claude names the ones
// that break the world the rest share, and the board is built without them.

export const UNIFY = Object.freeze({ cols: 5, cell: [360, 270], gap: 8, most: 1 / 3, least: 4 });

export const UNIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['world', 'out'],
  properties: {
    world: { type: 'string' },
    out: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['n', 'why'], properties: { n: { type: 'integer' }, why: { type: 'string' } } },
    },
  },
};

/** What each numbered photo on the sheet is for: its section and its caption or search. */
function purposeOf(recipe, key) {
  const [si, ii] = key.split('.').map(Number);
  const s = recipe?.sections?.[si];
  const it = s?.items?.[ii];
  return `section "${s?.name || '?'}"${it?.kind === 'video' ? ', a video (its still)' : ''}: ${it?.caption ? `"${it.caption}", ` : ''}found by "${it?.search || '?'}"`;
}

export function unifyPrompt(recipe, file, keys) {
  const most = Math.floor(keys.length * UNIFY.most);
  return [
    `Read the image ${file}. It holds the ${keys.length} photos picked for one board in Clusters, a canvas app for`,
    `film crews and creative teams, numbered. The board is "${recipe.title}": ${recipe.story}`,
    '',
    'What the board says its look is:',
    ...lookOf(recipe).map((l) => `- ${l}`),
    '',
    'What each photo is for:',
    ...keys.map((k, i) => `${i + 1}. ${purposeOf(recipe, k)}`),
    '',
    'The board is shown unedited as an example of a professional\'s working board, so its photos must look like one',
    'shoot: the same light, season, place, era and colour. Each was the best its own search found; seen together, some',
    'may not belong. Name the ones that break the world the rest share, worst first: a different light or season, a',
    'different kind of place, a heavy colour grade or HDR, a generic stock look or a posed model, the wrong subject for',
    'what it is for (a river where it says a pool), or any writing in it (graffiti, a sign, a logo, a poster, words),',
    `readable or not. The board is built without the ones you name, so name only those a viewer would stop at: at most ${most}.`,
    'Naming none is a fine answer.',
    '',
    'world: one sentence on the light, place and colour the photos you keep share.',
    'out: the photos to leave out, worst first: n is the number on the sheet, why a few words.',
  ].join('\n');
}

/**
 * Claude's numbers → Map(key → why), at most a third of them, unknown numbers
 * and repeats dropped. floor { onBoard(key), keep, fixed(key) }: never fewer
 * than `keep` of the board's own pictures left (a sub-cluster's can still go),
 * and never a `fixed` one (a storyboard frame, numbered by the shot list).
 */
export function readUnify(answer, keys, log = () => {}, floor = null) {
  const out = new Map();
  const most = Math.floor(keys.length * UNIFY.most);
  let left = floor ? keys.filter(floor.onBoard).length : Infinity;
  for (const o of answer?.out || []) {
    const key = keys[Number(o?.n) - 1];
    if (!key || out.has(key) || out.size >= most) continue;
    if (floor?.fixed?.(key)) { log(`unify: ${key} kept, a storyboard frame`); continue; }
    const mine = floor?.onBoard(key);
    if (mine && left <= floor.keep) { log(`unify: ${key} kept, the board needs ${floor.keep} pictures`); continue; }
    if (mine) left -= 1;
    out.set(key, String(o.why || '').trim() || 'off the board\'s world');
  }
  if (answer?.world) log(`unify: ${answer.world}`);
  return out;
}

/**
 * The photos (and videos' stills) found for a board, side by side → Map(key →
 * why) of those to leave out. Fewer than UNIFY.least photos: nothing to
 * compare, nothing out. Throws when the call fails; the caller keeps them all.
 */
export async function unifyPhotos({ recipe, found, dir, claude, floor = null, log = () => {} }) {
  const items = [...found].filter(([, ph]) => !ph.media && ph.file);
  if (items.length < UNIFY.least) return new Map();
  mkdirSync(dir, { recursive: true });
  const [cw, ch] = UNIFY.cell;
  const rows = Math.ceil(items.length / UNIFY.cols);
  const layers = [];
  for (const [i, [, ph]] of items.entries()) {
    const left = UNIFY.gap + (i % UNIFY.cols) * (cw + UNIFY.gap);
    const top = UNIFY.gap + Math.floor(i / UNIFY.cols) * (ch + UNIFY.gap);
    const img = await sharp(ph.file).rotate().resize(cw, ch, { fit: 'contain', background: '#18171b' }).jpeg().toBuffer();
    layers.push({ input: img, left, top }, { input: badgeSvg(String(i + 1)), left: left + 6, top: top + 6 });
  }
  const file = join(dir, 'together.jpg');
  await sharp({ create: { width: UNIFY.cols * (cw + UNIFY.gap) + UNIFY.gap, height: rows * (ch + UNIFY.gap) + UNIFY.gap, channels: 3, background: '#0f0f12' } })
    .composite(layers).jpeg({ quality: 85 }).toFile(file);
  const keys = items.map(([k]) => k);
  const answer = await claude({
    prompt: unifyPrompt(recipe, file, keys), schema: UNIFY_SCHEMA, tools: ['Read'],
    model: 'opus', effort: 'medium', budgetUsd: 1, cwd: dir, log,
  });
  writeFileSync(join(dir, 'together.json'), JSON.stringify(answer, null, 2));
  return readUnify(answer, keys, log, floor);
}

/**
 * Claude's picks. → Map(slot key → [cand id, …] best first). Throws when the
 * call fails; the caller falls back to search order.
 */
export async function pickPhotos({ recipe, slots, dir, claude, notes = [], log = () => {}, fetchThumb }) {
  const live = slots.filter((s) => s.cands.length);
  if (!live.length) return new Map();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sheets = await contactSheets(live, dir, { fetchThumb, log });
  const answer = await claude({
    prompt: pickPrompt(recipe, sheets, { notes }), schema: PICK_SCHEMA, tools: ['Read'],
    model: 'opus', effort: 'medium', budgetUsd: 2, cwd: dir, log,
  });
  writeFileSync(join(dir, 'picks.json'), JSON.stringify(answer, null, 2));
  return readPicks(answer, live, log);
}

/** Claude's letters → candidate ids, dropping anything not on the sheet and any photo picked twice. */
export function readPicks(answer, slots, log = () => {}) {
  const byKey = new Map(slots.map((s) => [s.key, s]));
  const out = new Map();
  const seen = new Set();
  for (const p of answer?.picks || []) {
    const slot = byKey.get(String(p.slot).trim());
    if (!slot) continue;
    const ids = [];
    for (const l of p.order || []) {
      const cand = (slot.shown || slot.cands)[LETTERS.indexOf(String(l).trim().toLowerCase())];
      if (!cand || seen.has(cand.id)) continue;
      seen.add(cand.id);
      ids.push(cand.id);
      if (ids.length >= PICK.keep) break;
    }
    out.set(slot.key, ids);
  }
  for (const s of slots) if (!out.has(s.key)) out.set(s.key, []);
  if (answer?.look) log(`pick: ${answer.look}`);
  log(`pick: ${[...out.values()].filter((v) => v.length).length} of ${slots.length} picture(s) have a pick`);
  return out;
}
