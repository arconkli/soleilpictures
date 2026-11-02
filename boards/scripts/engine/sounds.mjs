// sounds.mjs — a real sound for a board's audio card (the owner, 11-01: "add
// like video, maybe audio, grids, etc").
//
// The sound is searched on Wikimedia Commons, the free media library: field
// recordings, room tones, city and nature ambiences, old public-domain music.
// Only files anyone may reuse with a credit are taken (public domain, CC0,
// CC BY; never share-alike, non-commercial or no-derivatives), and the credit
// goes on the board's public page. A search matches words, not sounds ("city
// traffic" finds a police-scanner tape), so Claude picks the one that fits the
// board from what came back, by its title and description, or none. ffmpeg
// cuts it to a minute or so with a fade, as an .m4a every browser plays, and
// its waveform is drawn from the sound itself by the app's own computePeaks,
// the way an uploaded file's is (lib/audioAnalysis.js).

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { computePeaks, peaksToBase64 } from '../../src/lib/audioAnalysis.js';

const run = promisify(execFile);

export const SOUND = Object.freeze({
  minSec: 8, // shorter is a pronunciation clip or a one-shot
  maxSec: 1800, // longer is a lecture, a radio show or an audiobook chapter
  clipSec: 75, // what goes on the board: a minute and a bit, faded out
  fadeSec: 3,
  maxBytes: 80 * 1024 * 1024, // the original, before it's cut
  perSearch: 15,
  searches: [1, 3], // a recipe's searches for one sound
  searchWords: [1, 3],
});

const UA = 'SoleilBoardsEngine/1.0 (https://clusters.soleilpictures.com; boards engine)';
const API = 'https://commons.wikimedia.org/w/api.php';

/** A licence anyone may reuse with a credit: public domain, CC0, CC BY (no SA, NC or ND). */
export function licenceOk(name) {
  const s = String(name || '').trim().toLowerCase();
  if (!s) return false;
  if (/^(public domain|pd\b|pd-|cc0|cc-zero)/.test(s)) return true;
  return /^cc[ -]by(?:[ -]\d(?:\.\d)?)?$/.test(s);
}

const strip = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

// Spoken-word recordings that a sound search keeps finding: audiobooks, word
// pronunciations, interviews and talks. A board's sound is a place or a piece of music.
const SPOKEN = /librivox|pronunciation|^LL-Q\d|^(?:[a-z]{2,3}-){1,2}[^\s/]*\.(?:oga|ogg|wav|mp3)$|wikipedia|spoken|interview|lecture|podcast|speech|reading of|chapter \d/i;

/** One Commons search → the files a board could use. Pure over the API's JSON. */
export function readCommons(json) {
  const pages = Object.values(json?.query?.pages || {});
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out = [];
  for (const p of pages) {
    const ii = p?.imageinfo?.[0];
    if (!ii?.url) continue;
    const m = ii.extmetadata || {};
    const file = String(p.title || '').replace(/^File:/, '');
    const duration = Number(ii.duration) || 0;
    const licence = strip(m.LicenseShortName?.value);
    if (!/^(audio\/|application\/ogg)/.test(ii.mime || '')) continue;
    if (!licenceOk(licence)) continue;
    if (duration < SOUND.minSec || duration > SOUND.maxSec) continue;
    if ((ii.size || 0) > SOUND.maxBytes) continue;
    if (SPOKEN.test(file)) continue;
    out.push({
      id: `commons:${p.pageid}`, file, title: file.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
      url: ii.url, page: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
      mime: ii.mime, bytes: ii.size || 0, duration, licence,
      artist: strip(m.Artist?.value).slice(0, 80) || 'Unknown',
      description: strip(m.ImageDescription?.value).slice(0, 240),
    });
  }
  return out;
}

