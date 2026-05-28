// Web worker that runs Y.Doc decode for sub-board previews off the main
// thread. Round 15 — see plans/i-m-having-issues-where-wise-dove.md.
//
// Each sub-board tile on a canvas-mode parent (like "Marketing") used to
// pay 50-300ms of synchronous Y.applyUpdate + readCards on the main
// thread during cold loads. With 10 tiles that's enough freeze to block
// pan/zoom. Decoding here in a worker frees the main thread; the React
// tree still renders the SVG on main but the heavy CPU step is gone.
//
// Messages from main thread:
//   { type: 'decode', requestId, b64 }
//     Decode a snapshot. Returns { type: 'decoded', requestId, ok,
//     data, workerMs, error? }.
//
// `data` matches what useBoardPreview.fetchPreview's inline path
// returned before — same field shape, so the downstream BoardThumbnail
// + ThumbImage + R2 pre-warm code paths are unchanged.

import * as Y from 'yjs';
import { b64ToBytes, readCards } from './yhelpers.js';
import { readDocSummary } from './docState.js';

function decode(b64) {
  const t0 = performance.now();
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, b64ToBytes(b64));
  const docSummary = readDocSummary(ydoc);
  const data = {
    cards: readCards(ydoc),
    arrows: ydoc.getArray('arrows').toArray().map(a => (a && a.toJSON) ? a.toJSON() : a),
    strokes: ydoc.getArray('strokes').toArray().map(s => (s && s.toJSON) ? s.toJSON() : s),
    docPages: docSummary.pages,
    docText: docSummary.firstText,
    docFirstPageName: docSummary.firstPageName,
  };
  ydoc.destroy();
  return { data, workerMs: performance.now() - t0 };
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type !== 'decode') return;
  const { requestId, b64 } = msg;
  try {
    const { data, workerMs } = decode(b64);
    self.postMessage({ type: 'decoded', requestId, ok: true, data, workerMs });
  } catch (e) {
    self.postMessage({
      type: 'decoded',
      requestId,
      ok: false,
      error: (e && e.message) ? e.message : String(e),
    });
  }
};
