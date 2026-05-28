// Singleton client for the preview decode / serialize Web Worker.
//
// Round 15 spawned a worker for Y.Doc decode; Round 16 added a serialize
// path so the localStorage preview write doesn't block the main thread.
// Both callers (useBoardPreview for decode, yboard for serialize) share
// the same worker instance and the same RPC plumbing.
//
// The worker is spawned lazily on first call. Returns null from any
// helper if the worker can't be spawned, has crashed, or is broken —
// callers fall back to inline (main-thread) work in that case.

import PreviewDecodeWorker from './previewDecodeWorker.js?worker';

let _worker = null;
let _broken = false; // sticky after spawn / runtime failure
let _reqId = 1;
const _pending = new Map(); // requestId -> { resolve, reject, timeoutId }

function _getWorker() {
  if (_worker || _broken) return _worker;
  try {
    const w = new PreviewDecodeWorker();
    w.onmessage = (event) => {
      const msg = event.data || {};
      const entry = _pending.get(msg.requestId);
      if (!entry) return;
      _pending.delete(msg.requestId);
      clearTimeout(entry.timeoutId);
      if (msg.ok === false) {
        entry.reject(new Error(msg.error || 'preview worker reported failure'));
        return;
      }
      if (msg.type === 'decoded') {
        entry.resolve({ data: msg.data, workerMs: msg.workerMs });
      } else if (msg.type === 'serialized') {
        entry.resolve({ envelope: msg.envelope, workerMs: msg.workerMs });
      } else {
        entry.reject(new Error('unknown preview worker response: ' + msg.type));
      }
    };
    w.onerror = (e) => {
      console.warn('[perf] preview worker error', e?.message || e);
      _broken = true;
      try { w.terminate(); } catch (_) {}
      _worker = null;
      for (const [, entry] of _pending) {
        clearTimeout(entry.timeoutId);
        entry.reject(new Error('preview worker crashed'));
      }
      _pending.clear();
    };
    _worker = w;
  } catch (e) {
    // Worker constructor failed — no Worker support, hostile CSP, etc.
    console.warn('[perf] preview worker spawn failed; using inline paths', e?.message || e);
    _broken = true;
    _worker = null;
  }
  return _worker;
}

// Internal: shared promise/timeout/postMessage scaffolding.
function _rpc(postBody, timeoutMs, timeoutMsg) {
  const w = _getWorker();
  if (!w) return null;
  const requestId = _reqId++;
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (_pending.has(requestId)) {
        _pending.delete(requestId);
        reject(new Error(timeoutMsg));
      }
    }, timeoutMs);
    _pending.set(requestId, { resolve, reject, timeoutId });
    try {
      w.postMessage({ ...postBody, requestId });
    } catch (e) {
      _pending.delete(requestId);
      clearTimeout(timeoutId);
      reject(e);
    }
  });
}

// Decode a board's Y.Doc snapshot in the worker.
//   b64: base64-encoded snapshot bytes
//   timeoutMs: defaults to 10s
// Returns null if the worker can't be spawned at all (caller should
// inline-decode immediately); otherwise a Promise<{ data, workerMs }>
// that rejects on worker failure or timeout (caller should inline-decode).
export function decodeViaWorker(b64, timeoutMs = 10_000) {
  return _rpc({ type: 'decode', b64 }, timeoutMs, 'preview decode worker timeout');
}

// Serialize a preview-shaped object into the localStorage envelope
// string in the worker. data shape is { cards, arrows, strokes,
// docPages, docText }. Returns null or Promise<{ envelope, workerMs }>
// with the same conventions as decodeViaWorker.
export function serializeViaWorker(data, timeoutMs = 5_000) {
  return _rpc({ type: 'serialize', data }, timeoutMs, 'preview serialize worker timeout');
}
