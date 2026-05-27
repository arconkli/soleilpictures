// Lightweight console-only perf instrumentation.
//
// Disabled by default — every call is a single-boolean no-op when off, so
// instrumenting hot paths costs nothing in normal operation. Enable via:
//
//   ?perf=1                       (URL query param, picked up in App.jsx)
//   localStorage.perfHud = '1'    (sticky across reloads)
//   window.perf.enable()          (DevTools console)
//   Ctrl+Shift+P / ⌘⇧P             (keyboard, wired in App.jsx)
//
// Output goes to the browser console — no DOM, no React state. Inspect
// any time with `perf.snapshot()` or get a grouped table with `perf.dump()`.

import * as Y from 'yjs';
import React, { useLayoutEffect } from 'react';

const SAMPLE_CAP = 64;  // rolling samples per mark name
const LONGTASK_CAP = 32; // rolling buffer of recent long tasks

const counters = Object.create(null);   // name → integer
const gauges   = Object.create(null);   // name → number
const samples  = Object.create(null);   // name → { buf: number[], next: int }
const prevTickCounters = Object.create(null);  // for per-sec delta computation
const longTasks = [];  // rolling [{ duration, startTime, name, attribution }] cap LONGTASK_CAP
let lastTickAt = 0;
let lastTickFps = 0;
// Slow-frame dedupe: identical (rounded-to-50ms) gaps fire repeatedly during
// a sustained hitch. Suppress repeats within 1s and surface as a counter
// so the console doesn't drown.
let lastSlowFrameBucket = 0;
let lastSlowFrameAt = 0;
let suppressedSlowFrames = 0;

let enabled = false;
let verbose = false;

function _localStorageGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function _localStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

export function isEnabled() { return enabled; }

export function enable() {
  if (enabled) return;
  enabled = true;
  _localStorageSet('perfHud', '1');
  console.log('[perf] enabled — `perf.snapshot()` / `perf.dump()` / `perf.disable()` / `perf.verbose(true)` available on window.perf');
  _startLoops();
  // Loud confirmation of what's actually active so the user can tell
  // (and tell us) whether a patch silently failed at module load.
  console.log(
    '[perf] state:',
    'Y.Doc.prototype.transact patched=' + (!!_origTransact),
    '| setTimeout patched=' + (!!_origSetTimeout),
    '| setInterval patched=' + (!!_origSetInterval),
    '| WebSocket patched=' + (!!_origWS),
    '| longtask observer=' + (typeof PerformanceObserver !== 'undefined'),
  );
}

export function disable() {
  if (!enabled) return;
  enabled = false;
  _localStorageSet('perfHud', '0');
  _stopLongTaskObserver();
  console.log('[perf] disabled');
}

export function toggle() {
  if (enabled) disable(); else enable();
  return enabled;
}

// When verbose is on, the per-second tick line also includes gauges + mark
// p95/max even when no per-second deltas occurred. Useful for capturing
// an at-the-moment snapshot without running perf.dump().
export function setVerbose(on = true) {
  verbose = !!on;
  console.log('[perf] verbose', verbose);
  return verbose;
}

export function bump(name, n = 1) {
  if (!enabled) return;
  counters[name] = (counters[name] || 0) + n;
}

export function gauge(name, value) {
  if (!enabled) return;
  gauges[name] = value;
}

// Rolling ring of recent mark names — used by the longtask observer to
// log what was running shortly before a >300ms main-thread block.
const recentMarks = [];
const RECENT_MARKS_CAP = 32;

export function mark(name, ms) {
  if (!enabled) return;
  let s = samples[name];
  if (!s) { s = { buf: new Array(SAMPLE_CAP).fill(NaN), next: 0, count: 0 }; samples[name] = s; }
  s.buf[s.next] = ms;
  s.next = (s.next + 1) % SAMPLE_CAP;
  if (s.count < SAMPLE_CAP) s.count++;
  recentMarks.push({ name, t: performance.now() });
  if (recentMarks.length > RECENT_MARKS_CAP) recentMarks.shift();
  // Mirror as a User Timing entry so a Chrome DevTools Performance recording
  // surfaces this point on the Timings track with our exact name + ms.
  // No-op cost when DevTools isn't recording.
  try {
    if (typeof performance !== 'undefined' && performance.measure) {
      performance.measure(name, { start: performance.now() - ms, duration: ms });
    }
  } catch (_) { /* older Safari: 2nd-arg shape unsupported, ignore */ }
}

// Optional one-shot timer convenience.
export function time(name, fn) {
  if (!enabled) return fn();
  const t0 = performance.now();
  try { return fn(); }
  finally { mark(name, performance.now() - t0); }
}

