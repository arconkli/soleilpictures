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

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover } from '../hooks/useAnchoredPopover.js';
import { collectFullDocHtml, collectFullDocMarkdown, jsonToMarkdown, collectFullDocJSON } from '../lib/docFullExport.js';
import {
  jsonToFountain, jsonToFdx, blocksToDocJSON, docJSONToBlocks,
} from '../lib/screenplayIO.js';
import { buildScreenplayPdfBlob } from '../lib/screenplayPdf.js';
import { parseScriptText } from '../lib/scriptImport.js';
import { deliverFile } from '../lib/exportDelivery.js';
import { Capacitor } from '@capacitor/core';
import { docPrintCSS } from '../lib/docTypography.js';
import { getTitlePage, setTitlePage, getSceneNumbersShow } from '../lib/docState.js';
import { useFeedback } from './AppFeedback.jsx';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// Inside the iOS / Android app the WebView has no window.print(): a print
// never opens a dialog and afterprint never fires.
const inNativeApp = () => {
  try { return !!Capacitor?.isNativePlatform?.(); } catch (_) { return false; }
};

// Whole-doc export. When ydoc+scope are provided we serialize EVERY page ×
// EVERY sheet (the single-focused-sheet path was silent data loss); the bare
// `editor` is only a fallback for the rare caller without doc state.
// Screenplay docs additionally get Fountain/FDX export + import.
export function DocExportMenu({ editor, docName, ydoc = null, scope = null, docMode = 'doc', canEdit = true }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);      // trigger wrapper
  const { exportHTML, exportMarkdown, exportPDF, exportFountain, exportFdx, importScript, pdfLabel } =
    useDocExport({ editor, docName, ydoc, scope, docMode, onDone: () => setOpen(false) });

  // The toolbar (.doc-tb) is a horizontal scroll container (overflow:auto/hidden),
  // which CLIPS any absolutely-positioned descendant — that's why an inline
  // dropdown showed only as a sliver under the toolbar. So the menu renders
  // through a portal to <body>, under the button and lined up with its right
  // edge (hooks/useAnchoredPopover), and a press outside or Escape closes it.
  const pop = useAnchoredPopover({ open, onClose: () => setOpen(false), anchorRef: ref, align: 'end' });

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
      {open && createPortal(
        <div className="doc-export-menu" role="menu" ref={pop.popRef} style={pop.style}>
          {docMode === 'screenplay' && (
            <>
              <button role="menuitem" onClick={exportFountain}>Export Fountain (.fountain)</button>
              <button role="menuitem" onClick={exportFdx}>Export Final Draft (.fdx)</button>
              {/* Import replaces the script — a view-only reader's copy would
                  change locally and never save. */}
              {canEdit && <button role="menuitem" onClick={importScript}>Import Fountain / Final Draft…</button>}
              <div className="doc-export-sep" role="separator" />
            </>
          )}
          <button role="menuitem" onClick={exportHTML}>Export HTML</button>
          <button role="menuitem" onClick={exportMarkdown}>Export Markdown</button>
          <button role="menuitem" onClick={exportPDF}>{pdfLabel}</button>
        </div>,
        document.body
      )}
    </span>
  );
}

