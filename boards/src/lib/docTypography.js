// Single source of PROSE-DOC typography for the print / export artifact.
//
// WYSIWYG contract: this stylesheet is the white-paper twin of the on-screen
// editor rules in styles.css (`.tt-editor` block, ~line 11545). The two MUST
// stay in lockstep — same font stacks, same heading scale, same code/quote/
// table/list rhythm — so what the writer sees on screen is what the exported
// HTML / printed PDF looks like. The only deliberate differences are colour
// (the page is always white here, regardless of app theme) and that we use
// px throughout (16px == 12pt at 96dpi) so print metrics match the screen
// exactly. When you change one side, change the other.
//
// Geometry: US-Letter, 1in margins (== the on-screen sheet's 96px padding),
// 6.5in text column (== the on-screen measure). The browser print engine then
// paginates at the same line boundaries the on-screen paginator computes.

// Document identity: refined serif body + the app sans for headings — an
// editorial pairing that reads like a real manuscript. Swap DOC_BODY_FONT for
// DOC_HEAD_FONT here (one line) to go all-sans.
const DOC_BODY_FONT = "Georgia, 'Iowan Old Style', 'Times New Roman', ui-serif, serif";
const DOC_HEAD_FONT = "aileron, -apple-system, system-ui, 'Segoe UI', sans-serif";
const DOC_MONO_FONT = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace";
const SOLEIL = '#cc8400'; // print-safe soleil (on-screen --soleil #ffa500 is too light on white)

export const docPrintCSS = `
  @page { size: letter; margin: 1in; }
  [style*="break-after:page"] { break-after: page; page-break-after: always; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${DOC_BODY_FONT};
    font-size: 16px; line-height: 1.6; color: #1a1a1f;
    max-width: 6.5in; margin: 0 auto; padding: 0 2px;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  /* Headings: sans, all >= body size, monotonic scale, no mid-document rule. */
  h1, h2, h3, h4, h5, h6 {
    font-family: ${DOC_HEAD_FONT};
    color: #0a0a0c; line-height: 1.18; letter-spacing: -0.018em;
    margin: 1.5em 0 .4em; page-break-after: avoid; break-after: avoid;
  }
  h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; margin-top: 1.6em; }
  h2 { font-size: 24px; font-weight: 700; letter-spacing: -0.022em; }
  h3 { font-size: 20px; font-weight: 600; }
  h4 { font-size: 18px; font-weight: 600; }
  h5 { font-size: 16px; font-weight: 700; }
  h6 { font-size: 16px; font-weight: 600; color: #4a4a52; }
  h1 + h2, h2 + h3, h3 + h4 { margin-top: .6em; }
  body > :first-child { margin-top: 0; }
  p { margin: .6em 0; }
  ul, ol { margin: .6em 0; padding-left: 26px; }
  li { margin: .2em 0; }
  li > p { margin: 0; }
  blockquote {
    margin: .9em 0; padding: .15em 0 .15em 22px;
    border-left: 2px solid #c8c8cc; color: #45454c; font-style: italic;
  }
  hr { border: 0; border-top: 1px solid #dcdce0; margin: 1.7em 0; }
  /* De-boxed code: soft tint inline, soleil left-rule on blocks (matches screen). */
  code { font-family: ${DOC_MONO_FONT}; font-size: 0.87em; background: #f1f1f3; border-radius: 2px; padding: 1px 5px; }
  pre {
    font-family: ${DOC_MONO_FONT}; font-size: 13.5px; line-height: 1.5;
    background: #f7f7f8; border-left: 4px solid ${SOLEIL};
    padding: 12px 14px; margin: .9em 0; overflow-x: auto; white-space: pre;
    page-break-inside: avoid; break-inside: avoid;
  }
  pre code { background: transparent; padding: 0; font-size: inherit; }
  img, .tt-img {
    max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 1em auto;
    page-break-inside: avoid; break-inside: avoid;
  }
  /* De-boxed tables: hairline top/bottom + quiet column dividers, no header fill. */
  table, .tt-table {
    border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 15px;
    margin: 1em 0; border-top: 1px solid #b8b8be; border-bottom: 1px solid #b8b8be;
    page-break-inside: avoid; break-inside: avoid;
  }
  td, th { border: 0; border-right: 1px solid #ececf0; padding: 6px 9px; text-align: left; vertical-align: top; }
  td:last-child, th:last-child { border-right: 0; }
  th { font-weight: 600; border-bottom: 1px solid #b8b8be; }
  a { color: #1a1a1f; text-decoration: underline; text-decoration-color: #b0b0b6; text-underline-offset: 3px; }
  mark { background: #fff3a0; color: #1a1300; padding: 0 2px; border-radius: 2px; }
  ul[data-type="taskList"] { list-style: none; padding-left: 2px; }
  ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
  ul[data-type="taskList"] li > label { margin-top: 4px; }
  ul[data-type="taskList"] li[data-checked="true"] > div { color: #8a8a90; text-decoration: line-through; }
`;
