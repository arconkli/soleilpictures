// joiners.js — which zero-width joiners a typed name may keep.
//
// ZWNJ (U+200C), ZWJ (U+200D) and VS16 (U+FE0F) are invisible, and the names
// we mail or show (workspace names, team names) used to lose all of them. But
// Persian ("project-s" needs a ZWNJ before the plural), Hindi, Bengali and
// Malayalam spell with them, and an emoji family or flag is a ZWJ sequence.
// So one survives only in place: between two letters of a joining script,
// after a virama, or inside an emoji sequence. Anywhere else it is stray.
//
// Same rules as supabase/functions/_shared/email/safeLabel.mjs (keepInvisible),
// which keeps its own copy because it is deployed alone with the edge
// function; joiners.test.mjs pins the two lists together. Emoji are judged here by
// the browser's own Unicode tables, while the email copy pins Unicode 17's
// (emojiSets.mjs), so after a symbol Unicode 17 stopped counting as an emoji,
// such as U+2605, a VS16 the app keeps may still be dropped from an email. Pure: no React, no
// Supabase. The special characters are built from code points, never written
// as escapes, so no tool rewrites them into the invisible characters.

// Scripts that spell with ZWNJ/ZWJ between letters (Arabic, Indic, Myanmar,
// Khmer, Mongolian and their extensions).
export const JOINING_SCRIPTS = [
  [0x0600, 0x06ff], [0x0700, 0x074f], [0x0750, 0x077f], [0x07c0, 0x07ff], [0x0870, 0x08ff],
  [0x0900, 0x0dff], [0x1000, 0x109f], [0x1780, 0x17ff], [0x1800, 0x18af], [0x1cd0, 0x1cff],
  [0xa8e0, 0xa8ff], [0xa9e0, 0xa9ff], [0xaa60, 0xaa7f], [0xfb50, 0xfdff], [0xfe70, 0xfefc],
];
export const VIRAMAS = new Set([0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d4d, 0x0dca, 0x1039, 0x103a, 0x17d2]);

const ZWNJ = 0x200c, ZWJ = 0x200d, VS16 = 0xfe0f, KEYCAP = 0x20e3;
// Built at run time: a literal with a property the engine lacks fails the whole chunk.
const PICTO = (() => {
  try { return new RegExp('\\p{Extended_Pictographic}', 'u'); } catch {
    return new RegExp('[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}]', 'u');
  }
})();
// Emoji_Modifier is exactly the five skin tones, U+1F3FB to U+1F3FF.
const MODIFIER = new RegExp('[\\u{1F3FB}-\\u{1F3FF}]', 'u');

const joining = (ch) => {
  if (!ch) return false;
  const c = ch.codePointAt(0);
  return JOINING_SCRIPTS.some(([a, b]) => c >= a && c <= b);
};

// Whether the joiner `c` (a code point) stays, given the characters (strings)
// around it: `prev`, the one before that (`prev2`) and `next`.
export function keepsInvisible(c, prev, prev2, next) {
  const script = !!prev && joining(prev) && (joining(next) || VIRAMAS.has(prev.codePointAt(0)));
  if (c === ZWNJ) return script;
  if (c === ZWJ) {
    if (script) return true;
    const emojiBefore = !!prev && (PICTO.test(prev) || MODIFIER.test(prev) || (prev.codePointAt(0) === VS16 && !!prev2 && PICTO.test(prev2)));
    return emojiBefore && !!next && PICTO.test(next);
  }
  if (c === VS16) return !!prev && (PICTO.test(prev) || (/^[0-9#*]$/.test(prev) && !!next && next.codePointAt(0) === KEYCAP));
  return false;
}

// `s` with each stray ZWNJ, ZWJ and VS16 replaced by `withText` ('' drops it).
export function dropStrayJoiners(s, withText = '') {
  const chars = [...String(s ?? '')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i].codePointAt(0);
    if ((c === ZWNJ || c === ZWJ || c === VS16) && !keepsInvisible(c, chars[i - 1], chars[i - 2], chars[i + 1])) out += withText;
    else out += chars[i];
  }
  return out;
}
