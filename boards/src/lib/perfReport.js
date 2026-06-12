// perfReport.js — ALWAYS-ON field jank telemetry. The perf.js HUD measures
// richly but is opt-in (localStorage.perfHud) and never leaves the device;
// this module is its tiny, always-running sibling: it watches for two jank
// signals and posts hard-capped incident rows to public.client_errors
// (kind='perf') so the admin Errors tab shows WHAT is janking, WHERE
// (board id, public vs authed), and UNDER WHAT LOAD (cards/strokes/zoom).
//
// Signals:
//   1. Long main-thread tasks ≥ LONGTASK_MS — a PerformanceObserver, near-zero
//      idle cost.
//   2. Sustained low fps DURING INTERACTION — a rAF sampler that only runs
//      while the tab is visible AND a pointer/wheel event happened in the
//      last second (it self-stops otherwise, so it never costs battery at
//      rest). Two consecutive ~1s windows under LOW_FPS → incident. This
//      catches death-by-a-thousand-sub-50ms-tasks (the dense-board render
//      churn signature) that the longtask observer can't see.
//   3. Single FRAME GAPS ≥ FRAME_GAP_MS during interaction — the rAF delta
//      between consecutive sampler ticks. A compositor/GPU-bound stall
//      (texture upload, raster churn) freezes rAF while the main thread
//      stays idle: no longtask fires and the per-second fps average can
//      stay high, so signals 1 and 2 both miss it. This was exactly the
//      field signature on image-heavy boards (450ms gaps, zero longtasks).
//
// GPU tile drops themselves are invisible to JS; their CAUSE (oversized
// raster/render work) surfaces through these signals.
//
// Bucket strings are CONSTANT (never interpolate values) — the admin Errors
// tab groups rows by raw message; all variable data rides in the JSON
// context (the row's `stack` column).
//
// Hard caps: ≤ MAX_PER_SESSION incidents, ≥ MIN_GAP_MS apart, tab visible
// only, nothing in the first STARTUP_MUTE_MS (load noise), DEV builds never
// post (window.__perfReport still records so tests can assert).
// Kill switch: localStorage.perfReportOff = '1'.

import { postPerfIncident } from './errorReporting.js';
import { getDeviceInfo } from './device.js';

const LONGTASK_MS = 300;
const LOW_FPS = 20;
const VERY_LOW_FPS = 10;
const FRAME_GAP_MS = 350;
const FRAME_GAP_HUGE_MS = 1_000;
// Gaps beyond this are tab-switch / sleep artifacts, not jank.
const FRAME_GAP_DISCARD_MS = 10_000;
const MAX_PER_SESSION = 6;
const MIN_GAP_MS = 20_000;
const STARTUP_MUTE_MS = 3_000;
const INTERACTION_WINDOW_MS = 1_000;

const context = {};          // board context, pushed by CanvasSurface
const counters = {};         // always-on counters (image tiers), via bumpPerf
let initAt = 0;
let sentCount = 0;
let lastSentAt = 0;
let lastInteractionAt = 0;
let gestureActiveUntil = 0;
let lastFps = null;
let inited = false;

function off() {
  try { return localStorage.getItem('perfReportOff') === '1'; } catch (_) { return false; }
}

// Merge board context — called by CanvasSurface on board open and at
// gesture-settle commits. Cheap object writes only; never per frame.
export function setPerfContext(patch) {
  Object.assign(context, patch);
}
export function clearPerfContext() {
  for (const k of Object.keys(context)) delete context[k];
}
// Always-on counters (perf.js's are dead when the HUD is off).
export function bumpPerf(name, n = 1) {
  counters[name] = (counters[name] || 0) + n;
}
// Gesture handlers stamp their deadline; incidents compare at fire time.
export function markGestureActiveUntil(ts) {
  gestureActiveUntil = ts || 0;
}

function buildContext(extra) {
  let heapMB = null;
  try {
    const m = performance.memory;
    if (m?.usedJSHeapSize) heapMB = Math.round(m.usedJSHeapSize / 1048576);
  } catch (_) {}
  return {
    board_id: context.boardId || null,
    workspace_id: context.workspaceId || null,
    is_public: !!context.isPublic,
    zoom: context.zoom ?? null,
    cards_total: context.cardsTotal ?? null,
    cards_visible: context.cardsVisible ?? null,
    strokes_count: context.strokesCount ?? null,
    arrows_count: context.arrowsCount ?? null,
    counters: { ...counters },
    heap_used_mb: heapMB,
    dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
    device: (() => { try { return getDeviceInfo(); } catch (_) { return null; } })(),
    fps: lastFps,
    gesture_active: performance.now() < gestureActiveUntil,
    since_load_s: Math.round((performance.now()) / 1000),
    ...extra,
  };
}

