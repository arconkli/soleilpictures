// errorReporting.js — FIRST-PARTY error reporting into Supabase
// (public.client_errors). No third-party SDK, no DSN, no quota: anon-insert +
// admin-read via RLS, the same keepalive path analytics.js uses.
//
//   import { reportError } from './lib/errorReporting.js';
//   reportError(err, { kind: 'save', op: 'board_snapshot', context: { board_id } });
//   logClientError(err, { kind: 'render', componentStack });   // the older name
//
// This module is the part every page carries, and it only notices: an error,
// a failed request (netWatch.js), a picture or script that didn't load, a
// console.error with an Error in it, an error toast, a live-updates channel
// that failed. Each is handed on with
// what the page knew at that moment and the names of the steps before it
// (errorCrumbs.js). errorSender.js, loaded on the first one, decides what is
// noise, builds the rows (0580's shape) and sends them in batches. When that
// chunk can't load (a deploy replaced it), a few rows still go straight out.
//
// setErrorUser() is called from analytics.js's single onAuthStateChange so
// rows attribute to the signed-in user (id only — no email/PII).

import { crumb, crumbsSnapshot } from './errorCrumbs.js';
import { installNetWatch, unwatchedFetch } from './netWatch.js';

const REST_URL   = (import.meta.env.VITE_SUPABASE_URL || '') + '/rest/v1/client_errors';
const PUBLIC_KEY  = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
                 || import.meta.env.VITE_SUPABASE_ANON_KEY;
const SESSION_KEY = 'soleil_session_id';   // shared with analytics.js → stitch errors to the funnel
const RELEASE     = import.meta.env.VITE_RELEASE || null;
// A load still on a splash this long after the navigation is stuck.
const BOOT_STUCK_MS = 45_000;

let cachedUserId = null;
let sender = null;
let loading = null;
const waiting = [];

// Called from analytics.js's auth-state handler. Id only, never email.
export function setErrorUser(userId) {
  cachedUserId = userId ?? null;
}

function sessionId() {
  try { return localStorage.getItem(SESSION_KEY); } catch (_) { return null; }
}

// What the page knew when something failed.
function moment() {
  return {
    at: performance.now(),
    path: location.pathname,
    online: navigator.onLine,
    vis: document.visibilityState,
    crumbs: crumbsSnapshot(),
    userId: cachedUserId,
    sessionId: sessionId(),
  };
}

function hand(item) {
  if (!PUBLIC_KEY) return;
  if (sender) { sender.take(item); return; }
  if (waiting.length < 60) waiting.push(item);
  loading ||= import('./errorSender.js').then((m) => {
    m.start({ restUrl: REST_URL, key: PUBLIC_KEY, release: RELEASE, dev: import.meta.env.DEV });
    return m;
  }, () => FALLBACK).then((s) => {
    sender = s;
    for (const it of waiting.splice(0)) s.take(it);
  });
}

