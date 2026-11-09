// One fold for search, in JS and in SQL.
//
// public.search_fold(text) (0879) folds the stored text; this folds the query
// and in-memory names. The two must agree character for character, and both
// run the same fixture table (textFold.test.mjs reads the migration's DO
// block). Change a step here and in the migration together.
//
// Steps: NFKD; keep the breve on й and ў (distinct letters, not accents);
// drop combining marks (Latin and the other Western diacritic blocks, Hebrew
// points, Arabic harakat); NFC; map the letters NFKD leaves alone (ł ø đ ħ ı ð
// and ß æ œ þ). Kana voicing marks, Hangul, Indic and Thai marks stay: they
// change the word. Case is left to ILIKE (searchKey lowercases for memory).
//
// No regex lookbehind anywhere: old Safari can't parse it.

const BREVE_PROTECT = /([иИуУ])̆/g;
const MARKS = new RegExp(
  '[\\u0300-\\u036F\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20FF\\uFE20-\\uFE2F'
  + '\\u0591-\\u05BD\\u05BF\\u05C1\\u05C2\\u05C4\\u05C5\\u05C7'
  + '\\u064B-\\u065F\\u0670]', 'g');
const SINGLE = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ħ: 'h', Ħ: 'H', ı: 'i', ð: 'd', Ð: 'D' };
const MULTI = { ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', þ: 'th', Þ: 'TH' };
const MAPPED = /[łŁøØđĐħĦıðÐßẞæÆœŒþÞ]/g;

export function foldForSearch(s) {
  const t = String(s ?? '')
    .normalize('NFKD')
    .replace(BREVE_PROTECT, '$1')
    .replace(MARKS, '')
    .replace(//g, '̆')
    .normalize('NFC');
  return t.replace(MAPPED, (c) => SINGLE[c] ?? MULTI[c]);
}

// For in-memory comparisons: both sides through searchKey, then includes().
// JS lowercases a word-final Σ to ς, so "ΟΔΟΣ", "οδοσ" and "οδός" must meet on σ.
export function searchKey(s) {
  return foldForSearch(String(s ?? '').normalize('NFC')).toLowerCase().replace(/ς/g, 'σ');
}

// The query is cleaned of the characters that are SYNTAX in a PostgREST logic
// tree (`,` `(` `)` `"`, and `%` is ours to place).
export function cleanSearchTerm(query) {
  return String(query || '').normalize('NFC').replace(/[%,()"]/g, ' ').replace(/\s+/g, ' ').trim();
}

// The fold of a cleaned query, cleaned AGAIN: NFKD turns full-width ， （ ） ％ ＂
// and ⑴ into , ( ) % " and ( ), the syntax characters cleanSearchTerm strips,
// and they are everyday punctuation in Chinese and Japanese. '' when nothing
// is left.
export function foldedSearchTerm(q) {
  return cleanSearchTerm(foldForSearch(cleanSearchTerm(q)));
}

// The text folded one code point at a time, each folded unit remembering the
// raw offsets it came from, so a match in the folded text maps back onto the
// real words even where the fold changes lengths (ß -> ss).
export function foldedWithOffsets(s) {
  let folded = '';
  const from = [];
  const to = [];
  let at = 0;
  for (const ch of s) {
    const piece = searchKey(ch);
    for (let k = 0; k < piece.length; k++) { from.push(at); to.push(at + ch.length); }
    folded += piece;
    at += ch.length;
  }
  return { folded, from, to };
}

// Where the query first sits in the text, as UTF-16 offsets into the text
// exactly as passed, or null. Typed spelling first (punctuation included: the
// Worker matches "Act II (rev)" raw), then cleaned, then through the fold.
export function findFolded(text, query) {
  const raw = String(query ?? '').normalize('NFC').trim();
  const q = cleanSearchTerm(raw);
  if (!q) return null;
  const lower = text.toLowerCase();
  if (lower.length === text.length) {
    for (const t of raw === q ? [q] : [raw, q]) {
      // Measured lowered: İ lowercases to two units, and `lower` is aligned
      // with the text, so the match is as long as the lowered query.
      const lt = t.toLowerCase();
      const i = lower.indexOf(lt);
      if (i >= 0) return { start: i, end: i + lt.length };
    }
  }
  const fq = searchKey(foldedSearchTerm(q));
  if (!fq) return null;
  const m = foldedWithOffsets(text);
  const j = m.folded.indexOf(fq);
  if (j < 0) return null;
  return { start: m.from[j], end: m.to[j + fq.length - 1] };
}

// One character is a whole word in Chinese, Japanese and Korean, so a single
// Han, Hiragana, Katakana or Hangul character may be searched; everything
// else needs two. Counted in code points, never UTF-16 units.
const CJK_ONE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
export function minSearchLength(q) {
  const t = String(q ?? '').trim();
  return CJK_ONE.test(t) ? 1 : 2;
}

// Code points in the trimmed query (an emoji is 1, not 2).
export function searchLength(q) {
  return [...String(q ?? '').trim()].length;
}
