// Tempo and musical key for audio cards, parsed from the FILENAME.
//
// Sample and loop packs are named by machine — `SFL_120_Gmin_Loop_Piano.wav`,
// `Cymatics - Orchid Kick 3 - 140 BPM.wav` — so the filename is not a heuristic
// here, it is metadata that the exporter wrote down. Parsing it is close to
// free and close to exact on real packs.
//
// What this deliberately does NOT do is infer either value from the audio.
//
//   • Key detection needs an FFT, a chroma vector and a Krumhansl-Schmuckler
//     correlation, and it is structurally unreliable on exactly this content:
//     a kick loop has no key, and a hi-hat loop will confidently report one.
//   • Tempo from loop length looks like arithmetic rather than DSP — a loop is
//     an exact bar count, so bpm = bars * 240 / duration — but run the numbers
//     on the acceptance test and roughly a third of ARBITRARY durations land
//     within a plausible tolerance of an integer BPM at one of the common bar
//     counts. It is a coin flip wearing a lab coat.
//
// A wrong BPM is worse than a blank one, because a producer will trust it and
// time-stretch to it. Blank means "type it in"; wrong means a track that
// drifts. So: what the filename says, or nothing, or what the user typed.

// Anything outside this is not a tempo someone is looking for in a loop
// browser, and the range is what lets us reject sample rates and bit depths.
const BPM_MIN = 60;
const BPM_MAX = 200;

const MODE_MIN = 'min';
const MODE_MAJ = 'maj';

// Strip the extension and split on every separator a pack name uses.
function tokenize(name) {
  const base = String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  return base.split(/[\s_\-–—.,()[\]{}]+/).filter(Boolean);
}

export function extensionOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : null;
}

// ── BPM ─────────────────────────────────────────────────────────────────────

// An explicit "140 BPM" / "bpm140" beats everything else in the name.
function explicitBpm(name) {
  const s = String(name || '');
  const m = /(\d{2,3})\s*bpm\b/i.exec(s) || /\bbpm\s*[-_ ]?(\d{2,3})/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= BPM_MIN && n <= BPM_MAX ? n : null;
}

// Failing that, a standalone 2-3 digit number in range — but ONLY if the name
// contains exactly one such candidate. Two numbers is ambiguous, and guessing
// between them is how you get a confidently wrong tempo.
//
// Excluded by construction: 4+ digit runs (44100, a year), anything under 60
// (24bit, 16bit, 48k, a track number), and anything immediately followed by a
// unit — 96kHz would otherwise read as 96 BPM.
function standaloneBpm(name) {
  const base = String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  const candidates = [];
  const re = /(\d+)\s*([a-z%]*)/gi;
  let m;
  while ((m = re.exec(base))) {
    const digits = m[1];
    const suffix = (m[2] || '').toLowerCase();
    if (digits.length < 2 || digits.length > 3) continue;
    if (/^(k|khz|hz|bit|bits|db|ms|s|sec|secs|x)/.test(suffix)) continue;
    const n = Number(digits);
    if (n >= BPM_MIN && n <= BPM_MAX) candidates.push(n);
  }
  if (candidates.length !== 1) return null;
  return candidates[0];
}

export function parseBpm(name) {
  return explicitBpm(name) ?? standaloneBpm(name);
}

// ── Key ─────────────────────────────────────────────────────────────────────

const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function normalizeAccidental(a) {
  if (a === '♯') return '#';
  if (a === '♭') return 'b';
  return a || '';
}

function normalizeMode(m) {
  if (!m) return '';
  const s = m.toLowerCase();
  if (s === 'm' || s === 'min' || s === 'minor') return MODE_MIN;
  if (s === 'maj' || s === 'major') return MODE_MAJ;
  return '';
}

