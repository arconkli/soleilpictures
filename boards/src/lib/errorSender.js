// errorSender.js — the half of error reporting that loads on the first failure.
//
// errorReporting.js notices and hands over; this decides. It drops noise
// (errorNoise.js), folds repeats, turns a failed request, a file that didn't
// load, a logged Error or a channel's failure into a row (0580's shape), and sends rows to
// public.client_errors in batches, retrying once when the database is the one
// failing. A dev build puts rows on window.__errorSink for the specs and never
// sends them.
//
// Imports only what the entry chunk already holds (and errorCore.js, which is
// this chunk's), so loading it never pulls in a part of the app.

import { isNoise, isBotUA } from './errorNoise.js';
import { classifyHttpFailure, bodyCode, routeOf, dedupeKey, crumbNames, errorContext, scrubUrls, channelFailure, channelLabel } from './errorCore.js';
import { describeReason } from './describeReason.js';
import { unwatchedFetch } from './netWatch.js';
import { eventEnv } from './eventEnv.js';
import { getAppSessionId } from './appSession.js';
import { bootAt } from './bootMarks.js';

const MAX_ROWS = 50;      // one page load's share; 0580 also caps a session at 300 an hour
const MAX_LOGGED = 20;    // of them, logged Errors (console.error/warn), so they never crowd out a crash
const BATCH_MS = 2000;
const MAX_BODY = 48_000;  // keepalive allows 64 KB in flight

const EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg', 'heic', 'mp4', 'webm', 'mov', 'm4v',
  'mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'pdf', 'js', 'css', 'woff2', 'woff']);

let cfg = null;
let hosts = {};
let rows = 0;
let logged = 0;
let timer = 0;
let queue = [];
const seen = new Set();
const reported = new WeakSet();
// A logged Error waits for the batch: React logs a render crash to the console
// before the error boundary reports it, and the boundary's row (a crash) wins.
const held = new Map();

export function start(c) {
  cfg = c;
  let supabase = null;
  try { supabase = new URL(c.restUrl).host; } catch (_) {}
  hosts = { app: location.host, supabase };
}

const ua = () => navigator.userAgent || '';

function appSession() {
  try { return getAppSessionId(); } catch (_) { return null; }
}

function base(m, kind, extra) {
  return {
    session_id: m.sessionId,
    user_id: m.userId,
    app_session_id: appSession(),
    kind,
    path: m.path,
    release: cfg.release,
    env: eventEnv(cfg.dev),
    user_agent: ua().slice(0, 500),
    breadcrumbs: crumbNames(m.crumbs, hosts),
    context: errorContext({ online: m.online, vis: m.vis, ...extra }),
    name: null,
    stack: null,
    component_stack: null,
    severity: null,
  };
}

