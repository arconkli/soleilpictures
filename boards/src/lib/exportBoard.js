// Board export helpers — PNG (via the existing BoardThumbnail SVG)
// and PDF (via browser print dialog).
//
// PNG path: serialize the live `.bc-thumb` SVG (or any provided node),
// draw it onto a backing canvas at a chosen scale, and trigger a
// download.
//
// PDF path: open a fresh window with a print-only stylesheet around
// the same SVG and call window.print() so the user can "Save as PDF."
// Avoids adding a heavy dep just for export.

function svgToString(svg) {
  // Inline computed styles so the snapshot survives outside of our
  // global stylesheet. This is intentionally a thin best-effort —
  // text and rect/line/path/image attributes already cover most of
  // what BoardThumbnail renders.
  const clone = svg.cloneNode(true);
  const xml = new XMLSerializer().serializeToString(clone);
  // Ensure xmlns is present (XMLSerializer drops it on detached nodes).
  return xml.includes('xmlns="http://www.w3.org/2000/svg"')
    ? xml
    : xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}

// Triggers a download of `name` containing `blob`.
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} URL.revokeObjectURL(url); }, 0);
}

// Render an SVG element to a PNG Blob at the requested width.
export function svgToPngBlob(svg, { width = 2400, padding = 24, bg = '#0a0a0c' } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const xml = svgToString(svg);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const aspect = (img.naturalHeight || 1) / (img.naturalWidth || 1);
        const canvasW = width;
        const canvasH = Math.max(1, Math.round(width * aspect));
        const canvas = document.createElement('canvas');
        canvas.width = canvasW + padding * 2;
        canvas.height = canvasH + padding * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, padding, padding, canvasW, canvasH);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Failed to encode PNG'));
          resolve(blob);
        }, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG failed to load as image')); };
      img.src = url;
    } catch (err) { reject(err); }
  });
}

// Download a board snapshot as a PNG. `boardName` is used for the filename.
// `svg` is a BoardThumbnail-rendered <svg> node (or any SVG of the canvas).
export async function exportBoardAsPng(svg, boardName) {
  const blob = await svgToPngBlob(svg, { width: 2400 });
  const safe = (boardName || 'board').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  downloadBlob(blob, `${safe}.png`);
}

// Open a print window with the SVG sized to the page so the user can
// "Save as PDF." Browsers don't let us produce a PDF directly without
// a third-party dep; the print dialog is the next-best UX.
export function exportBoardAsPdf(svg, boardName) {
  const xml = svgToString(svg);
  const safe = (boardName || 'board').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) { throw new Error('Please allow pop-ups for export.'); }
  w.document.open();
  w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safe}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    html, body { margin: 0; padding: 0; background: #0a0a0c; color: #f5f5f6; }
    .wrap { display: grid; place-items: center; min-height: 100vh; padding: 24px; }
    svg { width: 100%; height: auto; max-width: 100%; }
    @media print {
      html, body { background: white; color: #0a0a0c; }
      .wrap { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="wrap">${xml}</div>
  <script>setTimeout(() => { window.focus(); window.print(); }, 250);</script>
</body>
</html>`);
  w.document.close();
}
