// Single source of truth for screenplay page geometry — the thing that makes
// on-screen pages == exported PDF pages.
//
// Courier 12pt is a monospace grid: every glyph advances 0.1in (10 cpi), so
// 1 character == 1 CSS `ch` == 0.1in, and lines are set on a fixed vertical
// rhythm. US Letter (8.5×11) with the standard 1.5" left / 1" right / 1" top /
// 1" bottom margins gives a 6.0" (60-char) text block, ~9" tall.
//
// The paginator (screenplayPaginate.js) counts lines using these char widths;
// the on-screen CSS (.doc-paper.is-screenplay in styles.css) and the print
// shell (screenplayPrint.js) lay out the SAME widths in `ch` and the SAME
// vertical rhythm via the `--sp-line` custom property. Because all three read
// from here, wrapping and page breaks can't drift apart.
//
// IMPORTANT: PAGE_LINES below and the `--sp-line: calc(9in / 54)` rule in
// styles.css + screenplayPrint.js must stay in sync (9in text height / lines).

export const PAGE_LINES = 54;          // text lines per page — 9in @ 6 lpi (12pt Courier single-spaced)
export const TEXT_HEIGHT_IN = 9;       // 11in - 1in top - 1in bottom
export const TEXT_WIDTH_CH = 60;       // 6.0in text block @ 10 cpi
export const LINE_HEIGHT_IN = TEXT_HEIGHT_IN / PAGE_LINES; // height of one line
export const MIN_SPLIT = 2;            // never strand fewer lines on either side
export const CONTD_INDENT_CH = 22;     // (MORE)/(CONT'D) align under the cue column

// Per-element layout in CHARACTERS, measured from the text-block left edge:
//   indent  — left offset (ch)
//   width   — wrap width / chars per line (ch)
//   spacing — blank lines before the element (0 when first on a page)
// These exact numbers are consumed by the paginator AND emitted as CSS ch
// widths, so they are the contract that keeps screen == print.
export const ELEMENT_METRICS = {
  scene:         { indent: 0,  width: 60, spacing: 2 },
  action:        { indent: 0,  width: 60, spacing: 1 },
  character:     { indent: 22, width: 38, spacing: 1 },
  parenthetical: { indent: 16, width: 25, spacing: 0 },
  dialogue:      { indent: 10, width: 35, spacing: 0 },
  transition:    { indent: 0,  width: 60, spacing: 1 }, // right-aligned via CSS
  shot:          { indent: 0,  width: 60, spacing: 2 }, // 2 blank lines, like a scene heading
  centered:      { indent: 0,  width: 60, spacing: 1 },
};

const def = ELEMENT_METRICS.action;
export const elementWidth = (el) => (ELEMENT_METRICS[el] || def).width;
export const elementIndent = (el) => (ELEMENT_METRICS[el] || def).indent;
export const elementSpacing = (el) => (ELEMENT_METRICS[el] || def).spacing;

// Back-compat: the flat width map the paginator historically exported.
export const ELEMENT_WIDTH = Object.fromEntries(
  Object.entries(ELEMENT_METRICS).map(([k, v]) => [k, v.width]),
);
