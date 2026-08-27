// describeReason.js — turn an arbitrary promise-rejection reason into a
// reportable Error.
//
// Deliberately a separate module from errorReporting.js: that file reads
// import.meta.env at module scope, so it cannot be imported from `node --test`.
// Keeping this pure and env-free is what makes describeReason.test.mjs possible.

// Turn a promise rejection reason into a reportable Error.
//
// `new Error(\`Unhandled rejection: ${String(reason)}\`)` — what this replaced —
// collapses every object to the literal text "[object Object]" and every empty
// rejection to "undefined". Production has rows saying exactly that, and they
// are unactionable: no code, no status, no URL, and a stack pointing at the
// listener in main.jsx rather than the call site that rejected.
//
// The shapes that actually reject in this app, in order of how often they do:
// a Supabase PostgrestError ({code, message, details, hint} — NOT an Error), a
// fetch Response, a PartyKit/WebSocket CloseEvent, and a DOMException.
export function describeReason(reason, prefix = 'Unhandled rejection') {
  // Already an Error: hand it straight back so the real stack survives.
  if (reason instanceof Error) return reason;

  let msg;
  let name = 'UnhandledRejection';
  try {
    if (reason === undefined || reason === null) {
      // Promise.reject() / throw undefined. Nothing to recover, but say which.
      msg = String(reason);
    } else if (typeof reason === 'string') {
      msg = reason;
    } else if (typeof reason !== 'object') {
      msg = String(reason);
    } else if (typeof Response !== 'undefined' && reason instanceof Response) {
      name = 'HttpError';
      msg = `HTTP ${reason.status}${reason.statusText ? ' ' + reason.statusText : ''} ${reason.url || ''}`.trim();
    } else if (typeof reason.code === 'number' && typeof reason.wasClean === 'boolean') {
      // CloseEvent — the y-partykit / realtime socket giving up.
      name = 'SocketClosed';
      msg = `WebSocket closed ${reason.code}${reason.reason ? ' ' + reason.reason : ''}${reason.wasClean ? ' (clean)' : ''}`;
    } else if (typeof DOMException !== 'undefined' && reason instanceof DOMException) {
      name = reason.name || 'DOMException';
      msg = reason.message || String(reason);
    } else if (typeof reason.message === 'string') {
      // PostgrestError and friends: message plus whichever diagnostics exist.
      name = reason.name || (reason.code ? 'PostgrestError' : 'UnhandledRejection');
      const bits = [reason.message];
      if (reason.code !== undefined) bits.push(`code=${reason.code}`);
      if (reason.status !== undefined) bits.push(`status=${reason.status}`);
      if (reason.details) bits.push(`details=${reason.details}`);
      if (reason.hint) bits.push(`hint=${reason.hint}`);
      msg = bits.join(' ');
    } else {
      // Last resort: real JSON, cycle-safe, so at least the keys are visible.
      const seen = new WeakSet();
      msg = JSON.stringify(reason, (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      }) ?? Object.prototype.toString.call(reason);
    }
  } catch (_) {
    msg = Object.prototype.toString.call(reason);
  }

  const err = new Error(`${prefix}: ${msg}`);
  err.name = name;
  // Prefer the rejecting site's stack over this listener's frame. Some
  // non-Error rejections (thrown plain objects) still carry one.
  if (reason && typeof reason.stack === 'string' && reason.stack) err.stack = reason.stack;
  return err;
}
