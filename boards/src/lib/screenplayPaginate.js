// Pure, line-accurate screenplay paginator. NO Tiptap imports — fully
// unit-testable and shared by the on-screen decoration plugin AND the PDF/print
// builder, so on-screen pages == exported pages.
//
// Model: Courier 12pt = 6 lines/inch, 10 chars/inch. US Letter, 1" top/bottom
// margins → ~9" body ≈ 54 text lines/page. Each element has a fixed text width
// (for wrapping) and conventional spacing-before (blank lines).
//
// Break rules implemented:
//   - never orphan a scene heading at the bottom of a page
//   - split a long dialogue block across pages with (MORE) at the bottom and
//     CHARACTER (CONT'D) at the top of the next page; never strand <2 lines
//   - keep a parenthetical with the dialogue that follows it
//   - widow/orphan control for action (don't split off a single line)

export const PAGE_LINES = 54;

// Text width in characters per element (Courier, 10 cpi).
const WIDTH = {
  scene: 60, action: 60, character: 38, parenthetical: 25,
  dialogue: 35, transition: 60, shot: 60, centered: 60,
};
// Blank lines before an element (0 when it's the first line on a page).
const SPACING = {
  scene: 2, action: 1, character: 1, parenthetical: 0,
  dialogue: 0, transition: 1, shot: 1, centered: 1,
};
const MIN_SPLIT = 2; // never leave fewer than this many lines on either side

function contentLines(element, text) {
  const w = WIDTH[element] || 60;
  const len = (text || '').length;
  if (len === 0) return 1;
  return Math.max(1, Math.ceil(len / w));
}
function baseCharacter(text) {
  return String(text || '').split('(')[0].trim().toUpperCase();
}

// blocks: [{ element, text }]. Returns { pages, pageCount } where each page is
// an array of placed fragments:
//   { index, element, lines, more?, contd? }
//     index  — the source block index (fragments of a split block share it)
//     lines  — content lines placed on this page (excludes spacing)
//     more   — true if a (MORE) marker follows (dialogue split)
//     contd  — character name to show as "NAME (CONT'D)" before a continued
//              dialogue fragment
export function paginate(blocks, opts = {}) {
  const pageLines = opts.pageLines || PAGE_LINES;
  const pages = [];
  let page = [];
  let used = 0;
  const pushPage = () => { pages.push(page); page = []; used = 0; };

  let i = 0;
  let carry = null;            // remainder of a split block
  let lastCharacter = '';

  let guard = 0;
  while ((i < blocks.length || carry) && guard++ < 100000) {
    const isCarry = !!carry;
    const src = isCarry ? carry : blocks[i];
    const element = src.element;
    if (!isCarry && element === 'character') lastCharacter = baseCharacter(src.text);

    const firstOnPage = used === 0;
    const sb = isCarry ? 0 : (firstOnPage ? 0 : (SPACING[element] ?? 1));
    const cl = isCarry ? carry.linesRemaining : contentLines(element, src.text);
    const idx = (src.index != null) ? src.index : i;

    // Look-ahead break rules (only when the page already has content).
    if (!isCarry && used > 0) {
      // Never orphan a scene heading: need the heading + ≥1 line of what follows.
      if (element === 'scene' && used + sb + cl + 1 > pageLines) { pushPage(); continue; }
      // Keep a parenthetical with its following dialogue line.
      if (element === 'parenthetical' && blocks[i + 1]?.element === 'dialogue'
          && used + sb + cl + 1 > pageLines) { pushPage(); continue; }
    }

    // Whole block fits.
    if (used + sb + cl <= pageLines) {
      page.push({ index: idx, element, lines: cl, ...(isCarry && carry.contd ? { contd: carry.contd } : {}) });
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
          index: idx, element, lines: fit,
          ...(element === 'dialogue' ? { more: true } : {}),
          ...(isCarry && carry.contd ? { contd: carry.contd } : {}),
        });
        pushPage();
        carry = {
          element, linesRemaining: remaining, text: src.text, index: idx,
          ...(element === 'dialogue' ? { contd: lastCharacter } : {}),
        };
        if (!isCarry) i++;
        continue;
      }
    }

    // Can't split and the page has content → move the whole block to a fresh page.
    if (used > 0) { pushPage(); continue; }

    // Page is empty but the block is taller than a page — place it whole (bleed).
    page.push({ index: idx, element, lines: cl, ...(isCarry && carry.contd ? { contd: carry.contd } : {}) });
    used += cl;
    if (isCarry) carry = null; else i++;
  }
  if (page.length) pushPage();
  return { pages, pageCount: pages.length || 1 };
}

// Convenience: cumulative line offset where each page begins, useful for the
// decoration plugin to place page-break gaps.
export function pageBreakBlockBoundaries(result) {
  // Returns, for each page after the first, the source block index it starts on
  // and whether that start is a continuation (split) of the previous page.
  const out = [];
  for (let p = 1; p < result.pages.length; p++) {
    const first = result.pages[p][0];
    out.push({ page: p, startIndex: first?.index ?? 0, continued: !!first?.contd || result.pages[p - 1].some(f => f.more) });
  }
  return out;
}
