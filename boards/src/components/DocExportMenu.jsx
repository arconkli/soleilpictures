// Export the active doc as HTML, Markdown, or print-to-PDF.
//
// HTML: uses editor.getHTML() wrapped in a minimal printable shell so all
// docs export with consistent typography regardless of the user's theme.
// Markdown: walks the editor JSON and serializes to GFM (good-enough subset).
// PDF: window.print() of the same printable shell — user picks "Save as PDF"
// in the system dialog.

import { useEffect, useRef, useState } from 'react';
import { collectFullDocHtml, collectFullDocMarkdown, jsonToMarkdown, collectFullDocJSON } from '../lib/docFullExport.js';
import {
  jsonToFountain, fountainToBlocks, jsonToFdx, fdxToBlocks, blocksToDocJSON, docJSONToBlocks,
  parseFountainTitlePage, fdxToTitlePage,
} from '../lib/screenplayIO.js';
import { screenplayPrintHTML } from '../lib/screenplayPrint.js';
import { getTitlePage, setTitlePage } from '../lib/docState.js';

// Whole-doc export. When ydoc+scope are provided we serialize EVERY page ×
// EVERY sheet (the single-focused-sheet path was silent data loss); the bare
// `editor` is only a fallback for the rare caller without doc state.
// Screenplay docs additionally get Fountain/FDX export + import.
export function DocExportMenu({ editor, docName, ydoc = null, scope = null, docMode = 'doc' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const safeName = (docName || 'document').replace(/[^a-z0-9-_ ]/gi, '_').slice(0, 80);

  const downloadBlob = (blob, ext) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${safeName}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printableHTML = (bodyHTML) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(safeName)}</title>
<style>
  @page { margin: 0.75in; }
  [style*="break-after:page"] { break-after: page; page-break-after: always; }
  body { font-family: ui-serif, Georgia, "Iowan Old Style", serif; font-size: 12pt; line-height: 1.6; color: #111; max-width: 720px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 28pt; margin: 1.2em 0 .3em; }
  h2 { font-size: 20pt; margin: 1.2em 0 .3em; }
  h3 { font-size: 15pt; margin: 1em 0 .3em; }
  h4, h5, h6 { margin: 1em 0 .3em; }
  p { margin: .5em 0; }
  ul, ol { padding-left: 24px; }
  blockquote { border-left: 3px solid #ccc; padding: .2em 12px; color: #444; font-style: italic; }
  code { background: #f4f4f5; border-radius: 3px; padding: 1px 4px; font-family: ui-monospace, monospace; }
  pre { background: #f4f4f5; border-radius: 6px; padding: 12px; overflow: auto; }
  pre code { background: transparent; padding: 0; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 1.6em 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 9px; text-align: left; }
  th { background: #f4f4f5; }
  img { max-width: 100%; height: auto; border-radius: 4px; }
  a { color: #2563eb; }
  mark { background: #fff7a8; }
  ul[data-type="taskList"] { list-style: none; padding-left: 4px; }
  ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
</style></head><body>${bodyHTML}</body></html>`;

  // Whole-doc body HTML (all pages × sheets, assets resolved). Falls back to
  // the focused editor only when doc state isn't available.
  const fullBodyHtml = async () => {
    if (ydoc) return collectFullDocHtml(ydoc, scope);
    return editor ? editor.getHTML() : '';
  };

  const exportHTML = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const bodyHTML = await fullBodyHtml();
      downloadBlob(new Blob([printableHTML(bodyHTML)], { type: 'text/html' }), 'html');
      setOpen(false);
    } finally { setBusy(false); }
  };

  const exportMarkdown = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const md = ydoc ? await collectFullDocMarkdown(ydoc, scope)
                      : (editor ? jsonToMarkdown(editor.getJSON()) : '');
      downloadBlob(new Blob([md], { type: 'text/markdown' }), 'md');
      setOpen(false);
    } finally { setBusy(false); }
  };

  const exportPDF = async () => {
    if (busy) return;
    setBusy(true);
    // Open the print window synchronously (popup-blockers require it be tied to
    // the click) and fill it once the async body resolves.
    const w = window.open('', '_blank', 'noopener');
    try {
      // Screenplay docs print from the line-accurate paginator (Courier, 1"
      // margins, page numbers, MORE/CONT'D) so the PDF matches on-screen pages.
      let html;
      if (docMode === 'screenplay') {
        const titlePage = ydoc ? getTitlePage(ydoc, scope) : null;
        const fontBaseUrl = typeof location !== 'undefined' ? location.origin : '';
        html = screenplayPrintHTML(docJSONToBlocks(scriptBlocks()), { title: safeName, titlePage, fontBaseUrl });
      } else {
        html = printableHTML(await fullBodyHtml());
      }
      if (!w) return;
      w.document.write(html);
      w.document.close();
      // Print once fonts are ready so Courier metrics are correct (no FOUT-driven
      // re-pagination); fall back to a short delay if fonts.ready is unavailable.
      const doPrint = () => { try { w.focus(); w.print(); } catch (_) {} };
      const fontsReady = w.document.fonts && w.document.fonts.ready;
      if (fontsReady && typeof fontsReady.then === 'function') {
        fontsReady.then(() => setTimeout(doPrint, 50)).catch(() => setTimeout(doPrint, 300));
      } else {
        setTimeout(doPrint, 300);
      }
      setOpen(false);
    } finally { setBusy(false); }
  };

  const scriptBlocks = () => {
    if (ydoc) return collectFullDocJSON(ydoc, scope);
    return editor ? editor.getJSON() : { type: 'doc', content: [] };
  };
  const exportFountain = () => {
    const titlePage = ydoc ? getTitlePage(ydoc, scope) : null;
    downloadBlob(new Blob([jsonToFountain(scriptBlocks(), titlePage)], { type: 'text/plain' }), 'fountain');
    setOpen(false);
  };
  const exportFdx = () => {
    const titlePage = ydoc ? getTitlePage(ydoc, scope) : null;
    downloadBlob(new Blob([jsonToFdx(scriptBlocks(), titlePage)], { type: 'application/xml' }), 'fdx');
    setOpen(false);
  };
  const importScript = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fountain,.txt,.fdx,application/xml,text/plain';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try {
        const text = await f.text();
        const isFdx = /\.fdx$/i.test(f.name) || /<FinalDraft/i.test(text);
        let blocks, titlePage = null;
        if (isFdx) {
          blocks = fdxToBlocks(text);
          titlePage = fdxToTitlePage(text);
        } else {
          const parsed = parseFountainTitlePage(text);
          titlePage = parsed.titlePage;
          blocks = fountainToBlocks(parsed.body);
        }
        if (!blocks.length && !titlePage) return;
        if (editor) {
          // Replace the focused sheet's content. Undoable via ⌘Z; confirm only
          // when there's existing content to clobber.
          if (!editor.isEmpty && !window.confirm('Replace this document with the imported screenplay?')) return;
          editor.chain().focus().setContent(blocksToDocJSON(blocks)).run();
        }
        // Import the title page (enable it) — it lives in docMeta, not the editor.
        if (titlePage && ydoc) setTitlePage(ydoc, scope, { enabled: true, ...titlePage });
      } catch (_) { /* malformed file — no-op */ }
    };
    input.click();
    setOpen(false);
  };

  return (
    <span className="doc-export-wrap" ref={ref}>
      <button className="doc-tb-btn" title="Export" aria-label="Export"
              aria-haspopup="menu" aria-expanded={open}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(o => !o)}
              disabled={!editor}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 2 V9 M4 6 L7 9 L10 6" />
          <path d="M3 11 H11" />
        </svg>
      </button>
      {open && (
        <div className="doc-export-menu" role="menu">
          {docMode === 'screenplay' && (
            <>
              <button role="menuitem" onClick={exportFountain}>Export Fountain (.fountain)</button>
              <button role="menuitem" onClick={exportFdx}>Export Final Draft (.fdx)</button>
              <button role="menuitem" onClick={importScript}>Import Fountain / Final Draft…</button>
              <div className="doc-export-sep" role="separator" />
            </>
          )}
          <button role="menuitem" onClick={exportHTML}>Export HTML</button>
          <button role="menuitem" onClick={exportMarkdown}>Export Markdown</button>
          <button role="menuitem" onClick={exportPDF}>Print / Save as PDF</button>
        </div>
      )}
    </span>
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}