// React render-time hook: drop into a component body to time its render +
// commit window. Captures performance.now() during render; the
// useLayoutEffect (no deps) fires synchronously after every commit and
// marks the delta. Production-safe — works regardless of whether React
// is the profiling build (unlike <Profiler> which no-ops in production).
//
// Use as: `usePerfRenderTime('CanvasSurface')` at the TOP of the
// component body. The mark name is `render.<name>.ms`.
export function usePerfRenderTime(name) {
  const t0 = enabled ? performance.now() : 0;
  useLayoutEffect(() => {
    if (t0) mark(`render.${name}.ms`, performance.now() - t0);
  });
}

// HOC version of usePerfRenderTime. Wrap a component at its import site
// (no source edit to the component itself) to capture render+commit time.
// Use case: when the component file has unrelated WIP that blocks an
// in-source hook call, wrap at the mount site instead:
//   const TimedApp = withPerfTime(App, 'App');
//   render(<TimedApp />);
export function withPerfTime(Component, name) {
  const display = Component.displayName || Component.name || 'Component';
  function PerfTimed(props) {
    usePerfRenderTime(name);
    return React.createElement(Component, props);
  }
  PerfTimed.displayName = `PerfTimed(${display})`;
  return PerfTimed;
}

function _markStats(s) {
  if (!s || s.count === 0) return null;
  let sum = 0, max = -Infinity, min = Infinity;
  const sorted = [];
  for (let i = 0; i < s.count; i++) {
    const v = s.buf[i];
    sorted.push(v);
    sum += v;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  sorted.sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return {
    n: s.count,
    avg: +(sum / s.count).toFixed(2),
    p95: +p95.toFixed(2),
    max: +max.toFixed(2),
    min: +min.toFixed(2),
  };
}

export function snapshot() {
  const markStats = {};
  for (const k of Object.keys(samples)) markStats[k] = _markStats(samples[k]);
  // Top long tasks, sorted by duration desc, truncated to 10.
  const topLongTasks = longTasks
    .slice()
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10)
    .map(t => ({ dur: +t.duration.toFixed(0), start: +t.startTime.toFixed(0), name: t.name, container: t.attribution }));
  return {
    enabled,
    verbose,
    fps: lastTickFps,
    suppressedSlowFrames,
    counters: { ...counters },
    gauges: { ...gauges },
    marks: markStats,
    longTasks: topLongTasks,
  };
}

export function dump() {
  const snap = snapshot();
  console.group('[perf] snapshot @ ' + new Date().toISOString());
  console.log('fps:', snap.fps);
  if (Object.keys(snap.counters).length) {
    console.group('counters (total since enable)');
    console.table(snap.counters);
    console.groupEnd();
  }
  if (Object.keys(snap.gauges).length) {
    console.group('gauges (latest)');
    console.table(snap.gauges);
    console.groupEnd();
  }
  if (Object.keys(snap.marks).length) {
    console.group('marks (rolling window, ms)');
    console.table(snap.marks);
    console.groupEnd();
  }
  if (snap.longTasks.length) {
    console.group('top long tasks (sorted by duration)');
    console.table(snap.longTasks);
    console.groupEnd();
  }
  if (snap.suppressedSlowFrames) {
    console.log('suppressed slow-frame duplicates:', snap.suppressedSlowFrames);
  }
  console.groupEnd();
  return snap;
}

export function reset() {
  for (const k of Object.keys(counters)) delete counters[k];
  for (const k of Object.keys(gauges)) delete gauges[k];
  for (const k of Object.keys(samples)) delete samples[k];
  for (const k of Object.keys(prevTickCounters)) delete prevTickCounters[k];
  longTasks.length = 0;
  suppressedSlowFrames = 0;
  lastSlowFrameBucket = 0;
  lastSlowFrameAt = 0;
  console.log('[perf] reset');
}

// ── Loops ───────────────────────────────────────────────────────────────
let tickInterval = 0;
let rafLoopRunning = false;
let lastFrameAt = 0;
let frameCount = 0;
let frameCountAt = 0;
let longTaskObserver = null;

function _startLoops() {
  if (!tickInterval) {
    lastTickAt = performance.now();
    tickInterval = setInterval(_tick, 1000);
  }
  if (!rafLoopRunning) {
    rafLoopRunning = true;
    lastFrameAt = performance.now();
    frameCountAt = lastFrameAt;
    frameCount = 0;
    requestAnimationFrame(_rafTick);
  }
  _startLongTaskObserver();
}

