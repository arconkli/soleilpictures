// galleryState.js — the admin Surface Gallery flag store.
//
// The Surface Gallery renders any popup, banner, toast, empty state or screen
// in the app on demand, with fabricated props, so an admin can check that a
// surface looks right without arranging the account state that normally
// produces it. The trial offer needs a demo account with 13+ cards that has
// never trialed; the cap wall needs a real refusal from the server; the
// near-cap toast has fired four times in the product's history. None of those
// are things you can stage on a phone against production, which is exactly
// where they most need checking.
//
// Shaped after captureState.js on purpose, for the same reasons: zero imports,
// zero React, every reader on a hot path is a single boolean when off. The
// analytics stamp, claimUpsellSlot and startCheckout all consult this on paths
// that run constantly, so it has to stay a leaf module that `node --test`, the
// libs and App can each pull in cycle-free.
//
// ── The gate ───────────────────────────────────────────────────────────────
// Boots DISARMED. Every setter no-ops until armGallery(true), which App calls
// only for tier === 'admin' (server truth, via get_my_tier / is_admin()). The
// gate is therefore one testable predicate rather than a condition sprinkled
// through the UI, and `window` pokes from a non-admin console do nothing.
// Losing admin disarms and closes, so the gallery can never outlive the tier.
//
// ── What persists: NOTHING ─────────────────────────────────────────────────
// Not sessionStorage, not localStorage, not profiles.settings. Capture Mode
// persists because a reload mid-shoot has to resume; a gallery has no such
// need, and the failure mode of a stale flag here is much worse than a lost
// selection. isGalleryActive() suppresses analytics writes, bypasses the
// upsell mutex and refuses checkout — a flag that could survive a reload into
// a real working session would silently stop recording that session's events.
// Memory only means a reload is always a clean, real app.

const DEFAULTS = Object.freeze({
  open: false,      // the browser list is up
  entryId: null,    // the surface currently being previewed, null while browsing
});

let armed = false;
let state = DEFAULTS;
const listeners = new Set();

function _emit() {
  for (const fn of listeners) {
    try { fn(state); } catch (_) { /* a listener must never break the store */ }
  }
}

// ── Arming ─────────────────────────────────────────────────────────────────

// Called from one App effect on tier === 'admin'. Disarming resets, so a tier
// change mid-session can never leave a preview pinned over the real app.
export function armGallery(next) {
  const want = !!next;
  if (want === armed) return;
  armed = want;
  if (!armed) state = DEFAULTS;
  _emit();
}

export function isGalleryArmed() { return armed; }

// ── Reads ──────────────────────────────────────────────────────────────────
// Each folds in `armed`, so a caller never has to remember to check two things.

// True whenever the gallery owns the screen — browsing OR previewing. This is
// the predicate the write-guards use: analytics marks events synthetic,
// claimUpsellSlot always grants, the upgrade-prompt stamps no-op, and checkout
// refuses. Browsing counts, because a `toast` entry fires from the list.
export function isGalleryActive() { return armed && state.open; }

// True only while a surface is actually rendered. Drives the host.
export function isPreviewing() { return armed && state.open && !!state.entryId; }

// The whole blob, for React. Identity is stable between changes, so this is a
// valid useSyncExternalStore snapshot.
export function getGalleryState() { return state; }

// ── Writes ─────────────────────────────────────────────────────────────────

export function openGallery() {
  if (!armed || state.open) return;
  state = Object.freeze({ open: true, entryId: null });
  _emit();
}

// Closing always clears the previewed entry too — there is no "closed but still
// previewing" state to get stuck in.
export function closeGallery() {
  if (!armed || state === DEFAULTS) return;
  state = DEFAULTS;
  _emit();
}

// Show one surface. A null id returns to the list without closing the gallery,
// which is what the preview bar's back button does.
export function previewSurface(entryId) {
  if (!armed || !state.open) return;
  const next = entryId == null ? null : String(entryId);
  if (state.entryId === next) return;
  state = Object.freeze({ ...state, entryId: next });
  _emit();
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Test seam. `node --test` needs a way back to boot state between cases;
// nothing in the app calls this.
export function __resetGalleryState() {
  armed = false;
  state = DEFAULTS;
  listeners.clear();
}
