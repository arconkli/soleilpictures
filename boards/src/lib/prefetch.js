// Central prefetch scheduler.
//
// Three lanes:
//   high   — fired by user intent (hover, focus, click-imminent).
//            Runs immediately, jumps any in-flight queue.
//   normal — fired by hover-on-list rows. Same path as high; the
//            distinction matters only for the per-kind layer (e.g.,
//            fetchPriority hints on prefetchImage).
//   idle   — background warming during requestIdleCallback windows.
//            Drained one at a time while the browser has spare time.
//            Killed on first user interaction.
//
// Dedup: identical keys in-flight share a single Promise. Completed
// results live in a small TTL map (default 30s) for the few cases we
// don't already cache somewhere else (the caller can pass cacheTtl: 0
// to delegate caching entirely to the underlying API — useful when the
// underlying lib already maintains a cache, e.g., r2.js for image URLs).

const inFlight = new Map();   // key → Promise
const cache    = new Map();   // key → { value, expiresAt }
const idleQueue = [];
let idleScheduled = false;
let idleStopped = false;

// Logging — toggle by running `window.__SOLEIL_PREFETCH_DEBUG__ = false`
// in the console. Default ON so it's easy to verify the infra is doing
// something. Stats are tallied so a single summary line on first
// interaction shows the real win.
const stats = { fetched: 0, hits: 0, idleWarmed: 0, hoverFired: 0 };
function dbg() {
  if (typeof window === 'undefined') return false;
  return window.__SOLEIL_PREFETCH_DEBUG__ !== false;
}
function log(...args) {
  if (dbg()) console.log('%c[prefetch]', 'color:#a3854b;font-weight:600', ...args);
}
export function prefetchStats() { return { ...stats }; }
if (typeof window !== 'undefined') {
  window.__soleilPrefetchStats = prefetchStats;
}

const ric = (typeof window !== 'undefined' && window.requestIdleCallback)
  ? window.requestIdleCallback.bind(window)
  : (cb) => setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: false }), 200);

export function prefetch(key, fetcher, { lane = 'normal', cacheTtl = 30_000 } = {}) {
  if (lane === 'idle') {
    // Don't enqueue if already cached or in-flight — saves the idle
    // queue from growing with redundant work.
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    if (inFlight.has(key)) return inFlight.get(key);
    idleQueue.push({ key, fetcher, cacheTtl });
    scheduleIdle();
    return Promise.resolve(null);
  }

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    log(`HIT  ${key} (cached)`);
    return Promise.resolve(cached.value);
  }
  if (inFlight.has(key)) {
    log(`HIT  ${key} (in-flight share)`);
    return inFlight.get(key);
  }

  const startedAt = performance.now();
  log(`MISS ${key} (lane=${lane}) — fetching`);
  stats.fetched++;
  if (lane === 'high') stats.hoverFired++;

  const p = (async () => {
    try {
      const value = await fetcher();
      if (cacheTtl > 0) cache.set(key, { value, expiresAt: Date.now() + cacheTtl });
      const ms = (performance.now() - startedAt).toFixed(0);
      log(`DONE ${key} in ${ms}ms`);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

// Synchronous read — returns the cached value if present and unexpired,
// else null. Used by code paths that want to consume a hover-warmed
// result without awaiting (e.g., yboard cold-load).
export function peek(key) {
  const c = cache.get(key);
  if (c && c.expiresAt > Date.now()) {
    stats.hits++;
    log(`✓ CONSUMED ${key} (hover-warmed cache hit, total hits=${stats.hits})`);
    return c.value;
  }
  return null;
}

// Manually invalidate. Called when we know a value has changed
// upstream (board snapshot saved, image replaced, etc.).
export function invalidate(key) {
  cache.delete(key);
}

// Stop the idle queue. Wired to the first real interaction so we
// don't waste bandwidth pre-warming boards the user is no longer
// going to visit.
export function firstInteraction() {
  if (idleStopped) return;
  idleStopped = true;
  const dropped = idleQueue.length;
  idleQueue.length = 0;
  log(`first interaction — idle queue stopped (dropped ${dropped}). running stats:`, stats);
}

function scheduleIdle() {
  if (idleScheduled || idleStopped) return;
  idleScheduled = true;
  ric((deadline) => {
    idleScheduled = false;
    while (!idleStopped && idleQueue.length && deadline.timeRemaining() > 2) {
      const { key, fetcher, cacheTtl } = idleQueue.shift();
      stats.idleWarmed++;
      log(`idle warm ${key}`);
      // Promote to a normal-lane fetch — same dedup, same cache.
      prefetch(key, fetcher, { lane: 'normal', cacheTtl });
    }
    if (idleQueue.length && !idleStopped) scheduleIdle();
  });
}
