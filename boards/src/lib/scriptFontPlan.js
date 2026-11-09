// Which route a screenplay PDF takes, from the text it will draw. PURE.
//
// jsPDF's built-in Courier is the WinAnsi set. One character outside it turns
// the whole string into raw UTF-16 bytes (garbage in any viewer). So:
//   - everything WinAnsi            -> 'courier' (no font loaded)
//   - Latin-extended, Greek, Cyrillic, Vietnamese -> 'font' (Cousine, the
//     Courier New metric twin, fetched on export; same 10 cpi grid)
//   - Hebrew, Arabic and other RTL, CJK, Hangul, Thai, Indic, Armenian,
//     Georgian, emoji -> 'html' (the browser shapes, reorders and falls back
//     to system fonts; jsPDF can do none of that)

import { strongDirection } from './textDirection.js';

// The 27 cp1252 extras that sit outside Latin-1 (built by code point so no
// literal non-ASCII character lives in this file).
const WINANSI_EXTRA = String.fromCharCode(
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
);

export function isWinAnsi(s) {
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7e) continue;
    if (c >= 0xa0 && c <= 0xff) continue;
    if (WINANSI_EXTRA.indexOf(str[i]) !== -1) continue;
    // Tabs and newlines are flattened to spaces before drawing.
    if (c === 0x09 || c === 0x0a || c === 0x0d) continue;
    return false;
  }
  return true;
}

const RTL = /[\u{0590}-\u{08FF}\u{FB1D}-\u{FDFF}\u{FE70}-\u{FEFF}\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
const BEYOND = /[\u{0600}-\u{1CFF}\u{2E80}-\u{A63F}\u{A800}-\u{FAFF}\u{FE30}-\u{FE4F}\u{FF00}-\u{FFEF}\u{10000}-\u{10FFFF}]/u;

const TITLE_FIELDS = ['title', 'credit', 'authors', 'source', 'contact', 'copyright', 'draftDate', 'notes'];

// Every string the PDF will draw: each block as written and upper-cased (scene,
// character, transition and shot draw in capitals), plus the title page fields.
export function screenplayTexts(blocks, titlePage) {
  const out = [];
  for (const b of blocks || []) {
    const t = String(b?.text ?? '');
    out.push(t, t.toUpperCase());
  }
  if (titlePage && titlePage.enabled) {
    for (const f of TITLE_FIELDS) if (titlePage[f]) out.push(String(titlePage[f]));
  }
  return out;
}

export function screenplayPdfRoute(texts) {
  if (texts.every(isWinAnsi)) return 'courier';
  if (texts.some((t) => RTL.test(t) || BEYOND.test(t))) return 'html';
  return 'font';
}

// The distinct code points >= 0x20 that `has(cp)` says the font lacks.
export function missingGlyphs(texts, has) {
  const missing = new Set();
  for (const t of texts) {
    for (const ch of String(t)) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x20 && !has(cp)) missing.add(cp);
    }
  }
  return [...missing];
}

// The direction of a script: its first block with a strong letter.
export function screenplayDirection(blocks) {
  for (const b of blocks || []) {
    const d = strongDirection(String(b?.text ?? ''));
    if (d) return d;
  }
  return 'ltr';
}

export class ScreenplayNeedsHtml extends Error {
  constructor(message = 'This script needs the browser to typeset it') {
    super(message);
    this.name = 'ScreenplayNeedsHtml';
  }
}
