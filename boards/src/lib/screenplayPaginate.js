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
  PAGE_LINES, MIN_SPLIT, ELEMENT_WIDTH, elementWidth, elementSpacing,
} from './screenplayMetrics.js';

export { PAGE_LINES, ELEMENT_WIDTH };

// Word-aware wrap to `width` columns, returning line objects with offsets into
// the ORIGINAL text: [{ text, start, end }]. A single word longer than `width`
// is hard-broken. Returns at least one (possibly empty) line. Offsets let the
// paginator slice the ORIGINAL text for each page (preserving the author's
// spacing) and let the on-screen decoration place a mid-block break at the
// exact character — no lossy single-space rejoin.
export function wrapLines(text, width) {
  const s = String(text || '');
  const lines = [];
  const re = /\S+/g;
  let m;
  let cur = null; // { start, end }
  const flush = () => { if (cur) { lines.push({ text: s.slice(cur.start, cur.end), start: cur.start, end: cur.end }); cur = null; } };
  while ((m = re.exec(s)) !== null) {
    const word = m[0];
    const wStart = m.index;
    const wEnd = wStart + word.length;
    if (word.length > width) {
      flush();
      let off = wStart;
      let rest = word;
      while (rest.length > width) { lines.push({ text: rest.slice(0, width), start: off, end: off + width }); rest = rest.slice(width); off += width; }
      cur = { start: off, end: off + rest.length };
      continue;
    }
    if (!cur) { cur = { start: wStart, end: wEnd }; continue; }
    // Measure the candidate line from its start to this word's end — this
    // counts the author's own internal spaces toward the width, matching how
    // the browser wraps the same slice under white-space: pre-wrap.
    if ((wEnd - cur.start) <= width) cur.end = wEnd;
    else { flush(); cur = { start: wStart, end: wEnd }; }
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

  let guard = 0;
  while ((i < blocks.length || carry) && guard++ < 100000) {
    const isCarry = !!carry;
    const element = isCarry ? carry.element : blocks[i].element;
    if (!isCarry && element === 'character') lastCharacter = baseCharacter(blocks[i].text);

    const srcText = isCarry ? carry.text : (blocks[i].text || '');
    const baseOffset = isCarry ? carry.srcStart : 0;
    const width = elementWidth(element);
    const lineObjs = wrapLines(srcText, width);
    const cl = lineObjs.length;
    const idx = isCarry ? carry.index : i;
    const firstOnPage = used === 0;
    const sb = isCarry ? 0 : (firstOnPage ? 0 : elementSpacing(element));

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
    if (used + sb + cl <= pageLines) {
      page.push({ index: idx, element, lines: cl, text: srcText, srcStart: baseOffset,
        ...(isCarry && carry.contd ? { contd: carry.contd } : {}) });
      used += sb + cl;
      if (isCarry) carry = null; else i++;
      continue;
    }

    // Doesn't fit — try to split dialogue/action.
    const splittable = element === 'dialogue' || element === 'action';
    if (splittable && used > 0) {
      const reserve = element === 'dialogue' ? 1 : 0; // a line for (MORE)
      const fit = pageLines - used - sb - reserve;
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
    used += cl;
    if (isCarry) carry = null; else i++;
  }
  if (page.length) pushPage();
  return { pages, pageCount: pages.length || 1 };
}
