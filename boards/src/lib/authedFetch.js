// POST JSON to a worker route with the user's Supabase JWT in the
// Authorization header, so the worker can verify against /auth/v1/user before
// spending tokens. Returns null on any auth/transport failure (silently
// drops; callers should treat null as "no answer" so the UI doesn't pop
// errors when the worker is briefly down).

import { supabase } from './supabase.js';

// Per-endpoint cooldown. When a route returns a 5xx — typically because the
// model (Workers AI) failed or the upstream is down — stop hammering it for a
// while. Cooldown clears on the first successful response, so when the outage
// ends we resume immediately without manual intervention.
const COOLDOWN_MS = 60_000;
// A 429 is the daily budget (migration 0381): retrying within the hour cannot
// succeed, so stop asking for that long.
const BUDGET_COOLDOWN_MS = 60 * 60_000;
const _cooldownUntil = new Map(); // path -> Date.now() until which to skip

export async function authedFetch(path, body) {
  if (!supabase) return null;
  const until = _cooldownUntil.get(path) || 0;
  if (until && Date.now() < until) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    const r = await fetch(path, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.warn(`[authedFetch] ${path} ${r.status}:`, errText.slice(0, 200));
      if (r.status >= 500) {
        _cooldownUntil.set(path, Date.now() + COOLDOWN_MS);
      } else if (r.status === 429) {
        _cooldownUntil.set(path, Date.now() + BUDGET_COOLDOWN_MS);
      }
      return null;
    }
    // Success — clear any cooldown so retries resume immediately.
    if (until) _cooldownUntil.delete(path);
    return await r.json();
  } catch (e) {
    console.warn(`[authedFetch] ${path} threw:`, e?.message || e);
    // Network error — treat like 5xx for backoff purposes.
    _cooldownUntil.set(path, Date.now() + COOLDOWN_MS);
    return null;
  }
}
