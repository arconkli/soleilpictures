// netWatch.js — every request that fails, noticed where they all go out.
//
// supabase-js never throws: a refused query, a timed-out RPC or a 500 comes
// back as `{ error }`, and most callers show a toast or nothing. So failures
// are noticed at window.fetch instead. lib/supabase.js hands supabase-js a
// fetch that reads the global on every call, so this sees every query, RPC,
// auth call, Storage upload and function call; the Worker's and the Party's
// routes go through it too.
//
// Each failure is handed on raw, and errorCore.js's classifyHttpFailure()
// decides later, off the request's path, what it was and whether it is anyone's
// problem. A failed response is cloned HERE, synchronously, before the caller
// can read its body: the code in it (57014, PGRST116, otp_expired) is what
// tells a timeout from a person's typo.

export const SLOW_MS = 8000;

let raw = null;

// The fetch from before the watch, for the reporter's own posts.
export function unwatchedFetch() { return raw || globalThis.fetch; }

export function installNetWatch(onFailure) {
  if (raw || !window.fetch) return;
  raw = window.fetch;
  const orig = raw;
  const note = (f) => { try { onFailure(f); } catch (_) { /* never into the request */ } };
  window.fetch = function fetch(input, init) {
    const t0 = performance.now();
    const p = orig(input, init);
    try {
      const url = typeof input === 'string' ? input : String(input.url || input);
      const method = String((init && init.method) || input.method || 'GET').toUpperCase();
      p.then((res) => {
        const ms = performance.now() - t0;
        // A no-cors request's answer (opaque, opaqueredirect) is opaque by
        // design, not a failure; a success matters only when it was slow.
        if (res.type.startsWith('opaque') || (res.ok && ms < SLOW_MS)) return;
        let body = null;
        if (!res.ok) try { body = res.clone(); } catch (_) { /* a body already used */ }
        note({ url: res.url || url, method, status: res.status, ms, slow: res.ok, body });
      }, (err) => {
        note({ url, method, status: 0, ms: performance.now() - t0, aborted: err?.name === 'AbortError' });
      });
    } catch (_) { /* never into the request */ }
    return p;
  };
}
