// journey.js — high-resolution, AI-analyzable trace of a brand-new user's FIRST
// authenticated session, so we can pinpoint the exact moment they fall off.
//
//   import { beginJourney, setJourneyState, journey, endJourney } from './journey.js';
//   beginJourney(user.id, { isNew, tier });               // opens the journey (once per uid)
//   setJourneyState({ phase: JOURNEY_PHASE.SEED });        // keep the live snapshot fresh
//   journey(EV.PS_SEED_SKIP, { gate: 'canvas_not_empty' }); // stamp an enveloped event
//
// WHY THIS EXISTS: the post-signup window had big blind spots (no signup anchor,
// dark tier-gate, silent seed-skip, no abandonment, no "where did they stall"
// signal). This module fills them and, crucially, stamps a consistent ENVELOPE on
// every ps_* event so an AI can reconstruct each user's exact, ordered, timed path
// with one query (see migration 0161 admin_journey_* RPCs + the SQL recipes).
//
// ENVELOPE (merged onto every ps_* event's props):
//   jid    — journey id, minted once at first entry (stable across the session/reloads)
//   seq    — monotonic per-journey counter (persisted high-water → total order even across reloads)
//   t_ms   — ms since first entry (t0)
//   + a live STATE SNAPSHOT: phase, from_phase, tier, onb_seeded, onb_done,
//     ad_pending, boards, gcards, route
// (session_id / user_id / path / occurred_at / source / device / exp_* are added
//  automatically by analytics.buildRow — we never duplicate them here.)
//
// DESIGN: kept dependency-light and node-importable (the emitter is INJECTED via
// setJourneySink rather than a static import of analytics.js, which reads
// import.meta.env and would break the plain-node unit test — mirrors the
// frictionSignal.js "pure core, caller owns side effects" discipline). Never
// throws into callers. Coalesces the micro-interaction firehose into batched
// PS_TRACE rows so it stays far under the analytics queue cap.

import { EV, JOURNEY_PHASE } from './analyticsEvents.js';

// ── Injected emitter (wired once from the vite-only consumer modules) ──────────
let _log    = () => {};   // logEvent(name, props)
let _logNow = () => {};   // logEventNow(name, props) — immediate keepalive-beacon
let _now    = () => Date.now();
export function setJourneySink({ logEvent, logEventNow, now } = {}) {
  if (typeof logEvent === 'function')    _log    = logEvent;
  if (typeof logEventNow === 'function') _logNow = logEventNow;
  if (typeof now === 'function')         _now    = now;
}

// ── localStorage keys (per-uid; survive reloads) ──────────────────────────────
const JID_KEY    = 'soleil_ps_jid_';
const T0_KEY     = 'soleil_ps_t0_';
const SEQ_KEY    = 'soleil_ps_seq_';
const DONE_KEY   = 'soleil_ps_done_';
const SIGNUP_KEY = 'soleil_ps_signup_';
const OTP_KEY    = 'soleil_ps_otp_at';   // most-recent otp-verify epoch ms (written by AuthGate)

// ── Tunables ──────────────────────────────────────────────────────────────────
const HB_INTERVAL_MS    = 12000;   // heartbeat cadence
const HB_MAX_BEATS       = 40;     // hard cap on heartbeat rows per journey
const IDLE_CAP_MS        = 600000; // clamp idle_ms so a backgrounded tab can't report absurd values
const TRACE_FLUSH_MS     = 4000;   // coalesce firehose into one PS_TRACE row this often
const TRACE_MAX_RECORDS  = 30;     // ...or whenever the buffer hits this many records
const TRACE_MAX_EVENTS   = 120;    // hard cap on PS_TRACE rows per journey
const SCROLL_THROTTLE_MS  = 333;   // ~3 scroll records/sec max
const INPUT_THROTTLE_MS   = 600;   // coalesce keystrokes — field identity only, never value
const ACTIVITY_THROTTLE_MS = 1000; // update lastInteractionAt at most ~1/s

const SPECIAL_KEYS = new Set([
  'Enter', 'Escape', 'Tab', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

// ── Module state ──────────────────────────────────────────────────────────────
let JID = null;
let T0 = 0;
let SEQ = 0;
let UID = null;
let OPEN = false;
let snapshot = freshSnapshot();

let lastInteractionAt = 0;
let lastActivityWrite = 0;

let hbTimer = null;
let hbBeats = 0;

let traceBuf = [];
let traceTimer = null;
let traceEvents = 0;
let lastScrollAt = 0;
let lastInputAt = 0;

let interactionsBound = false;
let historyPatched = false;
let origPush = null;
let origReplace = null;
let lastRoute = null;

function freshSnapshot() {
  return {
    phase: null, from_phase: null, tier: null,
    onb_seeded: null, onb_done: null, ad_pending: null,
    boards: null, gcards: null, route: null,
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function ls() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; } }
function readLS(k) { try { const s = ls(); return s ? s.getItem(k) : null; } catch (_) { return null; } }
function writeLS(k, v) { try { const s = ls(); if (s) s.setItem(k, v); } catch (_) {} }
function doneStamp(uid) { return readLS(DONE_KEY + uid) === '1'; }
function tNow() { return Math.max(0, _now() - T0); }
function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }
function mintUuid() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
  return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padStart(12, '0');
}
function isVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

