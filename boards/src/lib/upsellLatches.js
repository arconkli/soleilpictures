// upsellLatches — two once-per-account facts about the upgrade ask, kept
// device-local so they survive a reload without a server round-trip.
//
//   • priceSeen   — has THIS account ever been shown a price? The chip pill,
//                   the first-value banner and the near-cap toast used to
//                   carry no number at all, so "saw the price" and "saw an
//                   upgrade surface" were indistinguishable in the data; the
//                   reach read that motivated this ("how many people near the
//                   limit have seen the price?") could only be answered with
//                   the modal's pricing_view, which most of them never reached.
//   • nearCapWarned — the cap limit this account was last warned at. The
//                   approaching-limit toast is owed once per ceiling, and the
//                   add-path latch was per pageload, so a returning user parked
//                   just under the cap would either never be warned (the old
//                   rule needed an add) or be warned on every visit (a naive
//                   reconcile rule). Once per account per limit is the honest
//                   middle.
//
// Pure: storage is injected and every access is throw-safe, because Safari in
// private mode and the odd locked-down browser throw on localStorage. Read
// failure reads as "not yet", write failure is silent — a missed stamp costs
// one duplicate ask, never a crash on the canvas.

export const PRICE_SEEN_KEY  = (uid) => `soleil_price_seen_${uid}`;
export const NEAR_CAP_KEY    = (uid) => `soleil_nearcap_warned_${uid}`;

function store(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; } catch { return null; }
}

function read(key, storage) {
  try { return store(storage)?.getItem(key) ?? null; } catch { return null; }
}
function write(key, value, storage) {
  try { store(storage)?.setItem(key, value); } catch { /* ignore */ }
}

// Has this account been shown a price on this device?
export function priceSeen(uid, storage) {
  if (!uid) return false;
  return read(PRICE_SEEN_KEY(uid), storage) != null;
}

// Stamp the first time a price is shown. Returns true ONLY on the first call
// for this account on this device, so the caller can log the event once and
// stamp the profile once without keeping its own bookkeeping.
export function markPriceSeen(uid, surface, storage) {
  if (!uid) return false;
  if (priceSeen(uid, storage)) return false;
  write(PRICE_SEEN_KEY(uid), JSON.stringify({ at: new Date().toISOString(), surface: String(surface || '') }), storage);
  return true;
}

// The limit this account was last warned about approaching, or 0 for never.
export function nearCapWarnedAt(uid, storage) {
  if (!uid) return 0;
  const n = Number(read(NEAR_CAP_KEY(uid), storage));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function markNearCapWarned(uid, limit, storage) {
  const n = Number(limit);
  if (!uid || !Number.isFinite(n) || n <= 0) return;
  write(NEAR_CAP_KEY(uid), String(n), storage);
}
