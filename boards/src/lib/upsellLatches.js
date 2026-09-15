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

// In-memory fallback for browsers where localStorage throws (private mode,
// blocked site data). Without it markPriceSeen reads "not yet" and writes
// nothing on EVERY call, so it reports a first impression every time and its
// callers fire an analytics row and a profile write on each render pass. The
// fallback keeps the latch honest for the life of the page; a reload legitimately
// forgets, which is the same bargain the durable stamp already makes.
const memo = new Set();
const memoWarn = new Map();

function read(key, storage) {
  try { return store(storage)?.getItem(key) ?? null; } catch { return null; }
}
function write(key, value, storage) {
  try { store(storage)?.setItem(key, value); } catch { /* ignore */ }
}

// Has this account been shown a price on this device?
export function priceSeen(uid, storage) {
  if (!uid) return false;
  const k = PRICE_SEEN_KEY(uid);
  return read(k, storage) != null || memo.has(k);
}

// Stamp the first time a price is shown. Returns true ONLY on the first call
// for this account on this device, so the caller can log the event once and
// stamp the profile once without keeping its own bookkeeping.
export function markPriceSeen(uid, surface, storage) {
  if (!uid) return false;
  if (priceSeen(uid, storage)) return false;
  const k = PRICE_SEEN_KEY(uid);
  // Claim in memory FIRST, so the latch holds even when the write below is
  // swallowed by a storage that throws.
  memo.add(k);
  write(k, JSON.stringify({ at: new Date().toISOString(), surface: String(surface || '') }), storage);
  return true;
}

// The limit this account was last warned about approaching, or 0 for never.
export function nearCapWarnedAt(uid, storage) {
  if (!uid) return 0;
  const raw = read(NEAR_CAP_KEY(uid), storage);
  const n = Number(raw ?? memoWarn.get(NEAR_CAP_KEY(uid)));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function markNearCapWarned(uid, limit, storage) {
  const n = Number(limit);
  if (!uid || !Number.isFinite(n) || n <= 0) return;
  memoWarn.set(NEAR_CAP_KEY(uid), n);
  write(NEAR_CAP_KEY(uid), String(n), storage);
}

// Test seam: the in-memory fallbacks are module state, so a test that wants a
// fresh device has to say so.
export function __resetUpsellLatches() { memo.clear(); memoWarn.clear(); }