// Monotonic per-journey sequence, persisted so it survives reloads (one
// localStorage write per event — fine at our event volume).
function nextSeq() {
  SEQ += 1;
  if (UID) writeLS(SEQ_KEY + UID, String(SEQ));
  return SEQ;
}

// ── Public API ────────────────────────────────────────────────────────────────

// Idempotent. Opens the journey for a genuinely-new user (isNew, decided by the
// caller from onboarding state). No-op if already done for this uid, already open
// for this uid, or not new. Mints jid/t0/seq once, emits the PS_SIGNUP anchor once
// per uid, and starts the heartbeat + firehose. Returns the active jid (or null).
export function beginJourney(uid, { isNew = false, tier = null } = {}) {
  if (!uid) return null;
  if (OPEN && UID === uid) return JID;     // already running this journey
  if (doneStamp(uid)) return null;         // finished — never restart
  if (!isNew) return null;                 // only brand-new users

  UID = uid;
  JID = readLS(JID_KEY + uid) || mintUuid();
  writeLS(JID_KEY + uid, JID);
  const persistedT0 = Number(readLS(T0_KEY + uid)) || 0;
  if (persistedT0 > 0) {
    T0 = persistedT0;
  } else {
    T0 = _now();
    writeLS(T0_KEY + uid, String(T0));
  }
  SEQ = Number(readLS(SEQ_KEY + uid)) || 0;
  OPEN = true;
  lastInteractionAt = _now();
  if (!snapshot.phase) snapshot.phase = JOURNEY_PHASE.SIGNUP;
  if (tier != null) snapshot.tier = tier;

  bindInteractions();
  startHeartbeat();
  startTraceFlush();

  // The signup anchor — exactly once per uid (so a returning sign-in never re-fires).
  if (readLS(SIGNUP_KEY + uid) !== '1') {
    writeLS(SIGNUP_KEY + uid, '1');
    let msSinceOtp = null;
    const otpAt = Number(readLS(OTP_KEY)) || 0;
    if (otpAt > 0) msSinceOtp = Math.max(0, _now() - otpAt);
    journey(EV.PS_SIGNUP, { is_new: true, tier: tier, ms_since_otp: msSinceOtp });
  }
  return JID;
}

// Shallow-merge a partial into the live snapshot. Tracks from_phase when `phase`
// changes. Cheap; emits nothing; safe to call every render (even before the
// journey opens — it just updates the in-memory snapshot, which only matters once
// a journey is open).
export function setJourneyState(partial) {
  if (!partial || typeof partial !== 'object') return;
  if ('phase' in partial && partial.phase && partial.phase !== snapshot.phase) {
    snapshot.from_phase = snapshot.phase;
  }
  for (const k in partial) {
    if (partial[k] !== undefined) snapshot[k] = partial[k];
  }
}

// Stamp the envelope onto an event and emit it. No-op when the journey isn't open
// (so the same call sites are inert for returning users). opts.now → keepalive
// beacon (use for the last-event-before-a-bounce: PS_PAUSE / PS_END / *_abandon).
export function journey(name, detail = {}, opts = {}) {
  if (!OPEN || !name) return;
  try {
    const row = {
      jid: JID,
      seq: nextSeq(),
      t_ms: tNow(),
      phase: snapshot.phase,
      from_phase: snapshot.from_phase,
      tier: snapshot.tier,
      onb_seeded: snapshot.onb_seeded,
      onb_done: snapshot.onb_done,
      ad_pending: snapshot.ad_pending,
      boards: snapshot.boards,
      gcards: snapshot.gcards,
      route: snapshot.route,
    };
    if (detail && typeof detail === 'object') for (const k in detail) row[k] = detail[k];
    if (opts && opts.now) _logNow(name, row);
    else _log(name, row);
  } catch (_) {}
}

// Record a compact micro-interaction into the firehose buffer (also marks
// activity for the idle clock). Exposed for the DOM listeners + the unit test.
export function recordInteraction(kind, target, extra) {
  if (!OPEN) return;
  lastInteractionAt = _now();
  pushRec(kind, target, extra);
}