// The sender never arrived (a deploy replaced its chunk, or something blocked
// it). The first few errors still go out as they are, one row at a time; the
// rest is dropped rather than risk a flood. 0580's trigger cuts each column
// down and fingerprints the row all the same.
let direct = 0;
function sendDirect(items) {
  for (const { t, error: e, opts, m } of items) {
    if (t !== 'err' || direct++ >= 5) continue;
    const row = {
      session_id: m.sessionId, user_id: m.userId, kind: opts.kind || 'error', name: e.name,
      message: String(e.message || e).slice(0, 2000), stack: String(e.stack || '').slice(0, 8000) || null,
      path: m.path, release: RELEASE, user_agent: navigator.userAgent,
    };
    if (import.meta.env.DEV) { (window.__errorSink ||= []).push(row); continue; }
    unwatchedFetch()(REST_URL, {
      method: 'POST', keepalive: true,
      headers: { apikey: PUBLIC_KEY, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify([row]),
    }).catch(() => {});
  }
}
const FALLBACK = { take: (it) => sendDirect([it]), flush() {} };

// opts: { kind, severity, op, context, componentStack }. context keeps only
// 0580's keys (op, code, surface, board_id, attempt, ms, phase, tag, host…).
export function reportError(error, opts = {}) {
  if (!error) return;
  try {
    hand({ t: 'err', error, opts, m: moment() });
    crumb('err', opts.kind || 'error');
  } catch (_) { /* never let the reporter throw into the app */ }
}

export { reportError as logClientError };

// An error toast, by its code (never its text: a toast can quote a name).
export function reportToast(type, code, group) {
  try {
    crumb('toast', code || 'uncoded');
    if (type === 'error') hand({ t: 'toast', code, group, m: moment() });
  } catch (_) {}
}

// Field PERFORMANCE incidents (lib/perfReport.js) ride the same table with
// kind='perf': the bucket string is the row's `message` (kept CONSTANT so the
// admin Errors tab groups them) and the full JSON context goes in `stack`.
// Bypasses the dedupe — perfReport enforces its own hard caps (≤6/session,
// ≥20s apart), which IS the flood policy.
export function postPerfIncident(bucket, context = {}) {
  if (!bucket) return;
  try { hand({ t: 'perf', bucket, context, m: moment() }); } catch (_) {}
}

// A request that failed: { url, method, status, ms, slow?, aborted?, body? }.
// netWatch.js hands on every fetch; uploads.js its XHR PUTs, which fetch can't
// send (it reports no progress for a body). A crumb now, with the address kept
// only in memory: errorSender cuts it to service and route. A toast this
// failure causes comes after it.
export function noteRequest(f) {
  try {
    crumb('http', `${f.method} ${f.slow ? 'slow' : f.status}`, f.url);
    hand({ t: 'http', f, m: moment() });
  } catch (_) {}
}

// A channel that errored or timed out (realtimeGuard.js watchChannels):
// errorSender says whether it was the channel's own failure.
export function noteChannel(ch, name, status, err) {
  try { hand({ t: 'chan', ch, name, status, err, m: moment() }); } catch (_) {}
}

// Installed once from main.jsx, before anything renders: uncaught errors and
// rejections, failed requests, files that didn't load, logged Errors, a boot
// that never finishes, and the steps before each.
export function installErrorWatch() {
  if (typeof window === 'undefined') return;
  installNetWatch(noteRequest);
  // A file, picture, film or script that failed to load fires `error` on its
  // element, which doesn't bubble: only a capture listener on window hears it.
  // An uncaught exception arrives here too, on window itself.
  window.addEventListener('error', (e) => {
    if (e.target && e.target.tagName) hand({ t: 'res', el: e.target, m: moment() });
    else reportError(e.error || new Error(e.message || 'window.onerror'), { kind: 'window' });
  }, true);
  // A rejection nobody caught. Its reason is often not an Error (a
  // PostgrestError, a Response, a CloseEvent): errorSender unpacks it
  // (describeReason.js) rather than this chunk carrying that.
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason || String(e.reason), { kind: 'unhandledrejection' }));
  // console.error or console.warn holding an Error: the long tail of failures
  // that are logged and nothing else.
  for (const level of ['error', 'warn']) {
    const log = console[level];
    console[level] = function (...args) {
      try {
        const err = args.find((a) => a instanceof Error);
        if (err) hand({ t: 'con', error: err, label: args[0], m: moment() });
      } catch (_) {}
      return log.apply(this, args);
    };
  }
  for (const k of ['online', 'offline']) window.addEventListener(k, () => crumb('net', k));
  document.addEventListener('visibilitychange', () => {
    crumb('vis', document.visibilityState);
    if (sender && document.visibilityState === 'hidden') sender.flush();
  });
  // Leaving before the sender arrived: what's waiting goes out as it is.
  window.addEventListener('pagehide', () => {
    if (sender) sender.flush();
    else sendDirect(waiting.splice(0));
  });
  // React clears #boot-splash on its first render, and .auth-loading is the
  // splash every loading step after that shows (AuthGate, TierRouter, App).
  // The sender says how far the boot got (lib/bootMarks.js).
  setTimeout(() => {
    if (document.querySelector('#boot-splash, .auth-loading')) hand({ t: 'boot', m: moment() });
  }, BOOT_STUCK_MS);
}
