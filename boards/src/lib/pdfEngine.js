// pdfEngine.js — lazy pdf.js wrapper.
//
// pdfjs-dist is ~400KB+; it must NEVER enter the main/entry bundle. This module
// is the SINGLE place pdf.js is imported, and it does so via a DYNAMIC import()
// so the whole library lands in its own lazy chunk. Both consumers reach it
// dynamically too:
//   - uploadPdf() (lib/uploads.js) → renders page 1 for the card thumbnail
//   - PdfViewer.jsx               → renders all pages in the fullscreen viewer
// uploads.js is imported by the eager app graph, so it MUST `import('./pdfEngine.js')`
// dynamically (never statically) or pdf.js would leak into the main chunk.
//
// Worker wiring: we resolve the worker URL via Vite's `?url` import (emits the
// worker as a separate hashed asset and hands back its URL). This is the
// reliable Vite pattern — the `new URL('…', import.meta.url)` form is the
// pdf.js#19519 trap that silently falls back to a main-thread "fake worker"
// (slow + a console warning). The `?url` import lives INSIDE this lazily-loaded
// module, so it doesn't pull anything into the eager graph.

// Vite resolves this to the emitted worker asset's URL string (cheap — no code).
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let _pdfjsPromise = null;

// Load pdf.js once and configure its worker. Returns the pdfjs module.
function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      try { pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl; } catch (_) {}
      return pdfjs;
    });
  }
  return _pdfjsPromise;
}

// Load a PDF document. `source` may be a URL string, an ArrayBuffer, or a
// Uint8Array. We pass a fresh copy of binary data because pdf.js transfers
// (neuters) the buffer it's given.
export async function loadPdfDocument(source) {
  const pdfjs = await getPdfjs();
  let params;
  if (typeof source === 'string') {
    params = { url: source };
  } else if (source instanceof ArrayBuffer) {
    params = { data: new Uint8Array(source.slice(0)) };
  } else if (source instanceof Uint8Array) {
    params = { data: source.slice(0) };
  } else {
    params = source; // already a getDocument params object
  }
  const task = pdfjs.getDocument(params);
  return task.promise; // PDFDocumentProxy
}

export function getPageCount(doc) {
  return doc?.numPages || 0;
}

// Render one page (1-based) into a fresh <canvas>. Pass either an explicit
// `scale` or a `targetWidth` (the scale is derived so the page is exactly that
// many CSS pixels wide). Returns the canvas (caller owns disposal).
export async function renderPageToCanvas(doc, pageNum, { scale = null, targetWidth = null, maxDim = 4096 } = {}) {
  const page = await doc.getPage(pageNum);
  let s = scale;
  if (s == null) {
    const base = page.getViewport({ scale: 1 });
    s = targetWidth ? targetWidth / base.width : 1;
  }
  let viewport = page.getViewport({ scale: s });
  // Guard against pathologically large render targets (huge page × high scale).
  const longest = Math.max(viewport.width, viewport.height);
  if (longest > maxDim) {
    s = s * (maxDim / longest);
    viewport = page.getViewport({ scale: s });
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  try { page.cleanup(); } catch (_) {}
  return canvas;
}

// Render a page's natural (scale-1) size, used by the viewer to size page
// placeholders before they're rendered.
export async function getPageViewport(doc, pageNum, scale = 1) {
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale });
  return { width: vp.width, height: vp.height };
}
