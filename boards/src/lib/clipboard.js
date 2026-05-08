// In-memory clipboard for cards. Survives within a tab session; not synced
// across tabs/devices (browser system clipboard for arbitrary card data is
// fiddly and we don't need it for the demo).

import { prefetchClipboardPayload } from './prefetchKinds.js';

let _items = [];
let _origin = null; // optional source-board id (informational)

export function setClipboard(items, originBoardId = null) {
  _items = items.map(c => ({ ...c })); // shallow clone
  _origin = originBoardId;
  // Warm any boards / images referenced by the clipboard so paste
  // targets are decoded by the time the user hits ⌘V.
  try { prefetchClipboardPayload(_items); } catch (_) {}
}

export function getClipboard() {
  return _items.map(c => ({ ...c }));
}

export function clipboardSize() { return _items.length; }
export function clipboardOrigin() { return _origin; }
