// Export the active doc as HTML, Markdown, PDF, or (screenplay) Fountain/FDX.
//
// HTML: uses editor.getHTML() wrapped in a minimal printable shell so all
// docs export with consistent typography regardless of the user's theme.
// Markdown: walks the editor JSON and serializes to GFM (good-enough subset).
// PDF — screenplay: a real, paginated vector PDF (buildScreenplayPdfBlob) so it
// works on web AND in the native app, where window.print() doesn't exist.
// PDF — prose: print the printable shell via a hidden iframe → system "Save as
// PDF" (no popup, so no popup-blocker / window.open-noopener-null failures).
// Every generated file routes through deliverFile (download on web, native
// share sheet in the app, where <a download> doesn't save).

import { useEffect, useRef, useState } from 'react';
import { collectFullDocHtml, collectFullDocMarkdown, jsonToMarkdown, collectFullDocJSON } from '../lib/docFullExport.js';
import {
  jsonToFountain, fountainToBlocks, jsonToFdx, fdxToBlocks, blocksToDocJSON, docJSONToBlocks,
  parseFountainTitlePage, fdxToTitlePage,
} from '../lib/screenplayIO.js';
import { buildScreenplayPdfBlob } from '../lib/screenplayPdf.js';
import { deliverFile } from '../lib/exportDelivery.js';
import { docPrintCSS } from '../lib/docTypography.js';
import { getTitlePage, setTitlePage, getSceneNumbersShow } from '../lib/docState.js';
import { useFeedback } from './AppFeedback.jsx';

// Whole-doc export. When ydoc+scope are provided we serialize EVERY page ×
// EVERY sheet (the single-focused-sheet path was silent data loss); the bare
// `editor` is only a fallback for the rare caller without doc state.
// Screenplay docs additionally get Fountain/FDX export + import.
export function DocExportMenu({ editor, docName, ydoc = null, scope = null, docMode = 'doc' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const feedback = useFeedback();

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

  // Deliver a generated blob: a download on web, the native share sheet inside
  // the app (where <a download> doesn't save). Surfaces a toast on failure.
  const saveFile = async (blob, ext) => {
    try { await deliverFile(blob, `${safeName}.${ext}`); }
    catch (err) {
      console.error('[export] delivery failed', err);
      feedback.toast({ type: 'error', message: 'Export failed — please try again.' });
    }
  };

  // WYSIWYG: the exported HTML / printed PDF uses the SAME typography as the
  // on-screen editor (docPrintCSS is the white-paper twin of the .tt-editor
  // rules in styles.css). User-applied font/size/colour/highlight/alignment
  // marks render as inline styles from generateHTML and sit on top of this.
  const printableHTML = (bodyHTML) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(safeName)}</title>
<style>${docPrintCSS}</style></head><body>${bodyHTML}</body></html>`;

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
      await saveFile(new Blob([printableHTML(bodyHTML)], { type: 'text/html' }), 'html');
      setOpen(false);
    } finally { setBusy(false); }
  };

  const exportMarkdown = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const md = ydoc ? await collectFullDocMarkdown(ydoc, scope)
                      : (editor ? jsonToMarkdown(editor.getJSON()) : '');
      await saveFile(new Blob([md], { type: 'text/markdown' }), 'md');
      setOpen(false);
    } finally { setBusy(false); }
  };

  const exportPDF = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (docMode === 'screenplay') {
        // A real, line-accurate PDF drawn from the paginator (Courier, 1.5"/1"
        // margins, page numbers, MORE/CONT'D). Delivered as a file so it works
        // on web AND the native app, where window.print() is unavailable.
        const titlePage = ydoc ? getTitlePage(ydoc, scope) : null;
        const sceneNumbers = ydoc ? getSceneNumbersShow(ydoc, scope) : false;
        const blob = await buildScreenplayPdfBlob(docJSONToBlocks(scriptBlocks()), { title: safeName, titlePage, sceneNumbers });
        await deliverFile(blob, `${safeName}.pdf`);
      } else {
        // Prose docs print through a hidden same-origin iframe → the system
        // "Save as PDF". Avoids the popup path (popup blockers + the
        // window.open(...'noopener') === null gotcha that silently no-op'd).
        await printHtmlViaIframe(printableHTML(await fullBodyHtml()));
      }
      setOpen(false);
    } catch (err) {
      console.error('[export] PDF failed', err);
      feedback.toast({ type: 'error', message: 'Couldn’t export this document — please try again.' });
    } finally { setBusy(false); }
  };

  const scriptBlocks = () => {
    if (ydoc) return collectFullDocJSON(ydoc, scope);
    return editor ? editor.getJSON() : { type: 'doc', content: [] };
  };
  const exportFountain = async () => {
    const titlePage = ydoc ? getTitlePage(ydoc, scope) : null;
    await saveFile(new Blob([jsonToFountain(scriptBlocks(), titlePage)], { type: 'text/plain' }), 'fountain');
    setOpen(false);
  };
  const exportFdx = async () => {
    const titlePage = ydoc ? getTitlePage(ydoc, scope) : null;
    await saveFile(new Blob([jsonToFdx(scriptBlocks(), titlePage)], { type: 'application/xml' }), 'fdx');
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
          <button role="menuitem" onClick={exportPDF}>
            {docMode === 'screenplay' ? 'Export PDF' : 'Print / Save as PDF'}
          </button>
        </div>
      )}
    </span>
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}

// Print an HTML document via a hidden same-origin iframe and tear it down once
// printing finishes. Prints ONLY the iframe's content, and avoids window.open
// entirely — no popup blocker, and no window.open(...,'noopener') === null
// gotcha (which silently no-op'd the old popup-print path). Resolves when done.
function printHtmlViaIframe(html) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try { document.body.removeChild(iframe); } catch (_) {}
      resolve();
    };
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) { cleanup(); return; }
      const doPrint = () => {
        try { win.focus(); win.print(); } catch (_) {}
        try { win.onafterprint = cleanup; } catch (_) {}
        setTimeout(cleanup, 60000); // safety net if afterprint never fires
      };
      // Wait for fonts so Courier/serif metrics are correct before printing.
      const fr = win.document.fonts && win.document.fonts.ready;
      if (fr && typeof fr.then === 'function') fr.then(() => setTimeout(doPrint, 50)).catch(() => setTimeout(doPrint, 300));
      else setTimeout(doPrint, 300);
    };
    document.body.appendChild(iframe);
    iframe.srcdoc = html;
  });
}
