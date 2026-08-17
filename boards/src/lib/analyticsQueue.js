// analyticsQueue.js — the pure delivery rules behind analytics.js.
//
// Extracted so they can be tested in plain node: analytics.js statically
// imports the supabase client (and therefore import.meta.env), which makes it
// un-importable outside a bundler. Same discipline as interactionClassify.js —
// the decisions live here, the browser wiring stays there.
//
// Everything in this file is about NOT LOSING EVENTS, and every rule exists
// because the previous implementation lost them silently:
//
//   • a rejected batch vanished, because supabase-js resolves with { error }
//     instead of throwing and the catch never fired
//   • the queue dropped its oldest rows past a cap with no signal
//   • an oversized keepalive body was dropped whole by the browser
//
// Silent loss is worse than visible loss: an instrumentation outage looks
// exactly like a quiet week, and you make product decisions on the difference.

export const FLUSH_INTERVAL_MS = 5000;
export const MAX_QUEUE  = 500;     // hard cap — drop oldest beyond this
export const MAX_BATCH  = 50;      // rows per array insert

// Browsers cap keepalive request bodies at ~64KB across all in-flight
// keepalive requests and drop the excess without warning.
export const MAX_BEACON_BYTES = 50_000;

// A batch that keeps failing is malformed or hitting a policy change. Retrying
// forever would block everything behind it.
export const MAX_ATTEMPTS = 6;
export const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

// A queue restored from days ago is archaeology, not telemetry.
export const MAX_ROW_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Split rows into groups that each serialise below `maxBytes`.
 *
 * A row that exceeds the cap on its own still goes out alone: one oversized
 * request that the browser MAY drop beats guaranteeing the loss by never
 * sending it.
 */
export function beaconChunks(rows, maxBytes = MAX_BEACON_BYTES) {
  const out = [];
  let chunk = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length + 1;   // +1 for the array separator
    if (chunk.length && bytes + size > maxBytes) {
      out.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(row);
    bytes += size;
  }
  if (chunk.length) out.push(chunk);
  return out;
}

/** Delay before the next flush after `failures` consecutive failures. */
export function backoffFor(failures) {
  if (!(failures > 0)) return FLUSH_INTERVAL_MS;
  return BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
}

/**
 * Drop rows that are malformed or older than `maxAgeMs`.
 * Returns { kept, dropped } — the count is reported, never swallowed.
 */
export function pruneStale(rows, now = Date.now(), maxAgeMs = MAX_ROW_AGE_MS) {
  if (!Array.isArray(rows)) return { kept: [], dropped: 0 };
  const cutoff = now - maxAgeMs;
  const kept = rows.filter((r) => {
    if (!r || !r.event) return false;
    const t = Date.parse(r.occurred_at || '');
    return Number.isFinite(t) && t >= cutoff;
  });
  return { kept, dropped: rows.length - kept.length };
}

/** Enforce the queue ceiling, dropping OLDEST first. Returns { kept, dropped }. */
export function capQueue(rows, max = MAX_QUEUE) {
  if (!Array.isArray(rows)) return { kept: [], dropped: 0 };
  if (rows.length <= max) return { kept: rows, dropped: 0 };
  return { kept: rows.slice(-max), dropped: rows.length - max };
}

/**
 * Split a failed batch into what is worth retrying and what has exhausted its
 * attempts. Mutates `_try` on each row — bookkeeping that never reaches the wire.
 */
export function partitionRetries(batch, maxAttempts = MAX_ATTEMPTS) {
  const retry = [];
  let exhausted = 0;
  for (const r of batch) {
    r._try = (r._try || 0) + 1;
    if (r._try < maxAttempts) retry.push(r);
    else exhausted++;
  }
  return { retry, exhausted };
}

/**
 * Strip client-only bookkeeping before the row goes to PostgREST, which
 * rejects a payload carrying a column the table doesn't have. Sending `_try`
 * would turn a transient failure into a permanent one.
 */
export function wireRow(r) {
  if (!r || r._try === undefined) return r;
  const { _try, ...rest } = r;
  return rest;
}