// What the export menu does, for any menu that offers it (the doc look's ⋯
// and a reader's Export, components/doc/DocBarA.jsx): each export runs once at
// a time, and onDone() closes the menu it was picked from. pdfLabel is what
// the PDF row says where it is (a share sheet in the app).
export function useDocExport({ editor, docName, ydoc = null, scope = null, docMode = 'doc', onDone }) {
  const [busy, setBusy] = useState(false);
  const feedback = useFeedback();

  // The document's display name — used for the file name AND the screenplay
  // title-page title. For a screenplay the real title lives on the title page
  // (the card is often left "Untitled doc"), so prefer that; fall back to the
  // doc/card name. Read fresh on each export so renaming mid-session is picked up.
  const currentDocTitle = () => {
    const tp = (docMode === 'screenplay' && ydoc) ? getTitlePage(ydoc, scope) : null;
    const fromTitlePage = (tp && tp.enabled && tp.title && tp.title.trim()) ? tp.title.trim() : '';
    return fromTitlePage || (docName && docName.trim()) || (docMode === 'screenplay' ? 'Screenplay' : 'document');
  };
  const sanitizeName = (s) => (String(s || 'document').replace(/[^a-z0-9-_ ]/gi, '_').trim().slice(0, 80) || 'document');
  const safeName = sanitizeName(currentDocTitle());

  // Deliver a generated blob: a download on web, the native share sheet inside
  // the app (where <a download> doesn't save). Surfaces a toast on failure.
  // Named after the document (computed fresh so a just-typed title is honored).
  // The shared delivery funnel for html / md / fountain / fdx — so those four
  // formats are counted in one place rather than at four call sites. The PDF
  // paths don't come through here (they branch on docMode) and log their own.
  const saveFile = async (blob, ext) => {
    try {
      await deliverFile(blob, `${sanitizeName(currentDocTitle())}.${ext}`);
      logEvent(EV.EXPORT_RUN, { format: ext === 'md' ? 'markdown' : ext, surface: 'doc', doc_mode: docMode });
    } catch (err) {
      console.error('[export] delivery failed', err);
      logEvent(EV.EXPORT_ERROR, { format: ext, surface: 'doc', reason: 'delivery_failed' });
      feedback.toast({ type: 'error', code: 'doc_export_failed', message: 'Export failed — please try again.' });
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
      onDone?.();
    } finally { setBusy(false); }
  };

  const exportMarkdown = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const md = ydoc ? await collectFullDocMarkdown(ydoc, scope)
                      : (editor ? jsonToMarkdown(editor.getJSON()) : '');
      await saveFile(new Blob([md], { type: 'text/markdown' }), 'md');
      onDone?.();
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
        const docTitle = currentDocTitle();
        const stored = ydoc ? getTitlePage(ydoc, scope) : null;
        // The writer's title page when they turned it on, and none when they
        // turned it off — the same rule Fountain and FDX follow. (A cover
        // used to be synthesized regardless, crediting whoever happened to
        // be exporting as the author.)
        const titlePage = (stored && stored.enabled) ? stored : null;
        const sceneNumbers = ydoc ? getSceneNumbersShow(ydoc, scope) : false;
        const blob = await buildScreenplayPdfBlob(docJSONToBlocks(scriptBlocks()), { title: docTitle, titlePage, sceneNumbers });
        await deliverFile(blob, `${sanitizeName(docTitle)}.pdf`);
      } else if (inNativeApp()) {
        // No print dialog in the app: hand over the same printable page
        // through the share sheet (Files / Safari can print it or save a
        // PDF) instead of a tap that did nothing and locked the menu for 60s.
        await deliverFile(new Blob([printableHTML(await fullBodyHtml())], { type: 'text/html' }), `${sanitizeName(currentDocTitle())}.html`);
      } else {
        // Prose docs print through a hidden same-origin iframe → the system
        // "Save as PDF". Avoids the popup path (popup blockers + the
        // window.open(...'noopener') === null gotcha that silently no-op'd).
        // Not awaited: the promise settles at afterprint (or a 60s safety
        // net), and the menu must close and the other exports stay usable
        // meanwhile — busy is released in finally below.
        printHtmlViaIframe(printableHTML(await fullBodyHtml()));
      }
      // Screenplay PDF is the most defensibly professional artifact the product
      // makes — industry format, real vector output — and it was invisible.
      logEvent(EV.EXPORT_RUN, { format: 'pdf', surface: 'doc', doc_mode: docMode });
      onDone?.();
    } catch (err) {
      console.error('[export] PDF failed', err);
      logEvent(EV.EXPORT_ERROR, { format: 'pdf', surface: 'doc', doc_mode: docMode, reason: 'threw' });
      feedback.toast({ type: 'error', code: 'doc_pdf_export_failed', message: 'Couldn’t export this document — please try again.' });
    } finally { setBusy(false); }
  };

  const scriptBlocks = () => {
    if (ydoc) return collectFullDocJSON(ydoc, scope);
    return editor ? editor.getJSON() : { type: 'doc', content: [] };
  };
  const exportFountain = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const titlePage = ydoc ? getTitlePage(ydoc, scope) : null;
      await saveFile(new Blob([jsonToFountain(scriptBlocks(), titlePage)], { type: 'text/plain' }), 'fountain');
      onDone?.();
    } finally { setBusy(false); }
  };
  const exportFdx = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const titlePage = ydoc ? getTitlePage(ydoc, scope) : null;
      await saveFile(new Blob([jsonToFdx(scriptBlocks(), titlePage)], { type: 'application/xml' }), 'fdx');
      onDone?.();
    } finally { setBusy(false); }
  };
  const importScript = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fountain,.txt,.fdx,application/xml,text/plain';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      let blocks, titlePage = null;
      try {
        // One parse path for every way a script arrives (lib/scriptImport.js):
        // a script dropped on the canvas must come out identical to one
        // imported here.
        ({ blocks, titlePage } = parseScriptText(await f.text(), f.name));
      } catch (err) {
        // A silent no-op here is indistinguishable from "the file was empty" —
        // the user picked a file and NOTHING happened. Say so.
        console.error('[import] screenplay parse failed', err);
        feedback.toast({ type: 'error', code: 'screenplay_read_failed', message: 'Couldn’t read that file — it doesn’t look like Fountain or Final Draft.' });
        return;
      }
      if (!blocks.length && !titlePage) {
        feedback.toast({ type: 'error', code: 'import_empty', message: 'Nothing importable found in that file.' });
        return;
      }
      if (editor) {
        // Replace the focused sheet's content. Undoable via ⌘Z; confirm only
        // when there's existing content to clobber.
        if (!editor.isEmpty && !window.confirm('Replace this document with the imported screenplay?')) return;
        editor.chain().focus().setContent(blocksToDocJSON(blocks)).run();
      }
      // Import the title page (enable it) — it lives in docMeta, not the editor.
      if (titlePage && ydoc) setTitlePage(ydoc, scope, { enabled: true, ...titlePage });
    };
    input.click();
    onDone?.();
  };

  return {
    busy, exportHTML, exportMarkdown, exportPDF, exportFountain, exportFdx, importScript,
    pdfLabel: docMode === 'screenplay' ? 'Export PDF' : inNativeApp() ? 'Share printable page' : 'Print / Save as PDF',
  };
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
