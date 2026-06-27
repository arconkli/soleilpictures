// Deterministic, industry-format screenplay PDF — drawn directly from the SAME
// paginate() output the on-screen editor and print shell use, so the exported
// PDF's pages, line breaks, and indents match what the writer sees.
//
// Why a real PDF (not window.print): window.print() is a no-op inside the iOS
// WKWebView / Android WebView, so the print-to-PDF popup can't work in the
// native app. Drawing a vector PDF with jsPDF works identically on web and
// native, produces selectable Courier text, and needs no browser print dialog.
//
// Geometry is the industry standard, taken from screenplayMetrics.js:
//   • US Letter (8.5×11), 12pt Courier (10 cpi → 1 char = 0.1in)
//   • 1.5in left / 1.0in right margins → a 6.0in (60-char) text block
//   • 1.0in top/bottom margins → 54 lines/page at 6 lines/inch (true single-space)
//   • element indents matching Final Draft (dialogue 2.5in, character cue 3.7in,
//     parenthetical 3.1in, transitions right-aligned), page numbers top-right
//     with a trailing period (omitted on page 1), (MORE)/(CONT'D) on split
//     dialogue, dual dialogue, and scene-number gutters.
//
// jsPDF's built-in standard-14 "Courier" is exactly 10 cpi monospace, so a
// character at column N lands at x = 1.5in + N*0.1in — the same grid the
// paginator counts in. It is lazy-imported so it never touches the main bundle.

import { paginate, wrapLines } from './screenplayPaginate.js';
import { elementIndent, elementWidth, elementSpacing, PAGE_LINES, TEXT_HEIGHT_IN } from './screenplayMetrics.js';
import { computeAutoContd, characterCueDisplay, computeSceneNumbers } from '../components/docExtensions/screenplay/screenplayFlow.js';

// Page geometry, in inches (jsPDF unit: 'in').
const PAGE_W = 8.5;
const PAGE_H = 11;
const LEFT = 1.5;                       // left margin
const RIGHT = PAGE_W - 1.0;             // 7.5in — right edge of the text block
const TOP = 1.0;                        // top margin (first text line)
const CH = 0.1;                         // 1 character = 0.1in (10 cpi)
const LINE = TEXT_HEIGHT_IN / PAGE_LINES; // 9in / 54 = 1/6in = 12pt single-space
const FONT_SIZE = 12;
const CONTD_CH = 22;                    // (MORE)/(CONT'D) sit under the cue column

// Elements rendered ALL CAPS (PDF has no text-transform — uppercase at draw time).
const UPPER = new Set(['scene', 'character', 'transition', 'shot']);

const y0 = (lineIdx) => TOP + lineIdx * LINE;
const sanitize = (s) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ');

// Industry left edge (inches) of a (non-dual) element's text. Transitions are
// right-aligned to the right margin; centered text centers in the text block.
// Exported so a test can assert the indents (scene 1.5", dialogue 2.5",
// character cue 3.7", parenthetical 3.1") without parsing a PDF.
export function elementXInches(element) {
  if (element === 'transition') return RIGHT;            // right-aligned anchor
  if (element === 'centered') return (LEFT + RIGHT) / 2; // centered anchor
  return LEFT + elementIndent(element) * CH;
}

// Page geometry, exported for tests / tooling.
export const PDF_GEOMETRY = { PAGE_W, PAGE_H, LEFT, RIGHT, TOP, LINE, CH };

// Draw one already-wrapped line for a (non-dual) element at the given line row.
function drawElementLine(doc, str, element, lineIdx) {
  const y = y0(lineIdx);
  const text = sanitize(str);
  const x = elementXInches(element);
  if (element === 'transition') doc.text(text, x, y, { align: 'right', baseline: 'top' });
  else if (element === 'centered') doc.text(text, x, y, { align: 'center', baseline: 'top' });
  else doc.text(text, x, y, { baseline: 'top' });
}

// A marker line (CONT'D cue / MORE) under the 22ch character-cue column.
function drawCueColumn(doc, str, lineIdx) {
  doc.text(sanitize(str), LEFT + CONTD_CH * CH, y0(lineIdx), { baseline: 'top' });
}

// Dual dialogue: two ~29ch columns side by side (matches the on-screen CSS).
// Returns the height in lines (the taller column) so the caller can advance.
const dualWrapWidth = (el) => (el === 'parenthetical' ? 21 : 29);
function drawDualGroup(doc, group, startLine) {
  const colTop = { left: 0, right: 0 };  // lines used within each column
  const firstInCol = { left: true, right: true };
  for (const b of group) {
    const side = b.dual === 'right' ? 'right' : 'left';
    const colBase = side === 'left' ? LEFT : LEFT + 31 * CH; // right col offset 31ch
    if (!firstInCol[side]) colTop[side] += elementSpacing(b.element);
    firstInCol[side] = false;
    const lines = wrapLines(b.text, dualWrapWidth(b.element)).map((l) => l.text);
    lines.forEach((ln, k) => {
      const y = y0(startLine + colTop[side] + k);
      let str = sanitize(ln);
      if (UPPER.has(b.element)) str = str.toUpperCase();
      if (b.element === 'character') {
        // Centered within its 29ch column.
        doc.text(str, colBase + 29 * CH / 2, y, { align: 'center', baseline: 'top' });
      } else if (b.element === 'parenthetical') {
        // margin-left 4ch (left col) / 35ch absolute (right col) per the CSS.
        const x = side === 'left' ? LEFT + 4 * CH : LEFT + 35 * CH;
        doc.text(str, x, y, { baseline: 'top' });
      } else {
        doc.text(str, colBase, y, { baseline: 'top' });
      }
    });
    colTop[side] += lines.length;
  }
  return Math.max(colTop.left, colTop.right);
}

