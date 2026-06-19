// Industry-credible screenplay PDF/print. Renders the SAME paginate() output
// the on-screen paginator uses, so printed pages == on-screen pages: Courier
// 12pt, US-Letter 1" margins, real running page numbers, (MORE)/(CONT'D) on
// split dialogue. The browser only sees pre-paginated page sections + forced
// page breaks (it doesn't re-paginate), so the layout is deterministic.

import { paginate } from './screenplayPaginate.js';
import { computeAutoContd, characterCueDisplay, computeSceneNumbers } from '../components/docExtensions/screenplay/screenplayFlow.js';

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
// Escape + preserve the field's own line breaks.
function escML(s) { return esc(s).replace(/\n/g, '<br>'); }

// A full-page title page section (industry convention: unnumbered, first page).
// Mirrors the on-screen ScreenplayTitlePage layout.
function titlePageHTML(tp) {
  if (!tp || !tp.enabled) return '';
  const center = [
    tp.title ? `<div class="sp-tp-title">${escML(tp.title)}</div>` : '',
    tp.credit ? `<div class="sp-tp-credit">${escML(tp.credit)}</div>` : '',
    tp.authors ? `<div class="sp-tp-authors">${escML(tp.authors)}</div>` : '',
    tp.source ? `<div class="sp-tp-source">${escML(tp.source)}</div>` : '',
  ].join('');
  const left = [
    tp.contact ? `<div class="sp-tp-contact">${escML(tp.contact)}</div>` : '',
    tp.copyright ? `<div class="sp-tp-copyright">${escML(tp.copyright)}</div>` : '',
  ].join('');
  const right = [
    tp.draftDate ? `<div class="sp-tp-draft">${escML(tp.draftDate)}</div>` : '',
    tp.notes ? `<div class="sp-tp-notes">${escML(tp.notes)}</div>` : '',
  ].join('');
  if (!center && !left && !right) return '';
  return `<section class="sp-page sp-title-page">`
    + `<div class="sp-tp-center">${center}</div>`
    + `<div class="sp-tp-foot"><div class="sp-tp-foot-left">${left}</div><div class="sp-tp-foot-right">${right}</div></div>`
    + `</section>`;
}

// @font-face for the print window. The window is about:blank, so the URL must
// be absolute (pass the app origin); falls back to Courier New if omitted.
function fontFaceCss(base) {
  if (!base) return '';
  return `
  @font-face { font-family: 'Courier Prime'; font-style: normal; font-weight: 400; src: url('${base}/fonts/CourierPrime-Regular.woff2') format('woff2'); }
  @font-face { font-family: 'Courier Prime'; font-style: normal; font-weight: 700; src: url('${base}/fonts/CourierPrime-Bold.woff2') format('woff2'); }
  @font-face { font-family: 'Courier Prime'; font-style: italic; font-weight: 400; src: url('${base}/fonts/CourierPrime-Italic.woff2') format('woff2'); }`;
}

