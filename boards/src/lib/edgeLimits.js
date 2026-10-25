// edgeLimits — request limits counted across the Worker's isolates.
//
// A Map in one isolate (makeRateLimiter in webImageSave.js) counts only the
// requests that isolate happens to serve, and a flood spreads over many of
// them, so it bounds a loop but not a crowd. Each limit here is also a Workers
// Rate Limiting binding of the same name in wrangler.toml, which counts across
// every isolate in a Cloudflare location; edgeLimits.test.mjs holds the two
// tables equal, and the docs read their numbers from this one.
//
// The binding's counts are approximate and kept per location, so these keep
// loops and floods off the database; they are never accounting. The API's
// hourly window per token stays in api_token_resolve, where it is exact.
//
// Without the binding (dev, node tests, a wrangler that predates
// [[ratelimits]]) or when it throws, the same limit holds per isolate: the
// guard is never lost, and a counter that fails never refuses anyone.
//
// Pure apart from the binding it is handed, so every rule here tests under node.

export const EDGE_LIMITS = {
  // POST /oauth/register, per address. The durable limit is the database's
  // count of new clients per address an hour (0701); this keeps a flood of
  // attempts from reaching it.
  OAUTH_REGISTER: { limit: 10, period: 60 },
  // POST /oauth/token and /oauth/revoke together, per address. Generous: a
  // hosted assistant exchanges and refreshes for all of its users from a few
  // addresses, and a person's own connection refreshes about once an hour.
  OAUTH_TOKEN: { limit: 120, period: 60 },
  // Fetching an app's client metadata document from its server, per address:
  // each fetch is a request to a URL somebody chose.
  OAUTH_LOOKUP: { limit: 10, period: 60 },
};

// makeEdgeLimiter(name) → async (env, key) → { ok: true } | { ok: false, retryAfter }
//
// retryAfter is in seconds. The binding does not say where its window stands,
// so a refusal there waits out a whole period; the local window knows exactly.
export function makeEdgeLimiter(name, { now = () => Date.now() } = {}) {
  const spec = EDGE_LIMITS[name];
  if (!spec) throw new Error(`edgeLimits: no limit named ${name}`);
  const { limit, period } = spec;
  const windowMs = period * 1000;
  const seen = new Map();   // key → { start, n }
  let warned = false;

  const local = (key) => {
    const t = now();
    const cur = seen.get(key);
    if (!cur || t - cur.start >= windowMs) {
      if (seen.size > 5000) seen.clear();
      seen.set(key, { start: t, n: 1 });
      return { ok: true };
    }
    cur.n += 1;
    if (cur.n <= limit) return { ok: true };
    return { ok: false, retryAfter: Math.max(1, Math.ceil((cur.start + windowMs - t) / 1000)) };
  };

  return async (env, key) => {
    const k = String(key || 'unknown');
    const binding = env?.[name];
    if (binding && typeof binding.limit === 'function') {
      try {
        const { success } = await binding.limit({ key: k });
        return success === false ? { ok: false, retryAfter: period } : { ok: true };
      } catch (e) {
        if (!warned) {
          warned = true;
          console.warn('[edgeLimits]', name, 'binding failed, counting in this isolate:', e?.message);
        }
      }
    }
    return local(k);
  };
}
