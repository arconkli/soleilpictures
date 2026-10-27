// Board export, from the canvas's right-click menu: Export → PNG image (a
// download) and PDF (the browser's print dialog, "Save as PDF").
//
// The picture is the board drawn by the covers' renderer, in the board's own
// frame (renderThumbnail.js renderBoardPng). It used to be a serialized <svg>
// out of a hidden BoardThumbnail, until BoardThumbnail started drawing an <img>
// (2026-05-27, 19cf625b): from then on there was no <svg> to find, and every
// export, of every board, said "Nothing to export."
//
// The PDF prints that picture from a hidden same-origin frame, as a document's
// PDF does (DocExportMenu's printHtmlViaIframe), not from a pop-up: drawing a
// board waits on its pictures, and a pop-up opened that long after the click
// is blocked.

import { renderBoardPng } from './renderThumbnail.js';
import { deliverFile } from './exportDelivery.js';
import { logEvent } from './analytics.js';
import { EV } from './analyticsEvents.js';

const safeName = (boardName) => (boardName || 'board').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

// board: { cards, strokes, arrows, boards, bgColor } → its PNG, or null when
// nothing is on it.
async function drawBoard(board, format) {
  try {
    return await renderBoardPng(board);
  } catch (err) {
    logEvent(EV.EXPORT_ERROR, { format, surface: 'canvas', reason: 'threw' });
    throw err;
  }
}

// Download a picture of the board as `boardName`.png. → false when there was
// nothing on it to draw.
export async function exportBoardAsPng(board, boardName) {
  const blob = await drawBoard(board, 'png');
  if (!blob) return false;
  await deliverFile(blob, `${safeName(boardName)}.png`);
  logEvent(EV.EXPORT_RUN, { format: 'png', surface: 'canvas' });
  return true;
}

// Open the print dialog on a page holding the picture, sized to the paper, so
// it can be saved as a PDF. → false when there was nothing on it to draw.
export async function exportBoardAsPdf(board, boardName) {
  const blob = await drawBoard(board, 'pdf');
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  logEvent(EV.EXPORT_RUN, { format: 'pdf', surface: 'canvas' });
  // Not awaited: it settles once printing is over, and the menu's caller is
  // done when the dialog is up.
  printInFrame(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeName(boardName)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    html, body { margin: 0; padding: 0; background: white; }
    img { display: block; max-width: 100%; max-height: 100vh; margin: 0 auto; }
  </style>
</head>
<body><img src="${url}" alt="" /></body>
</html>`).then(() => URL.revokeObjectURL(url));
  return true;
}

// Print a page from a hidden same-origin iframe, once it has loaded (its
// picture included), and take the frame down when printing is over. A frame's
// print() shows only its own page. srcdoc is set before the frame goes in: a
// frame inserted with neither src nor srcdoc fires load at once, for the blank
// page it starts with.
function printInFrame(html) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
    iframe.srcdoc = html;
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      iframe.remove();
      resolve();
    };
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) { cleanup(); return; }
      try { win.focus(); win.print(); } catch (_) {}
      try { win.onafterprint = cleanup; } catch (_) {}
      setTimeout(cleanup, 60000); // if afterprint never comes
    };
    document.body.appendChild(iframe);
  });
}