// One token → canonical key, or null.
//
// The load-bearing rule is that a bare note letter is REFUSED. "A" matches the
// English article and every "Take A" / "Drum A" in a pack, so a token has to
// carry either an accidental or a mode to count. And a fully lowercase token
// needs a spelled-out mode, because "am" is a word and "Am" is a chord.
// `typed: true` relaxes both rules. They exist to stop a filename's prose from
// being read as a key; a value typed into a field labelled Key has no prose
// around it to be confused with, so "c" and "am" mean what they say there.
function matchKeyToken(tok, { typed = false } = {}) {
  // The trailing letters are captured loosely and validated by normalizeMode
  // rather than alternated in the pattern: a case-insensitive alternation
  // cannot be used here because the `b` in the accidental class would also
  // match an uppercase B, and "AMIN" has to parse.
  const m = /^([A-Ga-g])([#b♯♭]?)([A-Za-z]*)\d?$/.exec(String(tok || ''));
  if (!m) return null;
  const letter = m[1];
  const accidental = normalizeAccidental(m[2]);
  const mode = normalizeMode(m[3]);
  if (m[3] && !mode) return null;   // trailing letters that aren't a mode

  if (!typed) {
    if (!accidental && !mode) return null;                 // bare "A" / "C"
    const upper = letter === letter.toUpperCase();
    const spelledMode = m[3] && m[3].length >= 3;
    if (!upper && !accidental && !spelledMode) return null; // "am" the word
  }
  return `${letter.toUpperCase()}${accidental}${mode}`;
}

export function parseKey(name) {
  const toks = tokenize(name);
  for (let i = 0; i < toks.length; i++) {
    const direct = matchKeyToken(toks[i]);
    if (direct) return direct;
    // "A min" / "F# major" — the separator split them apart.
    const bare = /^([A-G])([#b♯♭]?)$/.exec(toks[i]);
    const next = normalizeMode(toks[i + 1]);
    if (bare && next && /^(maj|major|min|minor)$/i.test(toks[i + 1] || '')) {
      return `${bare[1]}${normalizeAccidental(bare[2])}${next}`;
    }
  }
  return null;
}

// Accept whatever a person types in the card's key field and land it on the
// same canonical form the filename parser produces, so "am", "A min" and
// "Amin" are one value and sort together.
export function canonicalKey(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const direct = matchKeyToken(s.replace(/\s+/g, ''), { typed: true });
  if (direct) return direct;
  return parseKey(s);
}

// 'Bbmaj' → 'B♭ maj'. Proper accidental glyphs, and the mode spaced off so the
// tonic stays scannable down a column.
export function formatKey(key) {
  const m = /^([A-G])([#b]?)(min|maj)?$/.exec(String(key || ''));
  if (!m) return '';
  const acc = m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : '';
  return `${m[1]}${acc}${m[3] ? ` ${m[3]}` : ''}`;
}

// Sort position: circle of fifths by tonic, then mode.
//
// Alphabetical is the wrong answer for a key column. A producer sorting by key
// is asking "what can I stack with what", and the circle of fifths is that
// question's axis — it puts A, E and D next to each other instead of A, B, C.
export function keyOrder(key) {
  const m = /^([A-G])([#b]?)(min|maj)?$/.exec(String(key || ''));
  if (!m) return null;
  let pc = PITCH_CLASS[m[1]];
  if (pc == null) return null;
  if (m[2] === '#') pc = (pc + 1) % 12;
  if (m[2] === 'b') pc = (pc + 11) % 12;
  const fifths = (pc * 7) % 12;
  const modeRank = m[3] === MODE_MAJ ? 1 : m[3] === MODE_MIN ? 2 : 0;
  return fifths * 4 + modeRank;
}

// ── Assembly ────────────────────────────────────────────────────────────────

// Everything derivable from a filename, in one call for the ingest paths.
export function parseLoopMeta(name) {
  const bpm = parseBpm(name);
  const musicalKey = parseKey(name);
  return {
    bpm,
    musicalKey,
    // Only claim a source when something was actually found — an empty
    // metaSource is what lets a later pass fill these in without overwriting
    // anything a person typed.
    metaSource: (bpm != null || musicalKey) ? 'name' : null,
  };
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// The format label shown in the list and under the card title. Prefers the
// stored extension, falls back to the mime, then to the R2 key's own suffix —
// which is how cards from before ext/fileName existed still show WAV.
export function formatLabel({ ext = null, mime = null, src = null } = {}) {
  if (ext) return String(ext).toUpperCase();
  if (mime) {
    const m = /^audio\/(?:x-)?([a-z0-9.+-]+)$/i.exec(String(mime));
    if (m) {
      const sub = m[1].toLowerCase();
      const map = { mpeg: 'MP3', mp3: 'MP3', 'vnd.wave': 'WAV', wave: 'WAV', wav: 'WAV',
                    mp4: 'M4A', m4a: 'M4A', aiff: 'AIFF', aif: 'AIFF', flac: 'FLAC',
                    ogg: 'OGG', opus: 'OPUS', aac: 'AAC', webm: 'WEBA' };
      return map[sub] || sub.toUpperCase();
    }
  }
  const key = String(src || '').replace(/^r2:/, '');
  const e = extensionOf(key);
  return e ? e.toUpperCase() : '';
}

// "0:02 · 128 · A♯ min · WAV" — the one line that makes a gallery tile and a
// list row legible without any new columns. Segments that are unknown are
// dropped rather than rendered empty.
export function audioMetaLine({ duration = null, bpm = null, musicalKey = null, format = '' } = {}) {
  const parts = [];
  const d = formatDuration(duration);
  if (d) parts.push(d);
  if (bpm != null && Number.isFinite(bpm)) parts.push(String(bpm));
  const k = formatKey(musicalKey);
  if (k) parts.push(k);
  if (format) parts.push(format);
  return parts.join(' · ');
}
