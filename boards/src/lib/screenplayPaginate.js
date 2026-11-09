// Pure, line-accurate screenplay paginator. NO Tiptap imports — fully
// unit-testable and shared by the on-screen decoration plugin AND the PDF/print
// builder, so on-screen pages == exported pages.
//
// Geometry comes from screenplayMetrics.js (the single source of truth shared
// with the on-screen CSS + print shell): Courier 12pt, 10 cpi, a 60-char text
// block, PAGE_LINES lines/page. Each element has a fixed wrap width and a
// conventional spacing-before (blank lines).
//
// Break rules implemented:
//   - never orphan a scene heading at the bottom of a page
//   - split a long dialogue/action block across pages; dialogue splits add
//     (MORE) at the bottom and CHARACTER (CONT'D) at the top of the next page;
//     never strand <2 lines on either side
//   - keep a parenthetical with the dialogue that follows it

import {
  PAGE_LINES, MIN_SPLIT, ELEMENT_WIDTH, elementWidth, elementSpacing, dualElementWidth,
} from './screenplayMetrics.js';
import { computeAutoContd, characterCueDisplay } from '../components/docExtensions/screenplay/screenplayFlow.js';

export { PAGE_LINES, ELEMENT_WIDTH };

// A CJK glyph (and a wide emoji) is 1em across; a Courier column is 0.6em, so
// one wide character fills 1 / 0.6 = 5/3 columns.
export const WIDE = 5 / 3;
// Sums of 5/3 are not exact in floating point (21 * 5/3 = 35.000000000000004),
// so a line that fits exactly is compared with this slack.
const COL_EPS = 1e-9;

const ZERO_COL = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
const WIDE_SCRIPT = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\p{Emoji_Presentation}]$/u;
// Leading Hangul jamo and syllables, the CJK symbol/kana/compat blocks,
// vertical and small forms, fullwidth forms.
const WIDE_RANGES = [
  [0x1100, 0x115F], [0xA960, 0xA97F], [0xAC00, 0xD7A3], [0x2E80, 0x303E], [0x3041, 0x33FF],
  [0xFE10, 0xFE19], [0xFE30, 0xFE6F], [0xFF01, 0xFF60], [0xFFE0, 0xFFE6],
];

// Display columns of one code point: 0 for marks, format characters and Hangul
// medial/final jamo (they ride on the syllable before them), WIDE for East
// Asian wide and emoji-presentation characters, 1 for everything else.
export function colsOf(cp) {
  if (cp < 0x300 && cp !== 0xAD) return 1;
  if ((cp >= 0x1160 && cp <= 0x11FF) || (cp >= 0xD7B0 && cp <= 0xD7FF)) return 0;
  const ch = String.fromCodePoint(cp);
  if (ZERO_COL.test(ch)) return 0;
  if (cp >= 0xFF61 && cp <= 0xFF9F) return 1; // halfwidth katakana
  for (const [a, b] of WIDE_RANGES) if (cp >= a && cp <= b) return WIDE;
  return WIDE_SCRIPT.test(ch) ? WIDE : 1;
}

// An emoji (a sequence, a flag, a skin-toned or variation-selector one) is one
// glyph however many code points write it. Measured in Chrome (macOS, Courier
// Prime with the system emoji font as the fallback): a Latin column is 9.59px
// and an emoji 20px, 2.085 columns, rounded up to the nearest 1/3 so a line is
// never counted shorter than it draws.
export const EMOJI = 7 / 3;
const EMOJI_GRAPHEME = /\u{FE0F}|\p{Regional_Indicator}|\p{Emoji_Presentation}/u;

function graphemeCols(g) {
  if (EMOJI_GRAPHEME.test(g)) return EMOJI;
  let n = 0;
  for (const ch of g) n += colsOf(ch.codePointAt(0));
  return n;
}

export function textCols(str) {
  const s = String(str);
  let n = 0;
  let high = false; // anything at or above U+2000 might be (part of) an emoji
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x2000) high = true;
    n += colsOf(cp);
  }
  if (!high || !SEGMENTER) return n;
  n = 0;
  for (const { segment } of SEGMENTER.segment(s)) n += graphemeCols(segment);
  return n;
}

// UTF-16 end offsets of each grapheme cluster of `str`.
const SEGMENTER = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
function graphemeEnds(str) {
  const ends = [];
  if (SEGMENTER) {
    for (const g of SEGMENTER.segment(str)) ends.push(g.index + g.segment.length);
    return ends;
  }
  // No Segmenter: a code point plus the zero-width ones that follow it.
  let i = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (colsOf(cp) === 0 && ends.length) ends[ends.length - 1] = i + ch.length;
    else ends.push(i + ch.length);
    i += ch.length;
  }
  return ends;
}

