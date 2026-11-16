// popupPace — fewer unasked-for pop-ups for people who come back a lot.
//
// The owner's words (2026-11-15): "maybe chill on the random pop ups especially
// for people who have been back a bunch". Pure and node-testable: no React, no
// DOM. upsellSlot.js, hints.js, CanvasSurface.jsx and App.jsx read it.
//
// daysBack is the number of separate earlier UTC days the signed-in person used
// the app (the my_days_back() RPC, 0900). null means unknown -- not loaded yet,
// the call failed, the migration is not applied -- and EVERYTHING then behaves
// exactly as it did before this module: it fails open.
//
//   regular      daysBack >= 5 (REGULAR_DAYS)
//   past day one daysBack >= 1
//
// Rules:
//   1. Regulars get no tips: the slot kinds in TIP_SLOT_KINDS and the hint kinds
//      in TIP_HINT_KINDS are refused. Setup, re-asks, board_more and profile_ask
//      are untouched.
//   2. Regulars get at most ONE ask per 7 days between the three ASK_KINDS (each
//      keeps its own limits too). The time of the last ask is noted for
//      EVERYONE, and kept in profile settings (asks_last_at) so phone and
//      computer share it.
//   3. Past day one the ambient "visit" is the UTC day, not the 30-minute app
//      session (dayVisit); see upsellSlot.js.
//   4. The "add images" dock is an ambient kind only past day one (depthDockGate).
//
// Money surfaces (first-value, cap-toast, cap-hit, storage-gate, pricing-intent,
// upgrade-reason) and return-reason / resume are never read here: a running
// pricing test depends on them behaving as they always did.

export const REGULAR_DAYS = 5;
export const ASK_GAP_MS = 7 * 24 * 60 * 60 * 1000;

export const ASK_KINDS = Object.freeze(['invite-nudge', 'share-ask', 'layout-ask']);
export const TIP_SLOT_KINDS = Object.freeze(['power-reveal', 'mix-prompt', 'depth-dock', 'whats-new']);
export const TIP_HINT_KINDS = Object.freeze(['paste', 'name_cluster', 'studio_bar', 'whats_new']);

// Number(null) is 0 and 0 is finite, so only a real number may pass.
function cleanDays(v) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
  return v;
}

function cleanAt(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? v : (typeof v === 'string' ? Date.parse(v) : NaN);
  return Number.isFinite(t) ? t : null;
}

// ready is false only while a bound person's day count is still loading (see
// bindPaceUser); unbound, it is true, so nothing waits and nothing changes.
let snap = Object.freeze({ daysBack: null, lastAskAt: null, onAsk: null, ready: true });
let boundUid;
const subs = new Set();

// The same object until something changes: useSyncExternalStore compares by
// reference, and a fresh object per call would re-render forever.
export function getPace() { return snap; }

export function subscribePace(fn) {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

function commit(next) {
  if (next.daysBack === snap.daysBack && next.lastAskAt === snap.lastAskAt && next.onAsk === snap.onAsk && next.ready === snap.ready) return;
  snap = Object.freeze(next);
  for (const fn of [...subs]) { try { fn(); } catch (_) {} }
}

export function setPace(patch) {
  if (!patch || typeof patch !== 'object') return;
  const next = { ...snap };
  if (patch.daysBack !== undefined) next.daysBack = cleanDays(patch.daysBack);
  if (patch.lastAskAt !== undefined) {
    const t = cleanAt(patch.lastAskAt);
    // Never backwards: another device's older stamp must not reopen the week.
    if (t !== null && (next.lastAskAt === null || t > next.lastAskAt)) next.lastAskAt = t;
  }
  if (typeof patch.onAsk === 'function') next.onAsk = patch.onAsk;
  if (patch.ready === true) next.ready = true;
  commit(next);
}

// Bind the pace to a person. A different person never inherits the last one's
// day count or last-ask time; a signed-in person starts not ready, so the dock
// waits for the day count. Module-level, not a per-mount ref: the workspace
// unmounts on sign-out, so a ref never saw the next person arrive.
export function bindPaceUser(uid) {
  if (uid === boundUid) return;
  boundUid = uid;
  commit({ daysBack: null, lastAskAt: null, onAsk: null, ready: uid ? false : true });
}

// Back to nobody bound: nothing of the last person may pace the next.
export function resetPace() {
  boundUid = undefined;
  commit({ daysBack: null, lastAskAt: null, onAsk: null, ready: true });
}
export function __resetPace() { resetPace(); }

export function isRegular(daysBack) {
  return typeof daysBack === 'number' && Number.isFinite(daysBack) && daysBack >= REGULAR_DAYS;
}

export function pastDayOne(daysBack) {
  return typeof daysBack === 'number' && Number.isFinite(daysBack) && daysBack >= 1;
}

// null = not refused; 'tip' = a tip for a regular; 'pace' = an ask inside the
// week. A negative elapsed time (clock skew) never refuses: suppressing a
// surface is the more expensive mistake.
export function paceRefuses(kind, { now = Date.now(), pace = getPace() } = {}) {
  if (!isRegular(pace.daysBack)) return null;
  if (TIP_SLOT_KINDS.includes(kind)) return 'tip';
  if (ASK_KINDS.includes(kind) && pace.lastAskAt !== null) {
    const elapsed = now - pace.lastAskAt;
    if (elapsed >= 0 && elapsed < ASK_GAP_MS) return 'pace';
  }
  return null;
}

export function hintRefused(kind, pace = getPace()) {
  return isRegular(pace.daysBack) && TIP_HINT_KINDS.includes(kind);
}

export function dayVisit(now = Date.now()) {
  return 'day:' + new Date(now).toISOString().slice(0, 10);
}

// 'wait' until the person's day count has loaded (or the fallback timer gave
// up), so a regular never sees the dock appear and vanish and depth_dock_shown
// is never logged for someone the rule hides it from; then 'hide' for a
// regular, 'claim' past day one, 'free' on day one or unknown (the dock shows
// exactly as before, with no claim).
export function depthDockGate(pace = getPace()) {
  if (pace.ready === false) return 'wait';
  if (isRegular(pace.daysBack)) return 'hide';
  if (pastDayOne(pace.daysBack)) return 'claim';
  return 'free';
}

export function noteAsk(kind, now = Date.now()) {
  if (!ASK_KINDS.includes(kind)) return;
  const t = cleanAt(now);
  if (t === null) return;
  setPace({ lastAskAt: t });
  const cb = snap.onAsk;
  if (!cb) return;
  try { cb(new Date(t).toISOString()); } catch (_) {}
}