// Browser-level long-task observer: fires for any uninterrupted main-thread
// task >50ms. This is the silver bullet for finding where freezes come
// from — the entry includes duration + attribution (container script URL
// when available). Logged immediately + retained in the longTasks ring for
// later inspection via perf.dump().
function _startLongTaskObserver() {
  if (longTaskObserver) return;
  if (typeof PerformanceObserver === 'undefined') {
    console.log('[perf] PerformanceObserver unavailable in this runtime');
    return;
  }
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      if (!enabled) return;
      for (const entry of list.getEntries()) {
        const attribution = entry.attribution && entry.attribution[0]
          ? (entry.attribution[0].containerType || entry.attribution[0].name || 'unknown')
          : null;
        longTasks.push({
          duration: entry.duration,
          startTime: entry.startTime,
          name: entry.name || 'self',
          attribution,
        });
        if (longTasks.length > LONGTASK_CAP) longTasks.shift();
        // Always log — the user explicitly enabled perf to find these.
        console.warn(
          '[perf] longtask',
          `dur=${entry.duration.toFixed(0)}ms`,
          `start=${entry.startTime.toFixed(0)}`,
          `name=${entry.name || 'self'}`,
          attribution ? `attribution=${attribution}` : null,
        );
        // Correlate: for serious long tasks, surface the most recent
        // perf.mark names in the 200ms window ending at the start of
        // the long task. Useful when browser attribution is "window" —
        // tells us what just ran before the freeze.
        if (entry.duration > 300) {
          const cutoff = entry.startTime - 200;
          const preceding = recentMarks
            .filter(m => m.t >= cutoff && m.t <= entry.startTime + entry.duration)
            .map(m => m.name);
          if (preceding.length) {
            console.warn('[perf] longtask preceded by marks:', preceding.slice(-8));
          }
        }
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch (e) {
    console.log('[perf] longtask observer failed to start', e);
    longTaskObserver = null;
  }
}

function _stopLongTaskObserver() {
  if (!longTaskObserver) return;
  try { longTaskObserver.disconnect(); } catch (_) {}
  longTaskObserver = null;
}

// ── Y.Doc.prototype.transact patch ──────────────────────────────────────
// Patched once at module load. Every Y.applyUpdate (local or remote, from
// our source AND from inside y-partykit) goes through Doc.transact, so
// this single patch catches them all. When perf is disabled it's a tight
// passthrough — one bool check, no measurement overhead.
let _origTransact = null;
function _patchYDocTransact() {
  if (_origTransact) return;
  if (!Y || !Y.Doc || !Y.Doc.prototype || !Y.Doc.prototype.transact) {
    console.log('[perf] could not patch Y.Doc.prototype.transact — yjs internals changed?');
    return;
  }
  _origTransact = Y.Doc.prototype.transact;
  Y.Doc.prototype.transact = function patchedTransact(fn, origin, local) {
    if (!enabled) return _origTransact.call(this, fn, origin, local);
    // First-call sentinel — proves the patch is on the live prototype.
    if (!gauges['Y.transactPatchHit']) gauges['Y.transactPatchHit'] = 1;
    const _t0 = performance.now();
    const ret = _origTransact.call(this, fn, origin, local);
    const ms = performance.now() - _t0;
    mark('Y.transact.ms', ms);
    bump('Y.transact');
    // Per-origin breakdown: 'snapshot' / 'remote' / 'local' / 'restore' /
    // y-partykit's library origin (usually a numeric ClientID or the
    // string 'sync'). Helps separate "our code" from "the lib".
    const oTag = origin == null ? 'null'
              : (typeof origin === 'string' ? origin
              : (typeof origin === 'number' ? `client:${origin}`
              : origin.constructor?.name || typeof origin));
    bump(`Y.transact.origin.${oTag}`);
    if (ms > 50) {
      console.warn('[perf] Y.transact slow', `${ms.toFixed(0)}ms`, `origin=${oTag}`);
    }
    return ret;
  };
  console.log('[perf] Y.Doc.prototype.transact patched');
}
// Patch at module load (not gated on enabled — the patched fn itself is
// gated so cost is one bool check while disabled).
_patchYDocTransact();

// Synthetic verification: spin up a throwaway Y.Doc and run one
// transaction with perf temporarily enabled. If our patched body
// executes, the sentinel gauge gets set. Logs PASS/FAIL so the user
// can tell immediately whether library Y.applyUpdate calls will
// surface in marks. The previous rounds showed `Y.transact` missing
// from marks — this proves whether that's "patch broken" vs "no
// transactions happened in the window".
(function _verifyTransactPatch() {
  try {
    if (typeof Y === 'undefined' || !Y.Doc) return;
    const wasEnabled = enabled;
    enabled = true;
    let bodyRan = false;
    const testDoc = new Y.Doc();
    testDoc.transact(() => { bodyRan = true; }, 'patch-test', false);
    testDoc.destroy();
    enabled = wasEnabled;
    const patchHit = gauges['Y.transactPatchHit'] === 1;
    // Clear the sentinel + counters created by the synthetic run so they
    // don't pollute the real session's data.
    delete gauges['Y.transactPatchHit'];
    delete counters['Y.transact'];
    delete counters['Y.transact.origin.patch-test'];
    delete samples['Y.transact.ms'];
    console.log('[perf] Y.transact patch verification:', patchHit ? 'PASS' : 'FAIL',
                `(bodyRan=${bodyRan})`);
  } catch (e) {
    console.warn('[perf] Y.transact patch verification threw:', e?.message || e);
  }
})();

// ── Timer hooks ─────────────────────────────────────────────────────────
// Round-3 instrumentation surfaced repeating 600ms+ long tasks AFTER
// PartyKit connect completed. That pattern almost always means a
// setInterval / repeating setTimeout. Wrap both at module load so every
// callback is timed. When perf is disabled, the wrapper itself runs but
// just delegates — one extra function call (~tens of ns) per timer.
let _origSetTimeout = null;
let _origSetInterval = null;
function _patchTimers() {
  if (typeof window === 'undefined') return;
  if (_origSetTimeout || _origSetInterval) return;
  _origSetTimeout = window.setTimeout;
  _origSetInterval = window.setInterval;
  const wrap = (fn, kind, delayMs) => {
    if (typeof fn !== 'function') return fn;
    const name = fn.name || '(anonymous)';
    return function patchedTimerCb(...a) {
      if (!enabled) return fn.apply(this, a);
      const _t0 = performance.now();
      try { return fn.apply(this, a); }
      finally {
        const dur = performance.now() - _t0;
        mark(`${kind}.cb.ms`, dur);
        if (dur > 50) {
          bump(`${kind}.slow`);
          console.warn(`[perf] ${kind} slow`, `${dur.toFixed(0)}ms`, `delay=${delayMs}`, `fn=${name}`);
        }
      }
    };
  };
  window.setTimeout = function patchedSetTimeout(fn, ms, ...args) {
    return _origSetTimeout.call(this, wrap(fn, 'setTimeout', ms), ms, ...args);
  };
  window.setInterval = function patchedSetInterval(fn, ms, ...args) {
    return _origSetInterval.call(this, wrap(fn, 'setInterval', ms), ms, ...args);
  };
  console.log('[perf] setTimeout / setInterval patched');
}
_patchTimers();

// ── WebSocket patch ─────────────────────────────────────────────────────
// Round-6 attempted to time PartyKit's message handler by registering a
// sibling addEventListener inside yPartyKit.js. That listener never
// fired in user data — likely because we registered AFTER the library
// did, so by the time our handler ran in queueMicrotask the lib's sync
// work was already complete. This patches the global WebSocket so EVERY
// message-event listener anywhere in the app (PartyKit, Supabase
// Realtime, anything) gets wrapped at registration time. When perf is
// disabled the wrapped listener is a tight passthrough (one bool check).
let _origWS = null;
function _patchWebSocket() {
  if (typeof window === 'undefined' || _origWS) return;
  if (typeof window.WebSocket !== 'function') return;
  _origWS = window.WebSocket;
  function _tagFromUrl(url) {
    if (!url) return 'other';
    if (url.includes('partykit')) return 'partykit';
    if (url.includes('supabase')) return 'supabase';
    if (url.startsWith('wss://') || url.startsWith('ws://')) {
      try {
        const u = new URL(url);
        return u.host.split('.')[0];
      } catch (_) { return 'other'; }
    }
    return 'other';
  }
  function _wrap(listener, tag) {
    return function wsMsgWrapped(e) {
      if (!enabled) return listener.call(this, e);
      const _t0 = performance.now();
      try { return listener.call(this, e); }
      finally {
        const dur = performance.now() - _t0;
        mark(`ws.${tag}.message.ms`, dur);
        bump(`ws.${tag}.messages`);
        if (dur > 50) {
          const sz = (e && e.data && e.data.byteLength) != null
            ? e.data.byteLength
            : (typeof e?.data === 'string' ? e.data.length : 0);
          console.warn(`[perf] slow ws.${tag}.message`, `${dur.toFixed(0)}ms`, `${sz}B`);
        }
      }
    };
  }
  class PatchedWebSocket extends _origWS {
    constructor(url, protocols) {
      super(url, protocols);
      bump('ws.opens');
      this._perfTag = _tagFromUrl(url || '');
      bump(`ws.${this._perfTag}.opens`);
    }
    addEventListener(type, listener, options) {
      if (type === 'message' && typeof listener === 'function') {
        return super.addEventListener(type, _wrap(listener, this._perfTag), options);
      }
      return super.addEventListener(type, listener, options);
    }
    set onmessage(fn) {
      if (typeof fn !== 'function') { super.onmessage = fn; return; }
      super.onmessage = _wrap(fn, this._perfTag);
    }
    get onmessage() { return super.onmessage; }
  }
  // Preserve any static properties libraries might read (CONNECTING etc).
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
    if (k in _origWS) PatchedWebSocket[k] = _origWS[k];
  }
  window.WebSocket = PatchedWebSocket;
  console.log('[perf] WebSocket patched (global)');
}
_patchWebSocket();