function once(key) {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

function push(row, uncapped) {
  if (!uncapped) {
    if (rows >= MAX_ROWS) return;
    rows += 1;
  }
  queue.push(row);
  schedule();
}

function errorRow(error, opts, m) {
  const kind = opts.kind || 'error';
  // A rejection's reason, unpacked into an Error with what it knows.
  if (kind === 'unhandledrejection') error = describeReason(error);
  // An address in a message becomes its service and route (errorCore.js).
  const message = scrubUrls(String(error?.message || error || ''), hosts).slice(0, 2000);
  const stack = typeof error?.stack === 'string' ? error.stack.slice(0, 8000) : null;
  if (error?.name === 'AbortError' || isNoise(message, stack, ua())) return null;
  if (!once(dedupeKey(kind, message, stack))) return null;
  return {
    ...base(m, kind, { ...(opts.op ? { op: String(opts.op) } : null), ...(opts.context || null) }),
    severity: opts.severity || null,
    name: typeof error?.name === 'string' ? error.name.slice(0, 200) : null,
    message,
    stack,
    component_stack: typeof opts.componentStack === 'string' ? opts.componentStack.slice(0, 8000) : null,
  };
}

async function takeHttp({ f, m }) {
  if (!routeOf(f.url, hosts)) return;
  let pg = null;
  if (f.body) { try { pg = bodyCode(await f.body.text()); } catch (_) {} }
  const v = classifyHttpFailure({ ...f, online: m.online, pg }, hosts);
  if (!v || !once(`http|${v.message}`)) return;
  push({ ...base(m, 'http', { http: v.http }), severity: v.severity, name: 'HttpFailure', message: v.message });
}

export function take(it) {
  try {
    const m = it.m;
    if (it.t === 'err') {
      if (it.error && typeof it.error === 'object') {
        if (reported.has(it.error)) return;
        reported.add(it.error);
        held.delete(it.error);
      }
      const row = errorRow(it.error, it.opts || {}, m);
      if (row) push(row);
    } else if (it.t === 'con') {
      if (reported.has(it.error) || held.has(it.error) || logged >= MAX_LOGGED) return;
      // The line's leading [tag] alone ("[uploads] poster failed for …"): the
      // rest of a logged line can name a file or a cluster.
      const label = typeof it.label === 'string' ? (/^\[([\w:./-]{1,40})\]/.exec(it.label) || [])[1] || null : null;
      const row = errorRow(it.error, { kind: 'console', severity: 'warning', op: label }, m);
      if (row) { logged += 1; held.set(it.error, row); schedule(); }
    } else if (it.t === 'toast') {
      const code = typeof it.code === 'string' && /^[a-z][a-z0-9_]{1,59}$/.test(it.code) ? it.code : 'uncoded';
      if (!once(`toast|${code}`)) return;
      push({ ...base(m, 'toast', { code, group: typeof it.group === 'string' ? it.group : null }),
        severity: 'error', name: 'Toast', message: `toast:${code}` });
    } else if (it.t === 'http') {
      void takeHttp(it);
    } else if (it.t === 'res') {
      const el = it.el;
      const src = el.currentSrc || el.src || el.href || '';
      const r = src && routeOf(src, hosts);
      if (!r) return;
      const tag = String(el.tagName).toLowerCase();
      let ext = null;
      try { ext = (/\.([a-z0-9]{2,5})$/i.exec(new URL(src, location.href).pathname) || [])[1]?.toLowerCase(); } catch (_) {}
      const message = `${tag} ${r.svc}/${r.route}${ext && EXTS.has(ext) ? ` .${ext}` : ''} did not load`;
      if (!once(`res|${message}`)) return;
      push({ ...base(m, 'resource', { tag, host: r.svc }), severity: 'warning', name: 'ResourceError', message });
    } else if (it.t === 'chan') {
      // A channel's own failure (errorCore.js channelFailure), once a page: a
      // refusal by the channel's leading words, and a join that timed out as
      // one problem whichever channel it was (the service, or the way to it,
      // is the slow one). Not while the page is hidden or offline, nor within
      // half a minute of coming back from either: those rejoins race the
      // fresh token and time out as a matter of course.
      const what = channelFailure(it.status, it.err);
      if (!what || isBotUA(ua()) || m.vis !== 'visible' || !m.online) return;
      if ((m.crumbs || []).some((c) => (c.k === 'vis' || c.k === 'net') && c.t > -30_000)) return;
      const label = channelLabel(it.name);
      const message = what === 'timed out' ? 'Live updates timed out' : `Live updates ${what}: ${label}`;
      if (!once(`chan|${message}`)) return;
      push({ ...base(m, 'realtime', { op: label }), severity: 'warning', name: 'ChannelFailure', message });
    } else if (it.t === 'boot') {
      // Still on a splash BOOT_STUCK_MS after the navigation (errorReporting.js).
      // Not when the tab was hidden or the network went at any point: then it is
      // slow because nobody was looking, or there was nothing to load from.
      // Nor once a board painted: a splash then is a later step's, not the boot's.
      if (isBotUA(ua()) || m.vis !== 'visible' || !m.online || bootAt('paint') != null || bootAt('enter') != null) return;
      if ((m.crumbs || []).some((c) => c.k === 'vis' || c.k === 'net')) return;
      const step = ['workspace', 'tier', 'shell', 'session'].find((s) => bootAt(s) != null) || 'start';
      push({ ...base(m, 'stuck', { op: 'boot', phase: step, ms: m.at }), severity: 'error', name: 'Stuck',
        message: `Boot stuck after ${step}` });
    } else if (it.t === 'perf') {
      if (isBotUA(ua())) return;
      let stack = null;
      try { stack = JSON.stringify(it.context || {}, null, 2).slice(0, 8000); } catch (_) {}
      push({ ...base(m, 'perf'), severity: 'warning', name: 'PerfIncident', message: String(it.bucket).slice(0, 2000), stack }, true);
    }
  } catch (_) { /* never into the app */ }
}

function schedule() {
  if (!timer) timer = setTimeout(flush, BATCH_MS);
}

export function flush() {
  clearTimeout(timer);
  timer = 0;
  for (const [error, row] of held) {
    reported.add(error);
    if (rows < MAX_ROWS) { rows += 1; queue.push(row); }
  }
  held.clear();
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  if (cfg.dev) {
    try { (window.__errorSink ||= []).push(...batch); } catch (_) {}
    return;
  }
  let chunk = [];
  let size = 2;
  for (const row of batch) {
    const n = JSON.stringify(row).length + 1;
    if (chunk.length && size + n > MAX_BODY) { post(chunk, 0); chunk = []; size = 2; }
    chunk.push(row);
    size += n;
  }
  if (chunk.length) post(chunk, 0);
}

function post(chunk, attempt) {
  const body = JSON.stringify(chunk);
  unwatchedFetch()(cfg.restUrl, {
    method: 'POST',
    keepalive: body.length < 60_000,
    headers: { apikey: cfg.key, 'content-type': 'application/json', prefer: 'return=minimal' },
    body,
  }).then((res) => {
    // The database or the network was the one failing: once more, later.
    if (!res.ok && attempt === 0 && (res.status >= 500 || res.status === 429)) {
      setTimeout(() => post(chunk, 1), 3000);
    }
  }, () => {
    try {
      navigator.sendBeacon(`${cfg.restUrl}?apikey=${encodeURIComponent(cfg.key)}`,
        new Blob([body], { type: 'application/json' }));
    } catch (_) {}
  });
}