// Close the journey: flush the firehose, beacon a final PS_END, stamp done (so it
// never reopens for this uid), stop the heartbeat/flush timers + unbind listeners.
export function endJourney(reason) {
  if (!OPEN) return;
  try { flushTrace(true); } catch (_) {}
  try { journey(EV.PS_END, { reason: reason || 'session_end' }, { now: true }); } catch (_) {}
  OPEN = false;
  if (UID) writeLS(DONE_KEY + UID, '1');
  stopHeartbeat();
  stopTraceFlush();
  unbindInteractions();
}

export function isJourneyOpen() { return OPEN; }
export function currentPhase() { return snapshot.phase; }

// ── Firehose buffer ───────────────────────────────────────────────────────────
function pushRec(kind, target, extra) {
  if (!OPEN || traceEvents >= TRACE_MAX_EVENTS) return;
  const rec = { t: tNow(), k: kind };
  if (target) rec.tgt = target;
  if (extra) for (const k in extra) rec[k] = extra[k];
  traceBuf.push(rec);
  if (traceBuf.length >= TRACE_MAX_RECORDS) flushTrace(false);
}

function flushTrace(beacon) {
  if (!traceBuf.length) return;
  if (traceEvents >= TRACE_MAX_EVENTS) { traceBuf = []; return; }
  const ev = traceBuf;
  traceBuf = [];
  traceEvents += 1;
  const from_t = ev[0] ? ev[0].t : tNow();
  const to_t = ev[ev.length - 1] ? ev[ev.length - 1].t : from_t;
  journey(EV.PS_TRACE, { from_t, to_t, n: ev.length, ev }, beacon ? { now: true } : undefined);
}

function startTraceFlush() {
  if (traceTimer || typeof window === 'undefined') return;
  traceTimer = setInterval(() => {
    if (!OPEN) { stopTraceFlush(); return; }
    if (traceBuf.length) flushTrace(false);
  }, TRACE_FLUSH_MS);
}
function stopTraceFlush() { if (traceTimer) { clearInterval(traceTimer); traceTimer = null; } }

// ── Heartbeat ─────────────────────────────────────────────────────────────────
function startHeartbeat() {
  if (hbTimer || typeof window === 'undefined') return;
  hbTimer = setInterval(heartbeatTick, HB_INTERVAL_MS);
}
function stopHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

function heartbeatTick() {
  if (!OPEN || hbBeats >= HB_MAX_BEATS) { stopHeartbeat(); return; }
  if (!isVisible()) return;   // a hidden tab emits PS_PAUSE instead; conserve the beat budget
  const idle = Math.min(IDLE_CAP_MS, _now() - lastInteractionAt);
  journey(EV.PS_HEARTBEAT, { idle_ms: idle, visible: true, beat: hbBeats });
  hbBeats += 1;
}

// ── Target description (compact + PII-free) ───────────────────────────────────
// Walks up to the nearest meaningful node. NEVER returns input values or typed
// characters — only structural identifiers + UI-chrome labels.
export function describeTarget(el) {
  try {
    if (!el || el === (typeof document !== 'undefined' ? document : null) || el === (typeof window !== 'undefined' ? window : null)) return 'document';
    if (el.nodeType === 9) return 'document';
    let node = el.nodeType === 1 ? el : el.parentElement;
    for (let i = 0; node && i < 4; i++) {
      const get = node.getAttribute ? (k) => node.getAttribute(k) : () => null;
      const dps = get('data-ps') || get('data-testid');
      if (dps) return trunc(dps, 40);
      const tag = node.tagName ? node.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        const type = get('type') || tag.toLowerCase();
        const name = get('name') || node.id || get('aria-label') || '';
        return 'field:' + trunc(type + (name ? ':' + name : ''), 40);   // identity only — never the value
      }
      if (node.id) return '#' + trunc(node.id, 40);
      if (tag === 'BUTTON' || get('role') === 'button') {
        const txt = (node.textContent || '').trim() || get('aria-label') || '';
        return 'button:' + trunc(txt, 40);
      }
      if (tag === 'A') return 'a:' + trunc((node.textContent || '').trim(), 40);
      node = node.parentElement;
    }
    const base = el.nodeType === 1 ? el : el.parentElement;
    if (!base || !base.tagName) return 'unknown';
    const cls = (typeof base.className === 'string' ? base.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return base.tagName.toLowerCase() + (cls ? '.' + cls : '');
  } catch (_) { return 'unknown'; }
}

