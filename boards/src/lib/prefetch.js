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
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (inFlight.has(key)) return inFlight.get(key);

  const p = (async () => {
    try {
      const value = await fetcher();
      if (cacheTtl > 0) cache.set(key, { value, expiresAt: Date.now() + cacheTtl });
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
  return c && c.expiresAt > Date.now() ? c.value : null;
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
  idleStopped = true;
  idleQueue.length = 0;
}

function scheduleIdle() {
  if (idleScheduled || idleStopped) return;
  idleScheduled = true;
  ric((deadline) => {
    idleScheduled = false;
    while (!idleStopped && idleQueue.length && deadline.timeRemaining() > 2) {
      const { key, fetcher, cacheTtl } = idleQueue.shift();
      // Promote to a normal-lane fetch — same dedup, same cache.
      prefetch(key, fetcher, { lane: 'normal', cacheTtl });
    }
    if (idleQueue.length && !idleStopped) scheduleIdle();
  });
}
