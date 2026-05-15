// In-memory clipboard for cards. Survives within a tab session; not synced
// across tabs/devices (browser system clipboard for arbitrary card data is
// fiddly and we don't need it for the demo).

import { prefetchClipboardPayload } from './prefetchKinds.js';

let _items = [];
let _origin = null; // optional source-board id (informational)
let _copiedAt = 0;  // Date.now() of the last setClipboard call

export function setClipboard(items, originBoardId = null) {
  _items = items.map(c => ({ ...c })); // shallow clone
  _origin = originBoardId;
  _copiedAt = Date.now();
  // Warm any boards / images referenced by the clipboard so paste
  // targets are decoded by the time the user hits ⌘V.
  try { prefetchClipboardPayload(_items); } catch (_) {}
}

export function getClipboard() {
  return _items.map(c => ({ ...c }));
}

export function clipboardSize() { return _items.length; }
export function clipboardOrigin() { return _origin; }
export function clipboardCopiedAt() { return _copiedAt; }

// True when the internal clipboard is populated AND was set recently
// (within `staleMs`). The cap protects us from old in-memory state
// hijacking a paste long after the user has moved on. Default 5 min.
export function hasRecentInternalCopy(staleMs = 5 * 60 * 1000) {
  return _items.length > 0 && (Date.now() - _copiedAt) < staleMs;
}

export function clearClipboard() {
  _items = [];
  _origin = null;
  _copiedAt = 0;
}
