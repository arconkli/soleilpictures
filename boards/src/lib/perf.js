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

const SAMPLE_CAP = 64;  // rolling samples per mark name

const counters = Object.create(null);   // name → integer
const gauges   = Object.create(null);   // name → number
const samples  = Object.create(null);   // name → { buf: number[], next: int }
const prevTickCounters = Object.create(null);  // for per-sec delta computation
let lastTickAt = 0;
let lastTickFps = 0;

let enabled = false;

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
  console.log('[perf] enabled — `perf.snapshot()` / `perf.dump()` / `perf.disable()` available on window.perf');
  _startLoops();
}

export function disable() {
  if (!enabled) return;
  enabled = false;
  _localStorageSet('perfHud', '0');
  console.log('[perf] disabled');
}

export function toggle() {
  if (enabled) disable(); else enable();
  return enabled;
}

export function bump(name, n = 1) {
  if (!enabled) return;
  counters[name] = (counters[name] || 0) + n;
}

export function gauge(name, value) {
  if (!enabled) return;
  gauges[name] = value;
}

export function mark(name, ms) {
  if (!enabled) return;
  let s = samples[name];
  if (!s) { s = { buf: new Array(SAMPLE_CAP).fill(NaN), next: 0, count: 0 }; samples[name] = s; }
  s.buf[s.next] = ms;
  s.next = (s.next + 1) % SAMPLE_CAP;
  if (s.count < SAMPLE_CAP) s.count++;
}

// Optional one-shot timer convenience.
export function time(name, fn) {
  if (!enabled) return fn();
  const t0 = performance.now();
  try { return fn(); }
  finally { mark(name, performance.now() - t0); }
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
  return {
    enabled,
    fps: lastTickFps,
    counters: { ...counters },
    gauges: { ...gauges },
    marks: markStats,
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
  console.groupEnd();
  return snap;
}

export function reset() {
  for (const k of Object.keys(counters)) delete counters[k];
  for (const k of Object.keys(gauges)) delete gauges[k];
  for (const k of Object.keys(samples)) delete samples[k];
  for (const k of Object.keys(prevTickCounters)) delete prevTickCounters[k];
  console.log('[perf] reset');
}

// ── Loops ───────────────────────────────────────────────────────────────
let tickInterval = 0;
let rafLoopRunning = false;
let lastFrameAt = 0;
let frameCount = 0;
let frameCountAt = 0;

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
}

function _rafTick(now) {
  if (!enabled) { rafLoopRunning = false; return; }
  const gap = now - lastFrameAt;
  lastFrameAt = now;
  frameCount++;
  // Slow-frame: any inter-frame gap > 50ms (i.e. < 20fps for one frame)
  if (gap > 50) {
    const visible = gauges['cards.visible'];
    const total = gauges['cards.total'];
    const lastCsArr = samples['cs.render.ms'];
    const lastCs = lastCsArr && lastCsArr.count ? lastCsArr.buf[(lastCsArr.next - 1 + SAMPLE_CAP) % SAMPLE_CAP] : null;
    console.warn(
      '[perf] slow frame',
      `gap=${gap.toFixed(0)}ms`,
      `fps=${lastTickFps}`,
      lastCs != null ? `lastCsMs=${lastCs.toFixed(1)}` : null,
      gauges['preview.inflight'] != null ? `inflight=${gauges['preview.inflight']}` : null,
      visible != null ? `visible=${visible}/${total}` : null,
    );
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
  // Compact single-line tick. Suppress when totally idle.
  const hasActivity = Object.keys(deltas).length > 0;
  if (hasActivity) {
    console.log(
      '[perf] tick',
      `fps=${lastTickFps}`,
      `visible=${gauges['cards.visible'] ?? '?'}/${gauges['cards.total'] ?? '?'}`,
      `inflight=${gauges['preview.inflight'] ?? 0}`,
      deltas,
    );
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
  window.perf = { snapshot, dump, reset, enable, disable, toggle, isEnabled, bump, mark, gauge };
}