export async function searchCommonsAudio(query, { limit = SOUND.perSearch } = {}) {
  const u = new URL(API);
  const q = {
    action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:audio`, gsrnamespace: '6',
    gsrlimit: String(limit), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|Artist|ImageDescription',
  };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  return readCommons(await res.json());
}

// ── the pick ────────────────────────────────────────────────────────────────

export const SOUND_PICK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['picks', 'why'],
  properties: { picks: { type: 'array', items: { type: 'integer' } }, why: { type: 'string' } },
};

export function soundPickPrompt(recipe, item, cands) {
  return [
    'A board for a canvas app needs one real sound for its audio card. Pick the recordings below that fit the board,',
    'best first, or none.',
    '',
    `The board: ${recipe.title}. ${recipe.story || ''}`,
    `The card is called "${item.title}"${item.caption ? `: ${item.caption}` : ''}.`,
    '',
    'It must be a recording of a place, a sound or a piece of music that the card names or that belongs in the board\'s',
    'world. Never spoken word (an interview, a talk, a reading, a news or police tape), never a test tone, a',
    'pronunciation or a joke, never anything grim or out of place. A near fit that sounds right (a harbour for a',
    'fishing town, rain for a wet night, a slow piano for a quiet drama) beats an exact title that would not.',
    '',
    'The recordings (number, title, length, description):',
    ...cands.map((c, i) => `${i + 1}. "${c.title}" (${Math.round(c.duration)}s)${c.description ? ` — ${c.description}` : ''}`),
    '',
    'Answer { "picks": the numbers of up to three that fit, best first, or [] when none does, "why": a few words }.',
  ].join('\n');
}

// ── the file ────────────────────────────────────────────────────────────────

async function download(url, file) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > SOUND.maxBytes) throw new Error('too big');
  writeFileSync(file, buf);
}

/** The waveform of a sound file, as the card stores it (96 peaks, base64), drawn by the app's computePeaks. */
export async function peaksOf(file) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  const data = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
  if (!data.length) return null;
  return peaksToBase64(computePeaks(() => data, data.length, 1));
}

/** A cut of the sound for the board: at most clipSec, faded out, as AAC in .m4a. → { file, duration, peaks, bytes } */
export async function cutSound(src, out, duration) {
  const len = Math.min(SOUND.clipSec, duration || SOUND.clipSec);
  const fadeAt = Math.max(0, len - SOUND.fadeSec);
  await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-t', String(len),
    '-af', `afade=t=in:d=0.4,afade=t=out:st=${fadeAt}:d=${SOUND.fadeSec}`,
    '-ac', '2', '-ar', '44100', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  const peaks = await peaksOf(out);
  if (!peaks) throw new Error('no audio in it');
  return { file: out, duration: Math.round(len * 10) / 10, peaks, bytes: statSync(out).size };
}

/**
 * The sound for each audio item in the recipe.
 *   claude: claudeJson; dir: where files are kept
 * → { found: Map(key → sound), missing: [key] }
 *   sound: { file, duration, peaks, bytes, sha, id, credit: { name, source, licence, title, page } }
 */
export async function findSounds(recipe, { dir, claude, used = new Set(), log = () => {} }) {
  const found = new Map();
  const missing = [];
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const items = [];
  (recipe.sections || []).forEach((s, si) => (s.items || []).forEach((it, ii) => {
    if (it?.kind === 'audio') items.push({ it, key: `${si}.${ii}` });
  }));
  for (const { it, key } of items) {
    const seen = new Set(used);
    const cands = [];
    for (const q of (it.searches || []).slice(0, SOUND.searches[1])) {
      try {
        for (const c of await searchCommonsAudio(q)) if (!seen.has(c.id)) { seen.add(c.id); cands.push(c); }
      } catch (e) { log(`sound: search "${q}" failed (${e.message})`); }
    }
    if (!cands.length) { log(`sound: nothing free for "${it.title}"`); missing.push(key); continue; }
    const shown = cands.slice(0, 24);
    let order = [];
    try {
      const a = await claude({ prompt: soundPickPrompt(recipe, it, shown), schema: SOUND_PICK_SCHEMA,
        model: 'sonnet', effort: 'low', budgetUsd: 0.5, log });
      order = [...new Set((a?.picks || []).map(Number))].filter((n) => n >= 1 && n <= shown.length).slice(0, 3).map((n) => shown[n - 1]);
      log(`sound: "${it.title}" → ${order.length ? order.map((c) => `"${c.title}"`).join(', ') : 'none'} (${String(a?.why || '').slice(0, 80)})`);
    } catch (e) { log(`sound: pick failed (${e.message})`); }
    let sound = null;
    for (const c of order) {
      if (sound) break;
      try {
        const sha = createHash('sha1').update(c.id).digest('hex');
        const raw = join(dir, `${sha}.src`);
        if (!existsSync(raw)) await download(c.url, raw);
        const cut = await cutSound(raw, join(dir, `${sha}.m4a`), c.duration);
        sound = { media: 'sound', ...cut, sha: createHash('sha1').update(readFileSync(cut.file)).digest('hex'), id: c.id,
          credit: { name: c.artist, source: 'Wikimedia Commons', licence: c.licence, title: c.title, page: c.page, kind: 'sound' } };
      } catch (e) { log(`sound: "${c.title}" failed (${e.message})`); }
    }
    if (sound) found.set(key, sound); else missing.push(key);
  }
  return { found, missing };
}
