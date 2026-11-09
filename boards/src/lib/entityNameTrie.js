// In-memory Trie of normalized entity names → entity records.
// Used by the auto-detect plugin and the @-mention picker.
//
// Records: { kind, id, name, boardId?, cardId?, docCardId? }
//
// Matches end at a word boundary: "we organized things" doesn't fire
// "organization". Word characters and boundaries come from tagWordMatch.js,
// the same rules the database uses for tags (0880), so a name in any script
// is found: "кино" not inside "кинотеатр", "東京" inside "東京駅で", "서울"
// in "서울에서". Names are keyed in NFC and, when different, in NFD too, so
// decomposed text (pasted from macOS file names) still matches at its own
// offsets.

import { isWordChar, isNoSpaceChar, edgeOk } from './tagWordMatch.js';

export function createNameIndex() {
  const root = node();
  let recordsCache = [];

  function add(record) {
    const keys = new Set([norm(record.name, 'NFC'), norm(record.name, 'NFD')]);
    let added = false;
    for (const key of keys) {
      if (!key) continue;
      let n = root;
      for (const ch of key) { n = n.children[ch] || (n.children[ch] = node()); }
      if (!n.records.find(r => sameRecord(r, record))) n.records.push(record);
      added = true;
    }
    if (added) recordsCache.push(record);
  }

  function clear() {
    root.children = {};
    root.records = [];
    recordsCache = [];
  }

  // Find the longest matching entity-name span starting at position `start`
  // in `text`. Match must end at a word boundary. Returns null on no match.
  // Offsets are UTF-16 indices into `text`, as before.
  function longestMatchAt(text, start) {
    let n = root;
    let bestEnd = -1;
    let bestRecords = null;
    let i = start;
    let first = null;
    let last = null;
    let count = 0;
    while (i < text.length) {
      const ch = cpAt(text, i);
      const k = norm1(ch);
      if (k == null) break;
      for (const kc of k) { n = n ? n.children[kc] : null; }
      if (!n) break;
      i += ch.length;
      if (first == null) first = ch;
      last = ch;
      count++;
      if (n.records.length && endsHere(text, start, i, first, last, count)) {
        bestEnd = i; bestRecords = n.records;
      }
    }
    if (bestEnd > start && bestRecords) {
      return { start, end: bestEnd, records: bestRecords };
    }
    return null;
  }

  // Iterate every match in a text range. Non-overlapping, longest-first.
  function* findMatches(text, fromIndex = 0, toIndex = text.length) {
    let i = fromIndex;
    while (i < toIndex) {
      while (i < toIndex && !isWordChar(cpAt(text, i))) i += cpAt(text, i).length;
      if (i >= toIndex) break;
      const m = longestMatchAt(text, i);
      if (m && m.end <= toIndex) { yield m; i = m.end; }
      else { i += cpAt(text, i).length; }
    }
  }

  return {
    add, clear, longestMatchAt, findMatches,
    get records() { return recordsCache; },
  };
}

function node() { return { children: {}, records: [] }; }
function cpAt(text, i) { return String.fromCodePoint(text.codePointAt(i)); }
function prevCp(text, i) {
  if (i <= 0) return '';
  const lo = text.charCodeAt(i - 1);
  const hiIdx = (lo >= 0xDC00 && lo <= 0xDFFF && i >= 2) ? i - 2 : i - 1;
  return cpAt(text, hiIdx);
}
// Final sigma folds to σ on both sides: "ΟΔΟΣ".toLowerCase() ends in ς while
// "Σ".toLowerCase() is σ, so a whole-name key and a per-character walk
// would never meet.
function fold(s) { return s.toLowerCase().replace(/ς/g, 'σ'); }
function norm(s, form) { return fold((s || '').normalize(form)).replace(/\s+/g, ' ').trim(); }
function norm1(ch) {
  // Word chars + spaces flatten to a single space in the Trie key.
  // Anything else (punctuation) breaks the match.
  if (isWordChar(ch)) return fold(ch);
  if (/\s/.test(ch)) return ' ';
  return null;
}
// Does a name read [start, end) end here? The right edge always follows the
// shared rule. The left edge is checked only for a name that starts with a
// non-ASCII character: findMatches retries at every position, and English
// names keep today's behaviour exactly. A one-character Han/Kana/Thai name
// must stand alone (no word character on either side).
function endsHere(text, start, end, first, last, count) {
  const next = end < text.length ? cpAt(text, end) : '';
  if (!edgeOk(last, next, 'right')) return false;
  if (first.charCodeAt(0) > 0x7f) {
    const prev = prevCp(text, clitics(text, start, first, count));
    if (!edgeOk(first, prev, 'left')) return false;
    if (count === 1 && isNoSpaceChar(first) && (isWordChar(prev) || isWordChar(next))) return false;
  }
  return true;
}
// Arabic and Hebrew names of 3+ letters may carry attached prefixes, as in
// _tag_slug_word_re: و/ف then ب/ل/ك for Arabic, up to two of ו ב ה ל מ ש כ
// for Hebrew. Returns where the word really starts.
function clitics(text, start, first, count) {
  if (count < 3) return start;
  let j = start;
  if (/[ؠ-ي]/.test(first)) {
    if (j > 0 && 'بلك'.includes(prevCp(text, j))) j -= 1;
    if (j > 0 && 'وف'.includes(prevCp(text, j))) j -= 1;
  } else if (/[א-ת]/.test(first)) {
    for (let k = 0; k < 2 && j > 0 && 'ובהלמשכ'.includes(prevCp(text, j)); k++) j -= 1;
  }
  return j;
}
function sameRecord(a, b) { return a.kind === b.kind && a.id === b.id; }