function report(bucket, extra) {
  if (off()) return;
  const now = performance.now();
  if (now - initAt < STARTUP_MUTE_MS) return;
  if (sentCount >= MAX_PER_SESSION) return;
  if (lastSentAt && now - lastSentAt < MIN_GAP_MS) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  sentCount += 1;
  lastSentAt = now;
  const ctx = buildContext(extra);
  try { window.__perfReport?.incidents.push({ bucket, ctx }); } catch (_) {}
  postPerfIncident(bucket, ctx);
}

// '(canvas)' when a board is open, '(app)' otherwise — separates board jank
// from app-wide jank without varying the bucket string.
const where = () => (context.boardId ? '(canvas)' : '(app)');

function longtaskBucket(ms) {
  if (ms >= 1500) return `perf: longtask >1500ms ${where()}`;
  if (ms >= 600) return `perf: longtask 600-1500ms ${where()}`;
  return `perf: longtask 300-600ms ${where()}`;
}
function lowFpsBucket(fps) {
  return fps < VERY_LOW_FPS
    ? `perf: low-fps <10 interaction ${where()}`
    : `perf: low-fps 10-20 interaction ${where()}`;
}
function frameGapBucket(ms) {
  return ms >= FRAME_GAP_HUGE_MS
    ? `perf: frame-gap >1000ms ${where()}`
    : `perf: frame-gap 350-1000ms ${where()}`;
}

// ── Interaction-gated fps sampler ─────────────────────────────────────────
let samplerRunning = false;
let windowStart = 0;
let windowFrames = 0;
let lowWindows = 0;
let prevTickAt = 0;

function samplerTick() {
  const now = performance.now();
  // Frame-gap check FIRST, before the self-stop: by the time a stalled frame
  // finally fires, lastInteractionAt may have aged past the window — what
  // matters is that interaction was live when the gap BEGAN (prevTickAt).
  // (lastInteractionAt can also move DURING a GPU-bound gap — input keeps
  // dispatching while the compositor is stuck — which makes the delta
  // negative; that still counts as interacting.)
  if (prevTickAt > 0) {
    const gap = now - prevTickAt;
    if (gap >= FRAME_GAP_MS && gap < FRAME_GAP_DISCARD_MS
        && prevTickAt - lastInteractionAt < INTERACTION_WINDOW_MS) {
      report(frameGapBucket(gap), { gap_ms: Math.round(gap) });
    }
  }
  prevTickAt = now;
  const interacting = now - lastInteractionAt < INTERACTION_WINDOW_MS;
  const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
  if (!interacting || !visible) {
    samplerRunning = false;   // self-stop; interaction listeners restart it
    windowFrames = 0; lowWindows = 0; prevTickAt = 0;
    return;
  }
  windowFrames += 1;
  if (now - windowStart >= 1000) {
    const fps = Math.round((windowFrames * 1000) / (now - windowStart));
    lastFps = fps;
    windowStart = now;
    windowFrames = 0;
    if (fps < LOW_FPS) {
      lowWindows += 1;
      if (lowWindows >= 2) {   // two consecutive bad windows = sustained jank
        lowWindows = 0;
        report(lowFpsBucket(fps), { observed_fps: fps });
      }
    } else {
      lowWindows = 0;
    }
  }
  requestAnimationFrame(samplerTick);
}

function onInteraction() {
  lastInteractionAt = performance.now();
  if (!samplerRunning) {
    samplerRunning = true;
    windowStart = lastInteractionAt;
    windowFrames = 0;
    prevTickAt = 0;   // a restart is not a frame gap
    requestAnimationFrame(samplerTick);
  }
}

export function initPerfReport() {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  initAt = performance.now();
  window.__perfReport = { incidents: [], counters, context };

  // Long main-thread tasks — cheap, always on.
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration >= LONGTASK_MS) {
          report(longtaskBucket(e.duration), { longtask_ms: Math.round(e.duration) });
        }
      }
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch (_) { /* longtask unsupported (Safari) — fps sampler still works */ }

  // Interaction stamps — passive capture listeners, a timestamp write each.
  try {
    const opts = { capture: true, passive: true };
    window.addEventListener('pointerdown', onInteraction, opts);
    window.addEventListener('pointermove', onInteraction, opts);
    window.addEventListener('wheel', onInteraction, opts);
  } catch (_) {}

  // Hiding the tab pauses rAF; without this, the first tick after re-show
  // would read the whole hidden span as one giant "frame gap".
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') prevTickAt = 0;
    }, { passive: true });
  } catch (_) {}
}
