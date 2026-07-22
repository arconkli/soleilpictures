// landingMetrics.js — uniform engagement instrumentation for the PUBLIC pages
// (the 9 SEO landing pages, /, /pricing, /explore, /c/<slug>, /share). Emits the
// lp_* event family (see analyticsEvents.js) with a common {page, page_kind}
// base, so one scorecard RPC can rank every landing page by the same yardstick:
// views → scroll depth → dwell → CTA clicks → signups.
//
//   const t = createLandingTracker({ page: '/tools/mood-board-maker', pageKind: 'tool' });
//   t.view();                      // lp_view (once)
//   t.reportProgress(0.6);         // lp_scroll at each crossed threshold (once each)
//   t.ctaClick('hero', '/');       // lp_cta_click (beacon — survives the navigation)
//   t.end('hide');                 // lp_dwell {ms,max_depth} (once) + final trace flush
//
// Also coalesces an ANONYMOUS-visitor micro-interaction trace (lp_trace) —
// rage-clicks, dead-clicks, CTA hover-hesitation — the "why didn't they
// convert" layer. The DOM layer (hooks/useLandingEngagement.js) only arms the
// trace when there is no session and no post-signup journey open, so it never
// overlaps journey.js's ps_trace firehose.
//
// DESIGN: same discipline as journey.js — node-importable pure core, emitter
// INJECTED via setLandingSink (analytics.js reads import.meta.env and would
// break the plain-node unit test), never throws into callers, PII-safe target
// descriptors come exclusively from journey.describeTarget (structural
// identifiers only — never input values or typed characters).

import { EV } from './analyticsEvents.js';

// ── Injected emitter (wired once from the vite-only hook module) ──────────────
let _log    = () => {};   // logEvent(name, props)
let _logNow = () => {};   // logEventNow(name, props) — immediate keepalive-beacon
let _now    = () => Date.now();
export function setLandingSink({ logEvent, logEventNow, now } = {}) {
  if (typeof logEvent === 'function')    _log    = logEvent;
  if (typeof logEventNow === 'function') _logNow = logEventNow;
  if (typeof now === 'function')         _now    = now;
}

// ── Tunables (trace constants mirror journey.js's firehose) ───────────────────
const DEPTH_THRESHOLDS   = [0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
export const TRACE_FLUSH_MS = 4000;  // coalesce the firehose into one lp_trace row this often
const TRACE_MAX_RECORDS  = 30;       // ...or whenever the buffer hits this many records
const TRACE_MAX_ROWS     = 20;       // hard cap on lp_trace rows per pageload (anon traffic > journey traffic)
const SCROLL_THROTTLE_MS = 333;      // ~3 scroll records/sec max
const INPUT_THROTTLE_MS  = 600;      // coalesce keystrokes — field identity only, never value
const RAGE_WINDOW_MS     = 1000;     // ≥3 clicks on the same target inside this window = rage
const RAGE_MIN_CLICKS    = 3;
export const HOVER_HESITATION_MS = 300;  // pointer lingered on a CTA this long without clicking = hesitation

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY', 'LABEL']);

function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }
function round2(n) { return Math.round(n * 100) / 100; }

// Dead-click classifier: a click is "dead" when nothing within 4 ancestor hops
// is interactive — the visitor tried to act on something inert (screenshot-like
// image, plain heading), a strong "this looked clickable" signal.
export function isInteractiveTarget(el) {
  try {
    let node = el && el.nodeType === 1 ? el : (el ? el.parentElement : null);
    for (let i = 0; node && i < 4; i++) {
      const tag = node.tagName ? node.tagName.toUpperCase() : '';
      if (INTERACTIVE_TAGS.has(tag)) return true;
      const get = node.getAttribute ? (k) => node.getAttribute(k) : () => null;
      if (get('role') === 'button' || get('data-lp-cta') != null) return true;
      node = node.parentElement;
    }
  } catch (_) {}
  return false;
}

