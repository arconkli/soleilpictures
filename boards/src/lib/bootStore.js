// bootStore — the reads lib/bootPrefetch.js started, until the app takes them.
//
// Each entry is one read's promise, for one account, started at a known time.
// The hook that would have made the read takes it instead, on its FIRST call
// only (a refetch after a write must never be served a read from before it),
// and a take is one-shot: a second mount of the same hook, or a StrictMode
// re-run, reads afresh. A decision that only needs the answer (which workspace
// does this person land in?) peeks at the settled value without taking it.
//
// Entries go stale after TTL_MS and are never served to another account.
// clearBoot() runs on sign-out.
//
// Pure apart from its own state; no imports (the entry chunk carries it).

export const BOOT_TTL_MS = 60_000;

const entries = new Map();   // key → { uid, startedAt, promise, settled, value, error, taken }

export function putBoot(key, uid, promise, now = Date.now()) {
  if (!key || !uid || !promise) return;
  const e = { uid, startedAt: now, promise, settled: false, value: undefined, error: undefined, taken: false };
  entries.set(key, e);
  promise.then(
    (value) => { e.settled = true; e.value = value; },
    (error) => { e.settled = true; e.error = error; },
  );
}

function live(key, uid, now) {
  const e = entries.get(key);
  if (!e) return null;
  if (now - e.startedAt > BOOT_TTL_MS) { entries.delete(key); return null; }
  return e.uid === uid ? e : null;
}

// Whether a read under this key was started for this account (taken or not).
export function hasBoot(key, uid, now = Date.now()) {
  return !!live(key, uid, now);
}

// { promise, startedAt } for the first caller, then null. `share` hands the
// same read to every caller instead, for a read that two parts of the boot
// both make and that cannot have moved in between: a workspace's root, which
// useWorkspace and App.jsx's root effect each ask for when the memberships
// land before the personal-workspace RPC.
export function takeBoot(key, uid, now = Date.now(), { share = false } = {}) {
  const e = live(key, uid, now);
  if (!e || (e.taken && !share)) return null;
  if (!share) e.taken = true;
  return { promise: e.promise, startedAt: e.startedAt };
}

// The settled answer without taking it: { value } or { error }, or null while
// it is still in flight (or was never started).
export function peekBootSettled(key, uid, now = Date.now()) {
  const e = live(key, uid, now);
  if (!e || !e.settled) return null;
  return e.error !== undefined ? { error: e.error } : { value: e.value };
}

export function clearBoot() {
  entries.clear();
}
