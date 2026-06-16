// Pure, line-accurate screenplay paginator. NO Tiptap imports — fully
// unit-testable and shared by the on-screen decoration plugin AND the PDF/print
// builder, so on-screen pages == exported pages.
//
// Model: Courier 12pt = 6 lines/inch, 10 chars/inch. US Letter, 1" top/bottom
// margins → ~9" body ≈ 54 text lines/page. Each element has a fixed text width
// (for word-aware wrapping) and conventional spacing-before (blank lines).
//
// Break rules implemented:
//   - never orphan a scene heading at the bottom of a page
//   - split a long dialogue/action block across pages; dialogue splits add
//     (MORE) at the bottom and CHARACTER (CONT'D) at the top of the next page;
//     never strand <2 lines on either side
//   - keep a parenthetical with the dialogue that follows it

export const PAGE_LINES = 54;

// Text width in characters per element (Courier, 10 cpi).
export const ELEMENT_WIDTH = {
  scene: 60, action: 60, character: 38, parenthetical: 25,
  dialogue: 35, transition: 60, shot: 60, centered: 60,
};
// Blank lines before an element (0 when it's the first line on a page).
const SPACING = {
  scene: 2, action: 1, character: 1, parenthetical: 0,
  dialogue: 0, transition: 1, shot: 1, centered: 1,
};
const MIN_SPLIT = 2; // never leave fewer than this many lines on either side

// Word-aware wrap to `width` columns. A single word longer than `width` is hard-
// broken. Returns at least one (possibly empty) line.
export function wrapText(text, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (w.length > width) {
      if (cur) { lines.push(cur); cur = ''; }
      let rest = w;
      while (rest.length > width) { lines.push(rest.slice(0, width)); rest = rest.slice(width); }
      cur = rest;
      continue;
    }
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function baseCharacter(text) {
  return String(text || '').split('(')[0].trim().toUpperCase();
}

// blocks: [{ element, text }]. Returns { pages, pageCount } where each page is
// an array of placed fragments:
//   { index, element, lines, text, more?, contd? }
//     index  — source block index (split fragments share it)
//     lines  — content lines placed on this page
//     text   — the actual text placed on this page (full block, or the slice
//              for a split fragment)
//     more   — a (MORE) marker follows (dialogue split)
//     contd  — character name → render "NAME (CONT'D)" before this fragment
export function paginate(blocks, opts = {}) {
  const pageLines = opts.pageLines || PAGE_LINES;
  const pages = [];
  let page = [];
  let used = 0;
  const pushPage = () => { pages.push(page); page = []; used = 0; };

  let i = 0;
  let carry = null;            // { element, lines:[], index, contd? }
  let lastCharacter = '';

  let guard = 0;
  while ((i < blocks.length || carry) && guard++ < 100000) {
    const isCarry = !!carry;
    const element = isCarry ? carry.element : blocks[i].element;
    if (!isCarry && element === 'character') lastCharacter = baseCharacter(blocks[i].text);

    const allLines = isCarry ? carry.lines : wrapText(blocks[i].text, ELEMENT_WIDTH[element] || 60);
    const cl = allLines.length;
    const idx = isCarry ? carry.index : i;
    const firstOnPage = used === 0;
    const sb = isCarry ? 0 : (firstOnPage ? 0 : (SPACING[element] ?? 1));

    // Look-ahead break rules (only when the page already has content).
    if (!isCarry && used > 0) {
      if (element === 'scene' && used + sb + cl + 1 > pageLines) { pushPage(); continue; }
      if (element === 'parenthetical' && blocks[i + 1]?.element === 'dialogue'
          && used + sb + cl + 1 > pageLines) { pushPage(); continue; }
    }

    // Whole block/remainder fits.
    if (used + sb + cl <= pageLines) {
      page.push({ index: idx, element, lines: cl, text: allLines.join(' '),
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
        page.push({
          index: idx, element, lines: fit, text: allLines.slice(0, fit).join(' '),
          ...(element === 'dialogue' ? { more: true } : {}),
          ...(isCarry && carry.contd ? { contd: carry.contd } : {}),
        });
        pushPage();
        carry = {
          element, lines: allLines.slice(fit), index: idx,
          ...(element === 'dialogue' ? { contd: lastCharacter } : {}),
        };
        if (!isCarry) i++;
        continue;
      }
    }

    // Can't split and the page has content → move the whole block to a fresh page.
    if (used > 0) { pushPage(); continue; }

    // Page is empty but the block is taller than a page — place it whole (bleed).
    page.push({ index: idx, element, lines: cl, text: allLines.join(' '),
      ...(isCarry && carry.contd ? { contd: carry.contd } : {}) });
    used += cl;
    if (isCarry) carry = null; else i++;
  }
  if (page.length) pushPage();
  return { pages, pageCount: pages.length || 1 };
}
