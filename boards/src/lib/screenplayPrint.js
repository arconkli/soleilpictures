// Industry-credible screenplay PDF/print. Renders the SAME paginate() output
// the on-screen paginator uses, so printed pages == on-screen pages: Courier
// 12pt, US-Letter 1" margins, real running page numbers, (MORE)/(CONT'D) on
// split dialogue. The browser only sees pre-paginated page sections + forced
// page breaks (it doesn't re-paginate), so the layout is deterministic.

import { paginate } from './screenplayPaginate.js';

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

// blocks: [{ element, text }]. opts.titlePage: { enabled, title, ... }.
// Returns a full printable HTML document string.
export function screenplayPrintHTML(blocks, { title = 'Screenplay', titlePage = null } = {}) {
  const { pages } = paginate(blocks);
  const titleSection = titlePageHTML(titlePage);
  const pageHtml = pages.map((frags, pi) => {
    const rows = frags.map((f) => {
      const contd = f.contd ? `<div class="sp-contd">${esc(f.contd)} (CONT'D)</div>` : '';
      const more = f.more ? `<div class="sp-more">(MORE)</div>` : '';
      return `${contd}<div class="sp-${f.element}">${esc(f.text) || '&nbsp;'}</div>${more}`;
    }).join('');
    // Page numbers top-right, omitted on page 1 (industry convention).
    const num = pi > 0 ? `<div class="sp-pageno">${pi + 1}.</div>` : '';
    return `<section class="sp-page">${num}${rows}</section>`;
  }).join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: letter; margin: 1in; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Courier Prime', 'Courier New', Courier, monospace; font-size: 12pt; line-height: 1; color: #000; }
  /* On screen (the print-preview window) show page frames; in print they're
     just the flowed sections with forced breaks. */
  .sp-page { position: relative; width: 8.5in; min-height: 11in; box-sizing: border-box; padding: 1in; margin: 0 auto 24px; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.2); break-after: page; }
  .sp-page:last-child { break-after: auto; }
  @media print { .sp-page { width: auto; min-height: 0; padding: 0; margin: 0; box-shadow: none; } }
  .sp-pageno { position: absolute; top: 0.5in; right: 1in; }
  @media print { .sp-pageno { top: -0.5in; right: 0; } }
  .sp-scene { text-transform: uppercase; font-weight: 700; margin-top: 1.5em; white-space: pre-wrap; }
  .sp-action { margin-top: 1em; white-space: pre-wrap; }
  .sp-shot { text-transform: uppercase; margin-top: 1em; white-space: pre-wrap; }
  .sp-character { text-transform: uppercase; margin-top: 1em; margin-left: 2in; white-space: pre-wrap; }
  .sp-parenthetical { margin-left: 1.5in; margin-right: 2in; white-space: pre-wrap; }
  .sp-dialogue { margin-left: 1in; margin-right: 1.5in; white-space: pre-wrap; }
  .sp-transition { text-transform: uppercase; text-align: right; margin-top: 1em; white-space: pre-wrap; }
  .sp-centered { text-align: center; margin-top: 1em; white-space: pre-wrap; }
  .sp-contd { text-transform: uppercase; margin-left: 1in; }
  .sp-more { margin-left: 1in; }
  /* Title page — full-page flex layout matching the on-screen editor. */
  .sp-title-page { display: flex; flex-direction: column; text-align: center; }
  .sp-title-page .sp-tp-center { margin-top: 2in; }
  .sp-title-page .sp-tp-foot { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
  .sp-title-page .sp-tp-foot-left { text-align: left; }
  .sp-title-page .sp-tp-foot-right { text-align: right; }
  .sp-tp-credit { margin-top: 1.5em; }
  .sp-tp-source { margin-top: 1.5em; }
  .sp-tp-copyright { margin-top: 1em; }
  .sp-tp-notes { margin-top: 1em; }
  @media print { .sp-title-page { min-height: 9in; } }
</style></head><body>${titleSection}${pageHtml}</body></html>`;
}