// Render a paginated body page's fragments. `contdSet`/`sceneNums` come from the
// whole-script computation so auto-(CONT'D) and scene numbers are correct.
function drawBodyPage(doc, frags, { contdSet, sceneNums, sceneNumbers }) {
  let line = 0;
  let first = true;
  for (let k = 0; k < frags.length; ) {
    const f = frags[k];

    if (f.dual) {
      let j = k;
      while (j < frags.length && frags[j].dual) j += 1;
      if (!first) line += 1;             // one blank line before a dual group
      line += drawDualGroup(doc, frags.slice(k, j), line);
      first = false;
      k = j;
      continue;
    }

    const el = f.element;
    if (!first) line += elementSpacing(el);

    // A page-break (CONT'D) character cue precedes a continued dialogue fragment.
    if (f.contd) { drawElementLine(doc, `${f.contd} (CONT'D)`.toUpperCase(), 'character', line); line += 1; }

    const startLine = line;
    const raw = el === 'character' ? characterCueDisplay(f.text, contdSet.has(f.index)) : f.text;
    const lines = wrapLines(raw, elementWidth(el)).map((l) => (UPPER.has(el) ? l.text.toUpperCase() : l.text));
    for (const ln of lines) { drawElementLine(doc, ln, el, line); line += 1; }

    // (MORE) sits on the line below the last dialogue line of a split block.
    if (f.more) { drawCueColumn(doc, '(MORE)', line); line += 1; }

    // Scene numbers in both gutters, aligned to the slugline's first row.
    if (el === 'scene' && sceneNumbers && sceneNums.has(f.index)) {
      const num = String(sceneNums.get(f.index));
      const y = y0(startLine);
      doc.text(num, LEFT - 0.5, y, { baseline: 'top' });          // left gutter
      doc.text(num, RIGHT + 0.5, y, { align: 'right', baseline: 'top' }); // right gutter
    }

    first = false;
    k += 1;
  }
}

// Page number, top-right with a trailing period (industry convention). pageNum
// is the 1-based body page number; page 1 is intentionally unnumbered.
function drawPageNumber(doc, pageNum) {
  if (pageNum <= 1) return;
  doc.text(`${pageNum}.`, RIGHT, 0.5, { align: 'right', baseline: 'top' });
}

// Industry title page: title block centered ~3.5in down, credit/author below;
// contact + copyright bottom-left, draft date + notes bottom-right.
function drawTitlePage(doc, tp) {
  const cx = PAGE_W / 2;
  let y = 3.5;
  const centerField = (val, gapBefore) => {
    if (!val) return;
    y += gapBefore;
    for (const ln of String(val).split('\n')) { doc.text(sanitize(ln), cx, y, { align: 'center', baseline: 'top' }); y += LINE; }
  };
  centerField(tp.title, 0);
  centerField(tp.credit, 0.4);
  centerField(tp.authors, 0.1);
  centerField(tp.source, 0.4);

  // Bottom corners — stack each block so it ends ~1in from the page bottom.
  const footBottom = PAGE_H - 1.0;
  const drawFoot = (fields, x, align) => {
    const lines = fields.filter(Boolean).join('\n').split('\n').filter((l) => l !== '');
    if (!lines.length) return;
    let fy = footBottom - lines.length * LINE;
    for (const ln of lines) { doc.text(sanitize(ln), x, fy, { align, baseline: 'top' }); fy += LINE; }
  };
  drawFoot([tp.contact, tp.copyright], LEFT, 'left');
  drawFoot([tp.draftDate, tp.notes], RIGHT, 'right');
}

// blocks: [{ element, text, dual?, sceneNumber? }]. Returns a PDF Blob.
export async function buildScreenplayPdfBlob(blocks, { title = 'Screenplay', titlePage = null, sceneNumbers = false } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
  doc.setProperties({ title });
  doc.setFont('courier', 'normal');     // plain (non-bold) — sluglines included
  doc.setFontSize(FONT_SIZE);
  doc.setTextColor(0, 0, 0);

  const { pages } = paginate(blocks);
  const contdSet = computeAutoContd(blocks);
  const sceneNums = computeSceneNumbers(blocks);
  const hasTitle = !!(titlePage && titlePage.enabled
    && (titlePage.title || titlePage.credit || titlePage.authors || titlePage.source
        || titlePage.contact || titlePage.copyright || titlePage.draftDate || titlePage.notes));

  let started = false;
  const nextPage = () => { if (started) doc.addPage(); started = true; };

  if (hasTitle) { nextPage(); drawTitlePage(doc, titlePage); }
  pages.forEach((frags, pi) => {
    nextPage();
    drawPageNumber(doc, pi + 1);
    drawBodyPage(doc, frags, { contdSet, sceneNums, sceneNumbers });
  });
  // Empty script with no title page still yields a valid single blank page.

  return doc.output('blob');
}
