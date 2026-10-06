// hints.js — the discipline for failure-triggered hints. Pure, node-testable.
//
// The product-education pass (2026-10-06) found that teaching features ahead
// of time moves nothing, and that the how-to failures people actually have are
// small and specific: a picker opened and cancelled on an empty board, a new
// cluster left as "Untitled cluster" (most of them are), a search that found
// nothing. A hint here fires only when one of those just happened, says the one
// thing that fixes it, and is then over:
//
//   * once per kind per device (localStorage; a read failure counts as SEEN, so
//     a browser with broken storage never nags — the powerReveals discipline)
//   * never while the tour is showing (its pill owns the screen)
//   * never two at once (claimHint/releaseHint — module scope, page lifetime)
//
// Each is graded on its own conversion, hint_shown → hint_acted, and never on
// return. The copy lives beside the surface that shows it.

export const HINT_KINDS = Object.freeze(['paste', 'name_cluster']);

// A new cluster that still carries its default name a minute later is one
// nobody will find again. A minute, not ten seconds: people often place the
// box, go and collect what goes in it, and name it last.
export const NAME_CLUSTER_AFTER_MS = 60_000;

const KEY = 'soleil.hint.';

export function hintSeen(kind) {
  try { return localStorage.getItem(KEY + kind) === '1'; } catch (_) { return true; }
}

export function markHintSeen(kind) {
  try { localStorage.setItem(KEY + kind, '1'); } catch (_) {}
}

// The tour's pill is the one surface allowed to interrupt; both variants stamp
// the body (data-tour-active for the locking tour, data-tour-variant for all).
export function tourShowing(doc = typeof document !== 'undefined' ? document : null) {
  const ds = doc?.body?.dataset;
  if (!ds) return false;
  return ds.tourActive === '1' || !!ds.tourVariant;
}

export function isDefaultClusterName(name) {
  const s = String(name ?? '').trim().toLowerCase();
  return !s || s === 'untitled cluster' || s === 'untitled list' || s === 'new cluster' || s === 'untitled';
}

// Deps are injectable so the gate is testable without a DOM or storage.
export function canShowHint(kind, { seen = hintSeen, tour = tourShowing } = {}) {
  if (!HINT_KINDS.includes(kind)) return false;
  if (seen(kind)) return false;
  if (tour()) return false;
  return true;
}

// One hint on screen at a time. The claim belongs to a kind; the same kind may
// re-claim (a re-render is not a second hint) and only the holder may release.
let up = null;

export function claimHint(kind) {
  if (!HINT_KINDS.includes(kind)) return false;
  if (up && up !== kind) return false;
  up = kind;
  return true;
}

export function releaseHint(kind) {
  if (up === kind) up = null;
}

export function hintUp() { return up; }

export function __resetHints() { up = null; }