// Word-aware wrap to `width` columns, returning line objects with offsets into
// the ORIGINAL text: [{ text, start, end }]. A single word longer than `width`
// is hard-broken. Returns at least one (possibly empty) line. Offsets let the
// paginator slice the ORIGINAL text for each page (preserving the author's
// spacing) and let the on-screen decoration place a mid-block break at the
// exact character — no lossy single-space rejoin.
//
// `width` is in display COLUMNS (colsOf below), not UTF-16 units: a Japanese
// line must wrap at half as many characters as a Latin one.
//
// Besides whitespace, a line may break before and after any WIDE grapheme (a
// Han, kana or Hangul syllable, an emoji), as a browser does at word-break:
// normal, except that no line starts with closing punctuation or a small kana
// and none ends with an opening bracket (the kinsoku rules).
const NO_START = new Set(Array.from(
  '\u{3001}\u{3002}\u{FF0C}\u{FF0E}\u{30FB}\u{FF1A}\u{FF1B}\u{FF1F}\u{FF01}\u{30FC}\u{FF09}\u{300D}\u{300F}\u{3011}\u{3015}\u{3009}\u{300B}\u{3019}\u{3017}\u{FF5D}\u{FF3D}\u{309D}\u{309E}\u{30FD}\u{30FE}\u{3005}'
  + '\u{3041}\u{3043}\u{3045}\u{3047}\u{3049}\u{3063}\u{3083}\u{3085}\u{3087}\u{308E}\u{30A1}\u{30A3}\u{30A5}\u{30A7}\u{30A9}\u{30C3}\u{30E3}\u{30E5}\u{30E7}\u{30EE}\u{30F5}\u{30F6}'
  + ')]},.!?:;'
  // Chinese writes its quotes with the curly marks; UAX #14 LB19 never breaks
  // before a closing one or after an opening one.
  + '\u{201D}\u{2019}',
));
const NO_END = new Set(Array.from('\u{FF08}\u{300C}\u{300E}\u{3010}\u{3014}\u{3008}\u{300A}\u{3018}\u{3016}\u{FF5B}\u{FF3B}([{\u{201C}\u{2018}'));
// Words with nothing at or above U+2000 (and no Hangul jamo) have no inner
// break opportunity and never need segmenting.
const HAS_INNER_BREAKS = /[\u{1100}-\u{11FF}\u{2000}-\u{10FFFF}]/u;

// The pieces of one whitespace-free word that a line may start or end between:
// [{ start, end }] offsets into `s`.
function breakPieces(s, wStart, wEnd) {
  const word = s.slice(wStart, wEnd);
  if (!HAS_INNER_BREAKS.test(word)) return [{ start: wStart, end: wEnd }];
  // Atoms: each wide grapheme alone, each run of other graphemes together.
  const atoms = [];
  let from = 0;
  for (const to of graphemeEnds(word)) {
    const g = word.slice(from, to);
    const wide = textCols(g) > 1.5;
    const last = atoms[atoms.length - 1];
    if (!wide && last && !last.wide) { last.end = to; last.tail = g; } else atoms.push({ start: from, end: to, wide, head: g, tail: g });
    from = to;
  }
  // Glue what may not be split: a closer or small kana to what precedes it, an
  // opening bracket to what follows it.
  const pieces = [];
  let prevTail = '';
  for (const a of atoms) {
    const first = Array.from(a.head)[0];
    const lastCh = Array.from(a.tail)[0];
    if (pieces.length && (NO_START.has(first) || NO_END.has(prevTail))) pieces[pieces.length - 1].end = wStart + a.end;
    else pieces.push({ start: wStart + a.start, end: wStart + a.end });
    prevTail = lastCh;
  }
  return pieces;
}