function _rafTick(now) {
  if (!enabled) { rafLoopRunning = false; return; }
  const gap = now - lastFrameAt;
  lastFrameAt = now;
  frameCount++;
  // Slow-frame: any inter-frame gap > 50ms (i.e. < 20fps for one frame).
  // Dedupe consecutive identical-bucket gaps within 1s — sustained hitches
  // otherwise spam the console with the same line dozens of times.
  if (gap > 50) {
    const bucket = Math.round(gap / 50) * 50;
    if (bucket === lastSlowFrameBucket && (now - lastSlowFrameAt) < 1000) {
      suppressedSlowFrames++;
    } else {
      lastSlowFrameBucket = bucket;
      lastSlowFrameAt = now;
      const visible = gauges['cards.visible'];
      const total = gauges['cards.total'];
      const lastCsArr = samples['cs.render.ms'];
      const lastCs = lastCsArr && lastCsArr.count ? lastCsArr.buf[(lastCsArr.next - 1 + SAMPLE_CAP) % SAMPLE_CAP] : null;
      console.warn(
        '[perf] slow frame',
        `gap=${gap.toFixed(0)}ms`,
        `fps=${lastTickFps}`,
        lastCs != null ? `lastCsMs=${lastCs.toFixed(1)}` : 'lastCsMs=?',
        `inflight=${gauges['preview.inflight'] ?? 0}`,
        visible != null ? `visible=${visible}/${total}` : 'visible=?',
        suppressedSlowFrames ? `(suppressed=${suppressedSlowFrames})` : null,
      );
    }
  }
  requestAnimationFrame(_rafTick);
}

