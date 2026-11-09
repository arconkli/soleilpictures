// tagWordMatch — where a tag's name counts as a word in text, in any script.
// Mirrors public._tag_slug_word_re and public._tag_is_spreadable (migration
// 0880); change one, change the other. tagWordMatch.test.mjs runs the same
// fixtures as 0880's proof block.
//
// Word characters: letters, digits and combining marks (so "हिन्दी" and
// "ภาพยนตร์" stay one word). Edges of a name:
//   * Han, Kana, Thai, Lao, Myanmar, Khmer (no spaces between words): no
//     boundary needed on that side.
//   * Hangul: a boundary on the left, none on the right (particles attach).
//   * anything else: the neighbour is not a word character, or is one of
//     the scripts above.
//   * Arabic (3+ letters): one optional و/ف then one optional ب/ل/ك before it.
//     Hebrew (3+ letters): up to two of ו ב ה ל מ ש כ.
// On ASCII text every answer is the same as the old [^a-z0-9] rule.

const W = '\\p{L}\\p{N}\\p{M}\\u200C\\u200D';
const NS = '\\u0E00-\\u0EFF\\u1000-\\u109F\\u1780-\\u17FF\\u3040-\\u30FF\\u31F0-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF66-\\uFF9F\\u{20000}-\\u{3134F}';
const HG = '\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7AF';
const SHORT = '\\u30A1-\\u30FA\\u30FC\\u31F0-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF66-\\uFF9F\\u{20000}-\\u{3134F}' + HG;

const WORD_RE = new RegExp(`[${W}]`, 'u');
const NOSPACE_RE = new RegExp(`[${NS}]`, 'u');
const HANGUL_RE = new RegExp(`[${HG}]`, 'u');
const SHORT_OK_RE = new RegExp(`^[${SHORT}]{2}$`, 'u');
const ARABIC_RE = /^[ؠ-ي]/u;
const HEBREW_RE = /^[א-ת]/u;

// One character (a code point) at a time.
export const isWordChar = (ch) => !!ch && WORD_RE.test(ch);
export const isNoSpaceChar = (ch) => !!ch && NOSPACE_RE.test(ch);
export const isHangulChar = (ch) => !!ch && HANGUL_RE.test(ch);

// A name written only in Han, Kana, Thai-family or Hangul characters.
export const isCompactScriptName = (s) => {
  const chars = [...String(s || '')];
  return chars.length > 0 && chars.every((c) => isNoSpaceChar(c) || isHangulChar(c));
};

// A neighbour that ends a word for an edge character of a name.
//   edge: the name's first (side 'left') or last (side 'right') character.
// Returns true when no boundary is needed or `next` is one.
export function edgeOk(edge, next, side) {
  if (isNoSpaceChar(edge)) return true;
  if (isHangulChar(edge)) {
    if (side === 'right') return true;
    return !next || !isWordChar(next) || isNoSpaceChar(next);
  }
  return !next || !isWordChar(next) || isNoSpaceChar(next) || isHangulChar(next);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The regex for a lowercased slug, matched against lowercased text: the JS
// twin of public._tag_slug_word_re.
export function slugWordRegex(slug) {
  const s = String(slug || '').toLowerCase();
  const chars = [...s];
  const first = chars[0] || '';
  const last = chars[chars.length - 1] || '';
  const left = isNoSpaceChar(first) ? ''
    : isHangulChar(first) ? `(?:^|[^${W}]|[${NS}])`
    : `(?:^|[^${W}]|[${NS}${HG}])`;
  const prefix = chars.length >= 3 && ARABIC_RE.test(first) ? '[\\u0648\\u0641]?[\\u0628\\u0644\\u0643]?'
    : chars.length >= 3 && HEBREW_RE.test(first) ? '[\\u05D5\\u05D1\\u05D4\\u05DC\\u05DE\\u05E9\\u05DB]{0,2}'
    : '';
  const right = (isNoSpaceChar(last) || isHangulChar(last)) ? '' : `(?:$|[^${W}]|[${NS}${HG}])`;
  return new RegExp(left + prefix + escapeRe(s) + right, 'u');
}

// A slug of exactly two Han, Katakana or Hangul characters may spread; every
// other slug needs three characters (code points). The JS twin of the length
// half of public._tag_is_spreadable.
export function longEnoughToSpread(slug) {
  const s = String(slug || '');
  return [...s].length >= 3 || SHORT_OK_RE.test(s);
}
