// In-memory clipboard for cards. Survives within a tab session; not synced
// across tabs/devices (browser system clipboard for arbitrary card data is
// fiddly and we don't need it for the demo).
//
// We also write a high-entropy "sentinel" string to the OS clipboard on every
// internal copy. On paste, the canvas checks if the OS clipboard still holds
// our sentinel — if so it's an internal-card paste; if anything else is there
// (URL, prose, image) the user copied something newer and that wins.

import { prefetchClipboardPayload } from './prefetchKinds.js';

let _items = [];
let _origin = null; // optional source-board id (informational)
let _copiedAt = 0;  // Date.now() of the last setClipboard call
let _sentinel = ''; // OS-clipboard marker that proves a paste is "our" copy

function makeSentinel(ts) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `soleil:clip:${ts}-${rand}`;
}

export function setClipboard(items, originBoardId = null) {
  _items = items.map(c => ({ ...c })); // shallow clone
  _origin = originBoardId;
  _copiedAt = Date.now();
  _sentinel = makeSentinel(_copiedAt);
  // Mark the OS clipboard so the paste handler can tell "internal copy
  // unchanged" from "user copied something newer in another app." Fire and
  // forget; if it rejects (no gesture, permission denied) we fall back to
  // checking the in-memory items in the paste handler.
  try {
    const p = navigator.clipboard?.writeText?.(_sentinel);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {}
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
export function getSentinel() { return _sentinel; }

// Exact-match against the current sentinel. High-entropy means accidental
// collision is effectively impossible.
export function matchesSentinel(text) {
  if (!_sentinel) return false;
  return typeof text === 'string' && text.trim() === _sentinel;
}

// Cheap check for "looks like one of our sentinels" — used to swallow stale
// sentinel strings (e.g., from a previous tab session) instead of turning
// them into a junk note card.
export function looksLikeSentinel(text) {
  return typeof text === 'string' && /^\s*soleil:clip:\S+\s*$/.test(text);
}

// True when the internal clipboard is populated AND was set recently
// (within `staleMs`). Used as a fallback in the paste handler for the rare
// case where `navigator.clipboard.writeText` failed silently above.
export function hasRecentInternalCopy(staleMs = 5 * 60 * 1000) {
  return _items.length > 0 && (Date.now() - _copiedAt) < staleMs;
}

export function clearClipboard() {
  _items = [];
  _origin = null;
  _copiedAt = 0;
  _sentinel = '';
}