// blocks: [{ element, text }]. opts.titlePage: { enabled, title, ... }.
// opts.fontBaseUrl: app origin so the print window can load Courier Prime.
// Returns a full printable HTML document string.
export function screenplayPrintHTML(blocks, { title = 'Screenplay', titlePage = null, fontBaseUrl = '', sceneNumbers = false } = {}) {
  const { pages } = paginate(blocks);
  const contdSet = computeAutoContd(blocks);
  const sceneNums = computeSceneNumbers(blocks);
  const titleSection = titlePageHTML(titlePage);
  const pageHtml = pages.map((frags, pi) => {
    const rows = frags.map((f) => {
      const contd = f.contd ? `<div class="sp-contd">${esc(f.contd)} (CONT'D)</div>` : '';
      const more = f.more ? `<div class="sp-more">(MORE)</div>` : '';
      // Auto (CONT'D) on a character cue that resumes the same speaker.
      const text = f.element === 'character' ? characterCueDisplay(f.text, contdSet.has(f.index)) : f.text;
      const numAttr = (f.element === 'scene' && sceneNums.has(f.index)) ? ` data-scene-number="${esc(sceneNums.get(f.index))}"` : '';
      const dualAttr = f.dual ? ` data-dual="${f.dual}"` : '';
      return `${contd}<div class="sp-${f.element}"${numAttr}${dualAttr}>${esc(text) || '&nbsp;'}</div>${more}`;
    }).join('');
    // Page numbers top-right, omitted on page 1 (industry convention).
    const num = pi > 0 ? `<div class="sp-pageno">${pi + 1}.</div>` : '';
    return `<section class="sp-page">${num}${rows}</section>`;
  }).join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${fontFaceCss(fontBaseUrl)}
  /* Geometry identical to the on-screen editor (styles.css .is-screenplay):
     a fixed monospace ch-grid + --sp-line vertical rhythm, so the PDF's pages,
     line breaks and indents match what the writer sees. Keep --sp-line and the
     ch values in sync with src/lib/screenplayMetrics.js. */
  :root { --sp-line: calc(9in / 55); }
  @page { size: letter; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Courier Prime', 'Courier New', Courier, monospace; font-size: 12pt; line-height: var(--sp-line); color: #000; }
  /* Each page is a real 8.5×11 sheet carrying the 1.5"/1.0" left/right margins
     itself (so screen-preview == print; @page margin is 0). */
  .sp-page { position: relative; width: 8.5in; min-height: 11in; box-sizing: border-box; padding: 1in 1in 1in 1.5in; margin: 0 auto 24px; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.2); break-after: page; }
  .sp-page:last-child { break-after: auto; }
  @media print { .sp-page { margin: 0; box-shadow: none; } }
  .sp-pageno { position: absolute; top: 0.5in; right: 1in; }
  .sp-scene { text-transform: uppercase; font-weight: 700; margin-top: calc(2 * var(--sp-line)); white-space: pre-wrap; max-width: 60ch; position: relative; }
  /* Scene numbers in both gutters (only when enabled). */
  body.sp-show-nums .sp-scene[data-scene-number]::before,
  body.sp-show-nums .sp-scene[data-scene-number]::after { content: attr(data-scene-number); position: absolute; top: 0; font-weight: 400; }
  body.sp-show-nums .sp-scene[data-scene-number]::before { left: -0.5in; }
  body.sp-show-nums .sp-scene[data-scene-number]::after { right: -0.5in; }
  .sp-action { margin-top: var(--sp-line); white-space: pre-wrap; max-width: 60ch; }
  .sp-shot { text-transform: uppercase; margin-top: var(--sp-line); white-space: pre-wrap; max-width: 60ch; }
  .sp-character { text-transform: uppercase; margin-top: var(--sp-line); margin-left: 22ch; max-width: 38ch; white-space: pre-wrap; }
  .sp-parenthetical { margin-left: 16ch; max-width: 25ch; white-space: pre-wrap; }
  .sp-dialogue { margin-left: 10ch; max-width: 35ch; white-space: pre-wrap; }
  .sp-transition { text-transform: uppercase; text-align: right; margin-top: var(--sp-line); white-space: pre-wrap; max-width: 60ch; }
  .sp-centered { text-align: center; margin-top: var(--sp-line); white-space: pre-wrap; max-width: 60ch; }
  /* (MORE) / (CONT'D) align under the character cue column (22ch). */
  .sp-contd { text-transform: uppercase; margin-left: 22ch; }
  .sp-more { margin-left: 22ch; }
  /* Dual dialogue — two side-by-side ~29ch columns. LEFT floats; RIGHT stays
     in-flow with a left margin so it top-aligns beside the float (a right float
     would be forced below). Non-dual blocks clear. */
  .sp-page > div:not([data-dual]) { clear: both; }
  .sp-page [data-dual] { box-sizing: border-box; width: 29ch; max-width: 29ch; margin-top: var(--sp-line); }
  .sp-page [data-dual="left"] { float: left; clear: left; margin-left: 0; }
  .sp-page [data-dual="right"] { float: none; clear: none; margin-left: 31ch; }
  .sp-page .sp-character[data-dual] { text-align: center; }
  .sp-page .sp-parenthetical[data-dual="left"] { margin-left: 4ch; max-width: 21ch; }
  .sp-page .sp-parenthetical[data-dual="right"] { margin-left: 35ch; max-width: 21ch; }
  /* Title page — full-page flex layout matching the on-screen editor. The title
     page uses symmetric 1in margins so it centers on the sheet. */
  .sp-title-page { display: flex; flex-direction: column; text-align: center; padding-left: 1in; }
  .sp-title-page .sp-tp-center { margin-top: 2in; }
  .sp-title-page .sp-tp-foot { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
  .sp-title-page .sp-tp-foot-left { text-align: left; }
  .sp-title-page .sp-tp-foot-right { text-align: right; }
  .sp-tp-credit { margin-top: 1.5em; }
  .sp-tp-source { margin-top: 1.5em; }
  .sp-tp-copyright { margin-top: 1em; }
  .sp-tp-notes { margin-top: 1em; }
</style></head><body class="${sceneNumbers ? 'sp-show-nums' : ''}">${titleSection}${pageHtml}</body></html>`;
}
