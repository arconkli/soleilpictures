// adminSnapshot.js — the numbers from the admin's last visit, kept in this
// browser so admin paints them at once (marked "Updating…") while fresh ones
// load. Pure and node-testable: the storage and the clock are injected, and
// every storage access fails quietly (private mode, blocked storage, quota).

export const SNAP_PREFIX = 'adminSnap:';
export const SNAP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SNAP_MAX_CHARS = 400_000;

function defaultStore() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function storageKey(uid, key) {
  return SNAP_PREFIX + uid + ':' + key;
}

function drop(store, k) {
  try { store.removeItem(k); } catch { /* nothing to do */ }
}

/** { at, data } from the last visit, or null. */
export function readSnap(uid, key, { store = defaultStore(), now = Date.now } = {}) {
  if (!store || !uid || !key) return null;
  const k = storageKey(uid, key);
  let parsed;
  try {
    const raw = store.getItem(k);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== 1 || typeof parsed.at !== 'number') return null;
  if (now() - parsed.at > SNAP_MAX_AGE_MS) {
    drop(store, k);
    return null;
  }
  return { at: parsed.at, data: parsed.data };
}

/** True when stored. Too big or refused: the old entry goes too, so numbers that moved on never come back. */
export function writeSnap(uid, key, data, { store = defaultStore(), now = Date.now } = {}) {
  if (!store || !uid || !key || data === undefined) return false;
  const k = storageKey(uid, key);
  let json;
  try {
    json = JSON.stringify({ v: 1, at: now(), data });
  } catch {
    drop(store, k);
    return false;
  }
  if (typeof json !== 'string' || json.length > SNAP_MAX_CHARS) {
    drop(store, k);
    return false;
  }
  try {
    store.setItem(k, json);
    return true;
  } catch {
    drop(store, k);
    return false;
  }
}

/** Sign-out: every account's snapshots go. */
export function forgetSnaps({ store = defaultStore() } = {}) {
  if (!store) return;
  try {
    const keys = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (typeof k === 'string' && k.startsWith(SNAP_PREFIX)) keys.push(k);
    }
    for (const k of keys) drop(store, k);
  } catch { /* nothing to do */ }
}