export function wrapLines(text, width) {
  const s = String(text || '');
  const lines = [];
  const re = /\S+/g;
  let m;
  let cur = null; // { start, end }
  const flush = () => { if (cur) { lines.push({ text: s.slice(cur.start, cur.end), start: cur.start, end: cur.end }); cur = null; } };
  while ((m = re.exec(s)) !== null) {
    for (const { start: wStart, end: wEnd } of breakPieces(s, m.index, m.index + m[0].length)) {
      const word = s.slice(wStart, wEnd);
      if (textCols(word) > width + COL_EPS) {
        flush();
        // Hard-split by columns, one grapheme at a time: never inside a
        // surrogate pair, never between a letter and its marks, never inside an
        // emoji sequence or flag. At least one grapheme per line.
        const units = graphemeEnds(word);
        let off = wStart;
        let from = 0; // index into units of the first grapheme on this piece
        for (;;) {
          let cols = 0;
          let k = from;
          while (k < units.length) {
            const c = textCols(word.slice(k === 0 ? 0 : units[k - 1], units[k]));
            if (k > from && cols + c > width + COL_EPS) break;
            cols += c;
            k++;
          }
          const end = wStart + units[k - 1];
          if (k >= units.length) { cur = { start: off, end }; break; }
          lines.push({ text: s.slice(off, end), start: off, end });
          off = end;
          from = k;
        }
        continue;
      }
      if (!cur) { cur = { start: wStart, end: wEnd }; continue; }
      // Measure the candidate line from its start to this piece's end — this
      // counts the author's own internal spaces toward the width, matching how
      // the browser wraps the same slice under white-space: pre-wrap.
      if (textCols(s.slice(cur.start, wEnd)) <= width + COL_EPS) cur.end = wEnd;
      else { flush(); cur = { start: wStart, end: wEnd }; }
    }
  }
  flush();
  return lines.length ? lines : [{ text: '', start: 0, end: 0 }];
}

// Back-compat: plain string lines.
export function wrapText(text, width) {
  return wrapLines(text, width).map(l => l.text);
}

function baseCharacter(text) {
  return String(text || '').split('(')[0].trim().toUpperCase();
}