// ── DOM listeners (bound once, only while a journey is open) ───────────────────
function markActivity() {
  const now = _now();
  if (now - lastActivityWrite < ACTIVITY_THROTTLE_MS) return;
  lastActivityWrite = now;
  lastInteractionAt = now;
}
function onClick(e)  { recordInteraction('click', describeTarget(e.target)); }
function onFocus(e)  { pushRec('focus', describeTarget(e.target)); }
function onScroll(e) {
  if (!OPEN) return;
  lastInteractionAt = _now();
  const now = _now();
  if (now - lastScrollAt < SCROLL_THROTTLE_MS) return;
  lastScrollAt = now;
  let y = 0;
  try {
    const t = e.target;
    y = (t && t.nodeType === 1 && t.scrollTop != null) ? Math.round(t.scrollTop) : Math.round((typeof window !== 'undefined' && window.scrollY) || 0);
  } catch (_) {}
  pushRec('scroll', describeTarget(e.target), { y });
}
function onInput(e) {
  if (!OPEN) return;
  lastInteractionAt = _now();
  const now = _now();
  if (now - lastInputAt < INPUT_THROTTLE_MS) return;   // coalesce keystrokes
  lastInputAt = now;
  pushRec('input', describeTarget(e.target));           // field identity only — never the value
}
function onKey(e) {
  if (!OPEN) return;
  lastInteractionAt = _now();
  if (SPECIAL_KEYS.has(e.key)) pushRec('key', null, { key: e.key });
  // printable keys are NEVER recorded (no characters, no cadence)
}
function onVisibility() {
  if (!OPEN) return;
  if (document.visibilityState === 'hidden') {
    const idle = Math.min(IDLE_CAP_MS, _now() - lastInteractionAt);   // measure BEFORE recording 'hide'
    pushRec('hide');
    flushTrace(true);
    journey(EV.PS_PAUSE, { idle_ms: idle, beat: hbBeats }, { now: true });
  } else {
    pushRec('show');
  }
}
function onPageHide() { if (OPEN) { try { flushTrace(true); } catch (_) {} } }
function maybeRoute() {
  try {
    const p = typeof location !== 'undefined' ? location.pathname : null;
    if (p && p !== lastRoute) { lastRoute = p; if (OPEN) pushRec('route', null, { to: trunc(p, 80) }); }
  } catch (_) {}
}
function onPopState() { maybeRoute(); }

function patchHistory() {
  if (historyPatched || typeof history === 'undefined') return;
  historyPatched = true;
  try {
    lastRoute = typeof location !== 'undefined' ? location.pathname : null;
    origPush = history.pushState;
    history.pushState = function (...args) { const r = origPush.apply(this, args); maybeRoute(); return r; };
    origReplace = history.replaceState;
    history.replaceState = function (...args) { const r = origReplace.apply(this, args); maybeRoute(); return r; };
  } catch (_) {}
}
function unpatchHistory() {
  if (!historyPatched) return;
  historyPatched = false;
  try {
    if (origPush) history.pushState = origPush;
    if (origReplace) history.replaceState = origReplace;
  } catch (_) {}
  origPush = origReplace = null;
}

function bindInteractions() {
  if (interactionsBound || typeof window === 'undefined') return;
  interactionsBound = true;
  const opts = { passive: true, capture: true };
  for (const ev of ['pointermove', 'wheel', 'touchstart']) window.addEventListener(ev, markActivity, opts);
  window.addEventListener('click', onClick, opts);
  window.addEventListener('scroll', onScroll, opts);
  window.addEventListener('focusin', onFocus, opts);
  window.addEventListener('input', onInput, opts);
  window.addEventListener('keydown', onKey, opts);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  patchHistory();
  window.addEventListener('popstate', onPopState);
}
function unbindInteractions() {
  if (!interactionsBound || typeof window === 'undefined') return;
  interactionsBound = false;
  const opts = { capture: true };
  for (const ev of ['pointermove', 'wheel', 'touchstart']) window.removeEventListener(ev, markActivity, opts);
  window.removeEventListener('click', onClick, opts);
  window.removeEventListener('scroll', onScroll, opts);
  window.removeEventListener('focusin', onFocus, opts);
  window.removeEventListener('input', onInput, opts);
  window.removeEventListener('keydown', onKey, opts);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  unpatchHistory();
  window.removeEventListener('popstate', onPopState);
}

// ── Test-only hooks (mirrors frictionSignal.js's injectable seams) ────────────
export function __heartbeatTick() { heartbeatTick(); }
export function __resetForTest() {
  JID = null; T0 = 0; SEQ = 0; UID = null; OPEN = false;
  snapshot = freshSnapshot();
  lastInteractionAt = 0; lastActivityWrite = 0;
  stopHeartbeat(); hbBeats = 0;
  stopTraceFlush(); traceBuf = []; traceEvents = 0; lastScrollAt = 0; lastInputAt = 0;
  interactionsBound = false;
  unpatchHistory(); lastRoute = null;
}
