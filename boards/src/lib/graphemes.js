// Grapheme-safe string helpers: initials and cut-off previews.
//
// A "letter" a person sees can be several code points (a Hindi conjunct, an
// accented letter typed as two code points, an emoji family or flag, a Korean
// name typed as jamo). s[0], charAt(0) and slice(0, n) cut those apart. These
// helpers cut on grapheme boundaries instead. Plain ASCII takes a fast path and
// gives exactly what s[0] / slice() gave before.
//
// Pure, no imports: safe for the Worker and the app.

const SEG = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
// Tab and line feed are one grapheme each; \r is left out because \r\n is one.
const ASCII = /^[\t\n\x20-\x7e]*$/;
// Without Intl.Segmenter: marks, ZWNJ, ZWJ, variation selector 16, skin tones and
// tag characters join the unit before them.
const MARKISH = /[\p{M}\u{200c}\u{200d}\u{fe0f}\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u;
const LETTERISH = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{N}]/u;

export function graphemes(s) {
  const str = String(s ?? '');
  if (ASCII.test(str)) return str.split('');
  if (SEG) return Array.from(SEG.segment(str), (x) => x.segment);
  const out = [];
  for (const ch of str) {
    if (out.length && MARKISH.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

export function graphemeCount(s) {
  const str = String(s ?? '');
  if (ASCII.test(str)) return str.length;
  return graphemes(str).length;
}

export function firstGrapheme(s) {
  const str = String(s ?? '');
  if (!str) return '';
  if (str.charCodeAt(0) < 0x80 && (str.length === 1 || str.charCodeAt(1) < 0x80)) return str[0];
  if (SEG) { for (const g of SEG.segment(str)) return g.segment; }
  return graphemes(str)[0] || '';
}

// The first n graphemes, joined. Stops after n segments, so a short cut of a
// huge text does not segment all of it.
export function cutGraphemes(s, n) {
  const str = String(s ?? '');
  const k = Math.max(0, n);
  if (str.length <= k) return str;
  if (ASCII.test(str)) return str.slice(0, k);
  return takeGraphemes(str, k).join('');
}

// The first k graphemes as an array, reading no further than they need.
function takeGraphemes(str, k) {
  const out = [];
  if (k <= 0) return out;
  if (SEG) {
    for (const x of SEG.segment(str)) {
      out.push(x.segment);
      if (out.length >= k) break;
    }
    return out;
  }
  for (const ch of str) {
    if (out.length && MARKISH.test(ch)) out[out.length - 1] += ch;
    else if (out.length >= k) break;
    else out.push(ch);
  }
  return out;
}

// True when s has more than n graphemes. Stops at segment n + 1.
export function exceedsGraphemes(s, n) {
  const str = String(s ?? '');
  if (str.length <= n) return false;
  if (ASCII.test(str)) return str.length > n;
  return takeGraphemes(str, n + 1).length > n;
}

export function dropLastGrapheme(s) {
  const str = String(s ?? '');
  if (ASCII.test(str)) return str.slice(0, -1);
  return graphemes(str).slice(0, -1).join('');
}

// s when it has at most max graphemes, else the first max - 1 and the ellipsis.
export function truncate(s, max, ell = '…') {
  const str = String(s ?? '');
  if (str.length <= max) return str;
  if (ASCII.test(str)) return str.slice(0, Math.max(0, max - 1)) + ell;
  const gs = takeGraphemes(str, max + 1);
  if (gs.length <= max) return str;
  return gs.slice(0, Math.max(0, max - 1)).join('') + ell;
}

// Uppercase only when the code-point count is kept (the sharp s stays itself).
function upperKeep(g) {
  const u = g.toUpperCase();
  return [...u].length === [...g].length ? u : g;
}

// Each word loses its leading invisible characters, punctuation and marks
// ("Bob" in quotes, a right-to-left mark, a guillemet); words left empty go.
const LEADING_JUNK = /^[\p{Cf}\p{P}\p{M}]+/u;
function wordsOf(name) {
  return String(name ?? '').trim().split(/\s+/u).map((w) => w.replace(LEADING_JUNK, '')).filter(Boolean);
}

export function initialOf(name, fallback = '?', { upper = true } = {}) {
  const g = firstGrapheme(wordsOf(name)[0] || '');
  if (!g) return fallback;
  return upper ? upperKeep(g) : g;
}

// Up to two initials from the first two words. A second initial joins only when
// both are ASCII or both are letters of a script that writes initials in pairs.
export function initialsOf(name, fallback = '?') {
  const words = wordsOf(name);
  if (!words.length) return fallback;
  const a = firstGrapheme(words[0]);
  if (words.length === 1) return upperKeep(a) || fallback;
  const b = firstGrapheme(words[1]);
  const bothAscii = a.length === 1 && b.length === 1 && a.charCodeAt(0) < 0x80 && b.charCodeAt(0) < 0x80;
  if (bothAscii || (LETTERISH.test(a) && LETTERISH.test(b))) return upperKeep(a) + upperKeep(b);
  return upperKeep(a) || fallback;
}
