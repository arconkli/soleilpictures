// slowReportCache.js — an hour's reuse for the admin reports that cost the
// database the most (admin_return_fixed_horizon, admin_activity_heatmap; each
// spills about 100 MB to disk). Their numbers move once a day, so the
// Overview's 5-minute poll and its refetch on window focus should not pay for
// them again. Results live in a module Map and in sessionStorage, so a page
// reload inside the hour reuses them too.

const PREFIX = 'slowReport:';
const mem = new Map();      // key -> { at, value }
const loading = new Map();  // key -> in-flight promise

function defaultStore() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

function read(key, store) {
  try {
    const raw = store && store.getItem(PREFIX + key);
    if (!raw) return null;
    const held = JSON.parse(raw);
    return held && typeof held.at === 'number' && 'value' in held ? held : null;
  } catch { return null; }
}

function write(key, held, store) {
  try { if (store) store.setItem(PREFIX + key, JSON.stringify(held)); } catch { /* full or blocked: the Map still holds it */ }
}

/**
 * `loader()` is called on a miss or an expired entry. Its result is stored only
 * when it did not reject and carries no `error` (a supabase `{ data, error }`).
 */
export function cachedReport(name, args, loader, { ttlMs = 3_600_000, store = defaultStore(), now = Date.now } = {}) {
  const key = name + JSON.stringify(args ?? null);
  const t = now();

  let held = mem.get(key);
  if (!held || t - held.at >= ttlMs) {
    held = read(key, store);
    if (held && t - held.at < ttlMs) mem.set(key, held);
  }
  if (held && t - held.at < ttlMs) return Promise.resolve(held.value);

  if (loading.has(key)) return loading.get(key);
  const p = (async () => {
    try {
      const value = await loader();
      if (!(value && value.error)) {
        const entry = { at: now(), value };
        mem.set(key, entry);
        write(key, entry, store);
      }
      return value;
    } finally {
      loading.delete(key);
    }
  })();
  loading.set(key, p);
  return p;
}

/** Drop every held report, here and in sessionStorage: the manual refresh. */
export function forgetReports(store = defaultStore()) {
  mem.clear();
  try {
    if (!store) return;
    const keys = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch { /* nothing to clear */ }
}

// For tests: a reload empties the Map but not sessionStorage.
export function _dropMemory() { mem.clear(); loading.clear(); }
