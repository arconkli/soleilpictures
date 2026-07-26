// Just-in-time power reveals — pure decision engine (no React / DOM so it can
// be node-tested directly, like journey.js / upsellMetrics.js).
//
// Upfront feature tours underperformed just-in-time discovery here — power
// TOLD is power ignored.
// These reveals surface one capability at the exact moment the user's own
// content makes it relevant (4 images → Grids; a crowded root → clusters; a
// full cluster → List-as-drive; a pile of notes → Docs; a dense board → ⌘K).
// Discipline: once-ever per reveal (localStorage, read-fail = seen), at most
// ONE reveal per session (sessionStorage — a reload must NOT re-arm), never
// while a tour is showing, and each reveal self-suppresses when the feature is
// already in use. Over several visits this drip-feeds one new power moment per
// return instead of a day-one lecture.
//
// The engine is count-based and kind-string-agnostic: the App wiring computes
// the per-kind counts from genuineCards(yb.cards) (seeds/showcase excluded)
// and hands them in, so these rules stay trivially node-testable.

export const POWER_REVEALS = [
  {
    // The visual wow — a resizable layout frame with snap-in cells. The copy
    // must not promise auto-snapping THEIR images: the action places a fresh
    // grid beside their content and they drag shots into its cells.
    key: 'grids',
    message: 'Try a Grid — a resizable frame with cells that snap your shots into a layout.',
    actionLabel: 'Try a Grid',
    eligible: (s) => s.imageCards >= 4 && s.gridCards === 0,
  },
  {
    // The organize AHA (nesting) — pitched on the root when it gets crowded.
    key: 'group',
    message: 'Boards nest infinitely — make a cluster and drag these cards in.',
    actionLabel: 'Make a cluster',
    eligible: (s) => s.isRoot && s.nonBoardCards >= 6 && s.clusterCards === 0,
  },
  {
    // The storage power (the old tour's closing pitch, relocated to the moment
    // a real cluster fills up). Root is group's territory — and the copy says
    // "cluster", so it only fires inside one.
    key: 'list_drive',
    message: 'This cluster is also a drive — flip to List and every file you added is right there.',
    actionLabel: 'Flip to List',
    eligible: (s) => !s.isRoot && s.nonBoardCards >= 4 && s.view === 'canvas' && !s.viewEverSwitched,
  },
  {
    // Long-form power for the writers.
    key: 'docs',
    message: 'Notes can grow into full docs — outlines, backlinks, comments, the works.',
    actionLabel: 'Start a doc',
    eligible: (s) => s.noteCards >= 3 && s.docCards === 0,
  },
  {
    // Search power once there is enough content for search to feel magic.
    key: 'palette',
    message: 'Find anything instantly — search every card and doc you’ve made.',
    actionLabel: 'Try it',
    eligible: (s) => s.totalGenuine >= 12,
  },
];

// Highest-priority eligible reveal the user hasn't seen, or null. `seen` is
// injected (App passes revealSeen; tests pass fakes).
export function pickReveal(signals, seen) {
  if (!signals) return null;
  for (const r of POWER_REVEALS) {
    if (seen?.(r.key)) continue;
    if (r.eligible(signals)) return r;
  }
  return null;
}

// ── persistence guards (momentumHint discipline: read-fail = seen/shown, so a
// broken-storage environment never nags) ─────────────────────────────────────

const KEY_PREFIX = 'soleil.reveal.';
const SESSION_KEY = 'soleil.revealSession';

export function revealSeen(key) {
  try { return localStorage.getItem(KEY_PREFIX + key) === '1'; } catch (_) { return true; }
}

export function markRevealSeen(key) {
  try { localStorage.setItem(KEY_PREFIX + key, '1'); } catch (_) {}
}

// One reveal per SESSION (per-tab lifetime including reloads — a reload must
// not turn the next reveal into a nag; the next real visit re-arms).
export function sessionRevealShown() {
  try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (_) { return true; }
}

export function markSessionRevealShown() {
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) {}
}

// Has this device EVER switched a board's view? Stamped by App's setView from
// now on (no historical back-fill exists — the reveal effect additionally
// self-immunizes anyone it observes already in list view). Read-fail = true:
// broken storage means "assume they know", never nag.
const VIEW_SWITCHED_KEY = 'soleil.viewSwitched';

export function viewEverSwitched() {
  try { return localStorage.getItem(VIEW_SWITCHED_KEY) === '1'; } catch (_) { return true; }
}

export function markViewSwitched() {
  try { localStorage.setItem(VIEW_SWITCHED_KEY, '1'); } catch (_) {}
}
