// appTrace.js — the micro-interaction trace for ESTABLISHED users.
//
// The other two traces each cover a slice of a user's life and then stop:
//
//   lp_trace  — anonymous visitors, public pages only
//   ps_trace  — a brand-new user's FIRST session, and journey.js closes it at
//               activation and never reopens it for that uid
//
// Which left the largest population — signed-in people using the product they
// came back for — emitting nothing. Every friction finding we have is therefore
// about someone's first hour, and we had no way to see a paper cut that only
// shows up on the fiftieth board. This closes that.
//
// Same record vocabulary as the other two on purpose (click | dead | rage | key
// | route | hide | show), so one query spans all three and a finding on the
// landing page is directly comparable to the same finding on the canvas.
//
// DELIBERATELY QUIETER than ps_trace: an established session can run for hours,
// where a first session runs for minutes. So the caps are tighter, and the
// interesting records are kept while the routine ones are dropped — a plain
// click on a working button teaches us nothing at this stage, but a dead click,
// a rage burst, or a shortcut does. See RECORD_ALWAYS.
//
// Pure + node-importable, emitter INJECTED (same discipline as journey.js and
// landingMetrics.js), never throws into callers.

import { EV } from './analyticsEvents.js';
import {
  isInteractiveTarget, createRageDetector, createDeadClickWatcher,
} from './interactionClassify.js';

// ── Injected emitter ──────────────────────────────────────────────────────────
let _log    = () => {};
let _logNow = () => {};
let _now    = () => Date.now();
let _deps   = {};   // dead-click watcher seams (probe/schedule) — tests inject
export function setAppTraceSink({ logEvent, logEventNow, now, probe, schedule } = {}) {
  if (typeof logEvent === 'function')    _log    = logEvent;
  if (typeof logEventNow === 'function') _logNow = logEventNow;
  if (typeof now === 'function')         _now    = now;
  if (typeof probe === 'function')       _deps.probe = probe;
  if (typeof schedule === 'function')    _deps.schedule = schedule;
  deadWatch = createDeadClickWatcher(_deps);
}

// ── Tunables ──────────────────────────────────────────────────────────────────
const TRACE_FLUSH_MS    = 8000;   // half as chatty as ps_trace's 4s
const TRACE_MAX_RECORDS = 40;
const TRACE_MAX_ROWS    = 12;     // hard cap per pageload — a long session must not become a firehose
const KEY_THROTTLE_MS   = 400;

// Records worth spending the budget on. A plain 'click' on a control that
// worked is the one thing we can already infer from the product events, so it
// is dropped here; everything below is evidence we have no other source for.
const RECORD_ALWAYS = new Set(['dead', 'rage', 'key', 'route']);

let traceBuf = [];
let traceRows = 0;
let armed = false;
let t0 = 0;
let lastKeyAt = 0;
let lastRoute = null;
let rage = createRageDetector(() => _now());
let deadWatch = createDeadClickWatcher(_deps);

function tMs() { return Math.max(0, _now() - t0); }

function pushRec(kind, tgt, extra) {
  if (!armed || traceRows >= TRACE_MAX_ROWS) return;
  if (!RECORD_ALWAYS.has(kind)) return;
  const rec = { t: tMs(), k: kind };
  if (tgt) rec.tgt = tgt;
  if (extra) for (const k in extra) rec[k] = extra[k];
  traceBuf.push(rec);
  if (traceBuf.length >= TRACE_MAX_RECORDS) flushTrace(false);
}

export function flushTrace(beacon) {
  if (!traceBuf.length) return;
  if (traceRows >= TRACE_MAX_ROWS) { traceBuf = []; return; }
  const ev = traceBuf;
  traceBuf = [];
  traceRows += 1;
  const row = { from_t: ev[0].t, to_t: ev[ev.length - 1].t, n: ev.length, ev };
  try { if (beacon) _logNow(EV.APP_TRACE, row); else _log(EV.APP_TRACE, row); } catch (_) {}
}

// Arm for this pageload. The CALLER owns the decision (see useAppTrace) — this
// module never inspects the session or the journey itself, so it stays pure.
export function armAppTrace() {
  if (armed) return;
  armed = true;
  t0 = _now();
  traceBuf = [];
  traceRows = 0;
  rage = createRageDetector(() => _now());
  deadWatch = createDeadClickWatcher(_deps);
  try { lastRoute = typeof location !== 'undefined' ? location.pathname : null; } catch (_) { lastRoute = null; }
}

export function disarmAppTrace() {
  if (!armed) return;
  flushTrace(true);
  armed = false;
}

export function isAppTraceArmed() { return armed; }

// ── Recorders (DOM-free; the hook feeds them) ─────────────────────────────────
export function traceClick(el, describe) {
  if (!armed) return;
  const tgt = describe(el);
  if (!isInteractiveTarget(el)) {
    const at = tMs();   // the verdict arrives late; the record belongs to the click
    deadWatch((kind) => { if (kind === 'dead') pushRec('dead', tgt, { t: at }); });
  }
  const n = rage(tgt);
  if (n) pushRec('rage', tgt, { n });
}

// Commands only — never printable characters, so this can't capture prose.
export function traceKey(key, mods) {
  if (!armed) return;
  const now = _now();
  if (now - lastKeyAt < KEY_THROTTLE_MS) return;
  lastKeyAt = now;
  pushRec('key', null, { key: (mods || '') + key });
}

export function traceRoute(path) {
  if (!armed || !path || path === lastRoute) return;
  lastRoute = path;
  pushRec('route', null, { to: String(path).slice(0, 80) });
}

export function __resetForTest() {
  traceBuf = []; traceRows = 0; armed = false; t0 = 0;
  lastKeyAt = 0; lastRoute = null; _deps = {};
  rage = createRageDetector(() => _now());
  deadWatch = createDeadClickWatcher(_deps);
}

export const __TUNABLES = { TRACE_FLUSH_MS, TRACE_MAX_RECORDS, TRACE_MAX_ROWS };