// blocks: [{ element, text }]. Returns { pages, pageCount } where each page is
// an array of placed fragments:
//   { index, element, lines, text, srcStart, more?, contd? }
//     index    — source block index (split fragments share it)
//     lines    — content lines placed on this page
//     text     — the actual ORIGINAL text placed on this page (full block, or
//                the exact slice for a split fragment)
//     srcStart — char offset into the source block where this fragment begins
//                (0 for a whole block / first fragment; >0 for a continuation)
//     more     — a (MORE) marker follows (dialogue split)
//     contd    — character name → render "NAME (CONT'D)" before this fragment
export function paginate(blocks, opts = {}) {
  const pageLines = opts.pageLines || PAGE_LINES;
  const pages = [];
  let page = [];
  let used = 0;
  const pushPage = () => { pages.push(page); page = []; used = 0; };

  let i = 0;
  let carry = null;            // { element, text, index, contd?, srcStart }
  let lastCharacter = '';
  // Auto (CONT'D) is appended to resuming character cues AT RENDER TIME by the
  // screen/print/PDF renderers — count the display text here or a long cue that
  // wraps only with the suffix throws every later line off by one.
  const autoContd = computeAutoContd(blocks);

  let guard = 0;
  while ((i < blocks.length || carry) && guard++ < 100000) {
    const isCarry = !!carry;

    // Forced page break (the separator between doc pages in a whole-doc
    // export, and Fountain's `===`). Ends the current page; places nothing.
    if (!isCarry && blocks[i] && blocks[i].element === 'pagebreak') {
      if (page.length) pushPage();
      i += 1;
      continue;
    }

    // Dual dialogue: ONE left/right pair of speeches is placed as a unit whose
    // height is the TALLER of the two columns (they print/render beside each
    // other, not stacked). Never split across a page. A pair is a run of
    // 'left' blocks followed by a run of 'right' blocks — a second pair that
    // follows immediately is its OWN group (merging them measured four
    // speakers as two columns and refused to break between the pairs).
    if (!isCarry && blocks[i] && blocks[i].dual) {
      let j = i;
      while (j < blocks.length && blocks[j].dual === 'left') j += 1;
      while (j < blocks.length && blocks[j].dual === 'right') j += 1;
      if (j === i) j = i + 1; // malformed attr — never stall
      const group = blocks.slice(i, j);
      // Dual columns are ~half the text block — wrap at the DUAL widths the
      // renderers actually use (29ch / 21ch), not the full-width ones.
      const colLines = (side) => {
        let n = 0, first = true;
        for (const b of group) {
          if (b.dual !== side) continue;
          const ls = wrapLines(b.text, dualElementWidth(b.element)).length;
          n += (first ? 0 : elementSpacing(b.element)) + ls;
          first = false;
        }
        return n;
      };
      const groupLines = Math.max(colLines('left'), colLines('right'));
      const sb = used === 0 ? 0 : 1;
      if (used > 0 && used + sb + groupLines > pageLines) { pushPage(); continue; }
      group.forEach((b, k) => {
        page.push({
          index: i + k, element: b.element, dual: b.dual, srcStart: 0,
          lines: wrapLines(b.text, dualElementWidth(b.element)).length, text: b.text,
        });
      });
      used += sb + groupLines;
      i = j;
      continue;
    }

    const element = isCarry ? carry.element : blocks[i].element;
    if (!isCarry && element === 'character') lastCharacter = baseCharacter(blocks[i].text);

    const srcText = isCarry ? carry.text : (blocks[i].text || '');
    const baseOffset = isCarry ? carry.srcStart : 0;
    const width = elementWidth(element);
    // Character cues never split, so counting their DISPLAY text (with the
    // auto (CONT'D) suffix) is safe — srcText still drives split slicing.
    const countText = (!isCarry && element === 'character' && autoContd.has(i))
      ? characterCueDisplay(srcText, true) : srcText;
    const lineObjs = wrapLines(countText, width);
    const cl = lineObjs.length;
    const idx = isCarry ? carry.index : i;
    const firstOnPage = used === 0;
    const sb = isCarry ? 0 : (firstOnPage ? 0 : elementSpacing(element));
    // A continued dialogue fragment is preceded by its "NAME (CONT'D)" cue
    // line — the renderers draw it, so the paginator must budget it.
    const contdExtra = isCarry && carry.contd ? 1 : 0;

    // Look-ahead "keep together" break rules (only when the page has content):
    // a lead-in element (scene heading, character cue, parenthetical) must not
    // be stranded at the bottom of a page, away from what follows it. Each
    // requires room for itself PLUS the first MIN_SPLIT lines of the next block.
    if (!isCarry && used > 0) {
      const next = blocks[i + 1];
      const nextLead = next
        ? elementSpacing(next.element) + Math.min(MIN_SPLIT, wrapLines(next.text, elementWidth(next.element)).length)
        : 1;
      if ((element === 'scene' || element === 'character')
          && used + sb + cl + nextLead > pageLines) { pushPage(); continue; }
      if (element === 'parenthetical' && next?.element === 'dialogue'
          && used + sb + cl + nextLead > pageLines) { pushPage(); continue; }
    }

    // Whole block/remainder fits.
    if (used + sb + contdExtra + cl <= pageLines) {
      page.push({ index: idx, element, lines: cl, text: srcText, srcStart: baseOffset,
        ...(isCarry && carry.contd ? { contd: carry.contd } : {}) });
      used += sb + contdExtra + cl;
      if (isCarry) carry = null; else i++;
      continue;
    }

    // Doesn't fit — try to split dialogue/action. (Also when the block starts
    // a FRESH page and is taller than one: splitting there beats letting it
    // bleed 16 lines past the bottom margin of the PDF.)
    const splittable = element === 'dialogue' || element === 'action';
    if (splittable) {
      const reserve = element === 'dialogue' ? 1 : 0; // a line for (MORE)
      const fit = pageLines - used - sb - reserve - contdExtra;
      const remaining = cl - fit;
      if (fit >= MIN_SPLIT && remaining >= MIN_SPLIT) {
        const firstText = srcText.slice(0, lineObjs[fit - 1].end);
        const remRel = lineObjs[fit].start;
        page.push({
          index: idx, element, lines: fit, text: firstText, srcStart: baseOffset,
          ...(element === 'dialogue' ? { more: true } : {}),
          ...(isCarry && carry.contd ? { contd: carry.contd } : {}),
        });
        pushPage();
        carry = {
          element, text: srcText.slice(remRel), index: idx, srcStart: baseOffset + remRel,
          ...(element === 'dialogue' ? { contd: lastCharacter } : {}),
        };
        if (!isCarry) i++;
        continue;
      }
    }

    // Can't split and the page has content → move the whole block to a fresh page.
    if (used > 0) { pushPage(); continue; }

    // Page is empty but the block is taller than a page — place it whole (bleed).
    page.push({ index: idx, element, lines: cl, text: srcText, srcStart: baseOffset,
      ...(isCarry && carry.contd ? { contd: carry.contd } : {}) });
    used += contdExtra + cl;
    if (isCarry) carry = null; else i++;
  }
  if (page.length) pushPage();
  return { pages, pageCount: pages.length || 1 };
}