// One tracker per pageload of a public page. `legacy` maps let `/` keep
// emitting its historical names (landing_scroll {depth} / landing_dwell
// {ms,max_depth}) from this shared path with byte-identical prop shapes — the
// signup-funnel RPCs read those names.
export function createLandingTracker({ page, pageKind, legacy = {}, thresholds = DEPTH_THRESHOLDS } = {}) {
  const base = { page, page_kind: pageKind };
  const t0 = _now();

  let viewed = false;
  let ended = false;        // terminal: page gone (pagehide/unmount) — nothing records after
  let dwellFired = false;   // lp_dwell is once; tracking continues after a tab-hide
  let maxDepth = 0;
  const firedDepths = new Set();
  const seenSections = new Set();
  const seenFaq = new Set();

  // ── Trace state (armed only for anonymous visitors by the DOM layer) ──
  let traceArmed = false;
  let traceBuf = [];
  let traceRows = 0;
  let lastScrollAt = 0;
  let lastTraceP = null;
  let lastInputAt = 0;
  let rage = { tgt: null, times: [], fired: false };

  function tMs() { return Math.max(0, _now() - t0); }

  function pushRec(kind, tgt, extra) {
    if (!traceArmed || ended || traceRows >= TRACE_MAX_ROWS) return;
    const rec = { t: tMs(), k: kind };
    if (tgt) rec.tgt = tgt;
    if (extra) for (const k in extra) rec[k] = extra[k];
    traceBuf.push(rec);
    if (traceBuf.length >= TRACE_MAX_RECORDS) flushTrace(false);
  }

  function flushTrace(beacon) {
    if (!traceBuf.length) return;
    if (traceRows >= TRACE_MAX_ROWS) { traceBuf = []; return; }
    const ev = traceBuf;
    traceBuf = [];
    traceRows += 1;
    const row = { ...base, from_t: ev[0].t, to_t: ev[ev.length - 1].t, n: ev.length, ev };
    try { if (beacon) _logNow(EV.LP_TRACE, row); else _log(EV.LP_TRACE, row); } catch (_) {}
  }

  return {
    page,

    // lp_view — once per pageload.
    view() {
      if (viewed) return;
      viewed = true;
      try { _log(EV.LP_VIEW, { ...base }); } catch (_) {}
    },

    // Scroll progress 0..1 (caller computes it — window OR overflow container OR
    // the sign-in reveal's manual p). Fires lp_scroll once per crossed threshold
    // and keeps max_depth for the dwell row. Also feeds the trace's throttled
    // scroll records so hesitation/backtracking is visible in lp_trace.
    reportProgress(p) {
      if (ended || typeof p !== 'number' || Number.isNaN(p)) return;
      p = Math.max(0, Math.min(1, p));
      if (p > maxDepth) maxDepth = p;
      for (const m of thresholds) {
        if (p >= m && !firedDepths.has(m)) {
          firedDepths.add(m);
          try {
            _log(EV.LP_SCROLL, { ...base, depth: m });
            if (legacy.scroll) _log(legacy.scroll, { depth: m });
          } catch (_) {}
        }
      }
      if (traceArmed) {
        const now = _now();
        // Throttled AND change-gated: '/' feeds progress every rAF frame, so a
        // time-only throttle would fill the trace with identical p records.
        if (now - lastScrollAt >= SCROLL_THROTTLE_MS
            && (lastTraceP === null || Math.abs(p - lastTraceP) >= 0.02)) {
          lastScrollAt = now;
          lastTraceP = p;
          pushRec('scroll', null, { p: round2(p) });
        }
      }
    },

    // A page with no scrollable range (short viewport-fit page) is fully seen —
    // record depth 1 for the dwell row without firing threshold events.
    markFullyVisible() { if (maxDepth < 1) maxDepth = 1; },

    // lp_section — first ≥50% visibility, once per section id.
    sectionSeen(id, idx) {
      if (ended || !id || seenSections.has(id)) return;
      seenSections.add(id);
      try { _log(EV.LP_SECTION, { ...base, section: id, idx, t_ms: tMs() }); } catch (_) {}
    },

    // Once per FAQ item per pageload — a toggle-happy visitor is one signal,
    // not a row per <details> open.
    faqOpen(idx, q) {
      if (ended || seenFaq.has(idx)) return;
      seenFaq.add(idx);
      try { _log(EV.LP_FAQ, { ...base, idx, q: trunc(q, 80) }); } catch (_) {}
    },

    // CTA click — beacon (navigation follows). intent defaults to 'signup';
    // pass {intent:'nav'} for browse links so CTR stays honest. Also drops a
    // 'cta' trace record so the click sits in the interaction timeline.
    ctaClick(pos, href, extra) {
      try { _logNow(EV.LP_CTA_CLICK, { ...base, pos, href: trunc(href, 200), intent: 'signup', ...extra }); } catch (_) {}
      pushRec('cta', pos);
    },

    // Example-board click — beacon (navigates to /c/<slug>).
    exampleClick(slug, pos) {
      try { _logNow(EV.LP_EXAMPLE_CLICK, { ...base, slug, pos }); } catch (_) {}
      pushRec('cta', 'example:' + trunc(slug, 40));
    },

    // ── Anonymous micro-interaction trace (armed by the DOM layer only when
    //    there is no session and no ps_* journey open) ──
    armTrace() { traceArmed = true; },
    isTraceArmed() { return traceArmed; },

    // Every click: 'click' (interactive target) or 'dead' (inert target), plus
    // a one-per-burst 'rage' record at ≥3 clicks/1s on the same target.
    traceClick(tgt, interactive) {
      if (!traceArmed || ended) return;
      const now = _now();
      if (rage.tgt !== tgt) rage = { tgt, times: [], fired: false };
      rage.times = rage.times.filter((t) => now - t < RAGE_WINDOW_MS);
      if (rage.times.length === 0) rage.fired = false;   // burst over → a new one may fire again
      rage.times.push(now);
      pushRec(interactive ? 'click' : 'dead', tgt);
      if (rage.times.length >= RAGE_MIN_CLICKS && !rage.fired) {
        rage.fired = true;
        pushRec('rage', tgt, { n: rage.times.length });
      }
    },

    traceInput(tgt) {
      if (!traceArmed || ended) return;
      const now = _now();
      if (now - lastInputAt < INPUT_THROTTLE_MS) return;   // coalesce keystrokes
      lastInputAt = now;
      pushRec('input', tgt);                                // field identity only — never the value
    },

    // Pointer lingered on a CTA ≥ HOVER_HESITATION_MS then left without
    // clicking — the almost-converted signal.
    traceHover(tgt, ms) {
      if (!traceArmed || ended || ms < HOVER_HESITATION_MS) return;
      pushRec('hes', tgt, { ms: Math.round(ms) });
    },

    traceVisibility(hidden) { pushRec(hidden ? 'hide' : 'show'); },

    flushTrace,

    // lp_dwell (once — first of tab-hidden / pagehide / unmount, same semantics
    // as useDwellTime) + a beacon flush of the trace. A tab-hide is NOT
    // terminal: scroll/section/trace tracking continues if the visitor returns
    // (the old inline '/' block kept counting depths after a hide — parity).
    // pagehide/unmount pass terminal=true and stop everything.
    end({ terminal = true } = {}) {
      if (ended) return;
      flushTrace(true);
      if (!dwellFired) {
        dwellFired = true;
        const ms = tMs();
        // max_depth always present (0 = genuine bounce) — omitting zeros would
        // skew the SQL median high for no-scroll visits.
        try {
          _logNow(EV.LP_DWELL, { ...base, ms, max_depth: round2(maxDepth) });
          if (legacy.dwell) _logNow(legacy.dwell, { ms, max_depth: round2(maxDepth) });
        } catch (_) {}
      }
      if (terminal) ended = true;
    },

    // Test-only visibility (mirrors journey.js's injectable-seams discipline).
    __state() {
      return { viewed, ended, dwellFired, maxDepth, firedDepths: new Set(firedDepths), traceArmed, traceBuf: traceBuf.slice(), traceRows };
    },
  };
}

// Standalone CTA logger for call sites without a tracker in scope (AuthGate's
// OTP form lives outside SignInBackdrop, where the '/' tracker is mounted).
export function lpCtaClick(page, pageKind, pos, extra) {
  try { _logNow(EV.LP_CTA_CLICK, { page, page_kind: pageKind, pos, intent: 'signup', ...extra }); } catch (_) {}
}
