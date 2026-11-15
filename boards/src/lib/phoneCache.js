// phoneCache.js — a small keyed read cache for the phone admin panel. Pure and
// node-testable: the clock is injected, nothing here knows about React or
// Supabase.
//
//   const cache = createCache();
//   const { data, error, at, stale } = await cache.get('growth', fetcher, { ttl: 0 });
//
// fetcher() resolves { data } or { error } (the shape supabase.rpc resolves to)
// or throws. Rules:
//   * one in-flight fetch per key: concurrent callers share its promise;
//   * a stored value younger than ttl (ms) is returned without fetching, unless
//     force; ttl 0 always fetches;
//   * a failed fetch never wipes a good value: it resolves the LAST GOOD data
//     with `error` set and stale true. With nothing stored yet it resolves
//     data null, the error, stale false (there is nothing to be stale);
//   * seed(key, data, at) puts in a value from the last visit (the panel paints
//     it at once) only when nothing is stored for the key. A seed is never
//     fresh: get() always fetches over it, whatever the ttl, and peek() marks
//     it `seeded`. A good fetch replaces it; a failed one keeps it, resolved
//     with the error and stale true like any last good value;
//   * clear() forgets everything, seeds too, and a fetch that was already in
//     flight settles without writing back.

export function createCache({ now = () => Date.now() } = {}) {
  const store = new Map();     // key -> { data, at, seeded }
  const inflight = new Map();  // key -> Promise
  let generation = 0;

  async function run(key, fetcher) {
    const gen = generation;
    let res = null;
    let error = null;
    try {
      res = await fetcher();
      if (res && res.error) error = res.error;
    } catch (e) {
      error = e || new Error('fetch failed');
    }
    if (!error) {
      const at = now();
      const data = res ? (res.data === undefined ? null : res.data) : null;
      if (gen === generation) store.set(key, { data, at, seeded: false });
      return { data, error: null, at, stale: false };
    }
    const last = store.get(key);
    if (last) return { data: last.data, error, at: last.at, stale: true };
    return { data: null, error, at: null, stale: false };
  }

  function get(key, fetcher, { ttl = 0, force = false } = {}) {
    const held = store.get(key);
    if (!force && ttl > 0 && held && !held.seeded && now() - held.at < ttl) {
      return Promise.resolve({ data: held.data, error: null, at: held.at, stale: false });
    }
    const running = inflight.get(key);
    if (running) return running;
    const p = run(key, fetcher).finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
    inflight.set(key, p);
    return p;
  }

  /** The stored value, { data, at, seeded }, or null. Never fetches. */
  function peek(key) {
    const held = store.get(key);
    return held ? { data: held.data, at: held.at, seeded: !!held.seeded } : null;
  }

  /** A value from the last visit. True when it was put in; false when the key already holds something. */
  function seed(key, data, at) {
    if (store.has(key) || data == null) return false;
    store.set(key, { data, at: typeof at === 'number' ? at : null, seeded: true });
    return true;
  }

  function clear() {
    generation += 1;
    store.clear();
    inflight.clear();
  }

  return { get, peek, seed, clear };
}