function _tick() {
  if (!enabled) {
    clearInterval(tickInterval);
    tickInterval = 0;
    return;
  }
  const now = performance.now();
  const elapsed = (now - frameCountAt) / 1000;
  lastTickFps = elapsed > 0 ? Math.round(frameCount / elapsed) : 0;
  frameCount = 0;
  frameCountAt = now;
  // Per-second deltas
  const deltas = {};
  for (const k of Object.keys(counters)) {
    const prev = prevTickCounters[k] || 0;
    const cur = counters[k];
    if (cur !== prev) deltas[k + '/s'] = cur - prev;
    prevTickCounters[k] = cur;
  }
  // Compact single-line tick. Suppress when totally idle UNLESS verbose.
  const hasActivity = Object.keys(deltas).length > 0;
  if (hasActivity || verbose) {
    const base = [
      '[perf] tick',
      `fps=${lastTickFps}`,
      `visible=${gauges['cards.visible'] ?? '?'}/${gauges['cards.total'] ?? '?'}`,
      `inflight=${gauges['preview.inflight'] ?? 0}`,
      deltas,
    ];
    if (verbose) {
      // Include p95/max for every active mark so the user can see current
      // hot paths at a glance without running perf.dump().
      const marksTopline = {};
      for (const k of Object.keys(samples)) {
        const s = _markStats(samples[k]);
        if (s) marksTopline[k] = `${s.p95}/${s.max}`;
      }
      base.push('marks(p95/max):', marksTopline);
    }
    console.log(...base);
  }
  lastTickAt = now;
}

// Restore from localStorage on module load — `perfHud='1'` survives reloads.
if (typeof window !== 'undefined') {
  if (_localStorageGet('perfHud') === '1') {
    enabled = true;
    _startLoops();
    console.log('[perf] auto-enabled from localStorage.perfHud');
  }
  window.perf = { snapshot, dump, reset, enable, disable, toggle, isEnabled, bump, mark, gauge, verbose: setVerbose };
}
