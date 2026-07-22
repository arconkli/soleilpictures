// upsellMetrics.js — behavioral instrumentation for every Creator upsell
// surface (PricingModal, /pricing signed-in + public, the first-value flow).
// Emits the up_* event family (see analyticsEvents.js) and enriches the
// existing pricing_* funnel events with a common exposure ENVELOPE:
//
//   {surface, header, via, copy_rev, exposure_n, tier, cap_pct, demo_cards, acct_days}
//
// The analyzable unit is up_exposure_summary — ONE dense row per exposure
// (what the user did on the pitch before leaving): outcome + dismiss method,
// dwell, time-to-first-interaction, which feature rows they hovered, plan
// toggle sequence, rage/dead clicks. The funnel counters (pricing_view /
// pricing_creator_intent / checkout_open) keep firing unchanged — the summary
// answers WHY those counters don't move, per exposure.
//
//   const x = createUpsellExposure({ surface: 'modal', header: 'cap-hit', via: 'cap_hit', ... });
//   x.view();                        // marks the exposure + mints exposure_n
//   x.featureHover(1, 'storage', 640); // up_feature_hover (once per row)
//   x.planToggle('annual');          // toggle bookkeeping for the summary
//   x.outcome('dismiss', { method: 'esc' });
//   x.end();                         // up_exposure_summary (beacon, once)
//
// DESIGN: same discipline as landingMetrics.js / journey.js — node-importable
// pure core, emitter INJECTED via setUpsellSink (analytics.js reads
// import.meta.env and would break the plain-node unit test), never throws into
// callers, PII-safe target descriptors come exclusively from
// journey.describeTarget (structural identifiers only — never input values).

import { EV } from './analyticsEvents.js';

// ── Injected emitter + storage (wired once from the vite-only hook module) ────
let _log     = () => {};   // logEvent(name, props)
let _logNow  = () => {};   // logEventNow(name, props) — immediate keepalive-beacon
let _now     = () => Date.now();
let _storage = null;       // localStorage-shaped; injectable for node tests
export function setUpsellSink({ logEvent, logEventNow, now, storage } = {}) {
  if (typeof logEvent === 'function')    _log     = logEvent;
  if (typeof logEventNow === 'function') _logNow  = logEventNow;
  if (typeof now === 'function')         _now     = now;
  if (storage)                           _storage = storage;
}

function storage() {
  if (_storage) return _storage;
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch (_) {}
  return null;
}

// ── Tunables (trace constants mirror landingMetrics' firehose) ────────────────
export const FEATURE_HOVER_MS = 300;  // pointer lingered on a feature row this long = they read it
export const TRACE_FLUSH_MS = 4000;   // coalesce the firehose into one up_trace row this often
const TRACE_MAX_RECORDS = 30;         // ...or whenever the buffer hits this many records
const TRACE_MAX_ROWS    = 8;          // upsell exposures are short — lower cap than lp's 20
const INPUT_THROTTLE_MS = 600;        // coalesce keystrokes — field identity only, never value
const RAGE_WINDOW_MS    = 1000;       // ≥3 clicks on the same target inside this window = rage
const RAGE_MIN_CLICKS   = 3;
const TOGGLE_SEQ_MAX    = 10;         // toggle_seq stops growing here; toggles_n keeps counting

const PLAN_CODE = { monthly: 'm', annual: 'a' };

// nth lifetime pricing exposure for this uid ON THIS BROWSER. Tradeoffs
// (accepted): per-browser not per-account, resets on storage clear, and dev
// StrictMode's throwaway mount adds +1 — the server can always recompute the
// true ordinal with row_number() over up_exposure_summary; this counter exists
// so every event carries it for free slicing.
export function nextExposureN(uid) {
  const s = storage();
  if (!s) return null;
  const key = `soleil_up_exposures:${uid || 'anon'}`;
  try {
    const n = (parseInt(s.getItem(key), 10) || 0) + 1;
    s.setItem(key, String(n));
    return n;
  } catch (_) { return null; }
}

// One tracker per MOUNT of an upsell surface. `userState` snapshots what the
// user had at exposure time ({demoCardCount, cardLimit, signupAt}) — tier and
// userState resolve async (useMyTier), so the hook layer calls update() as
// they land and envelope() always reads the latest.
export function createUpsellExposure({
  surface, header = null, via = null, copyRev = null,
  uid = null, tier = null, userState = null, initialPlan = 'monthly',
} = {}) {
  const t0 = _now();

  let viewed = false;
  let ended = false;          // terminal: surface gone — nothing records after
  let summaryFired = false;   // up_exposure_summary is once; tracking continues after a tab-hide
  let exposureN = null;
  let curTier = tier;
  let curUserState = userState || {};

  let ttfi = null;            // ms to first pointer/key interaction
  let outcome = null;         // {kind, method} — first wins
  let planFinal = initialPlan;
  let togglesN = 0;
  let toggleSeq = [PLAN_CODE[initialPlan] || 'm'];
  const featRows = new Set(); // feature-row indices hovered ≥ FEATURE_HOVER_MS
  let featMs = 0;
  let priceHesMs = null;      // longest hover-hesitation on the price row
  let ctaHesMs = null;        // longest hover-hesitation on the primary CTA without clicking
  let rageN = 0;
  let deadN = 0;
  let errorSeen = false;

  // ── Trace state (armed by the hook only when it can't overlap ps_/lp_trace) ──
  let traceArmed = false;
  let traceBuf = [];
  let traceRows = 0;
  let lastInputAt = 0;
  let rage = { tgt: null, times: [], fired: false };

  function tMs() { return Math.max(0, _now() - t0); }

  function envelope() {
    const st = curUserState || {};
    const cards = Number.isFinite(st.demoCardCount) ? st.demoCardCount : null;
    const limit = Number.isFinite(st.cardLimit) && st.cardLimit > 0 ? st.cardLimit : null;
    let acctDays = null;
    if (st.signupAt) {
      const born = Date.parse(st.signupAt);
      if (!Number.isNaN(born)) acctDays = Math.max(0, Math.floor((_now() - born) / 86400000));
    }
    return {
      surface, header, via,
      copy_rev: copyRev,
      exposure_n: exposureN,
      tier: curTier,
      cap_pct: cards != null && limit != null ? Math.round((cards / limit) * 100) : null,
      demo_cards: cards,
      acct_days: acctDays,
    };
  }

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
    const row = { ...envelope(), from_t: ev[0].t, to_t: ev[ev.length - 1].t, n: ev.length, ev };
    try { if (beacon) _logNow(EV.UP_TRACE, row); else _log(EV.UP_TRACE, row); } catch (_) {}
  }

  return {
    // Marks the exposure + mints exposure_n. Emits nothing itself — the
    // surfaces keep firing their own pricing_view (logEventOnce, existing
    // dedup keys) enriched with envelope().
    view() {
      if (viewed || ended) return;
      viewed = true;
      if (exposureN == null) exposureN = nextExposureN(uid);
    },

    // tier / userState resolve async (useMyTier) — refresh what envelope() sees.
    update({ tier: t, userState: st } = {}) {
      if (t != null) curTier = t;
      if (st) curUserState = st;
    },

    envelope,

    // Timing snapshot for enriching the existing pricing_* events at their
    // call sites (pricing_creator_intent / pricing_abandon).
    timing() { return { ttfi_ms: ttfi, dwell_ms: tMs(), toggles_n: togglesN }; },

    // First pointer/key interaction inside the surface — sets ttfi once.
    markInteraction() {
      if (ended || ttfi != null) return;
      ttfi = tMs();
    },

    // Pointer lingered ≥ FEATURE_HOVER_MS on a Creator feature row — "they
    // read this pitch line". up_feature_hover fires once per row per exposure;
    // repeat hovers accumulate feat_ms for the summary but emit nothing new.
    featureHover(row, key, ms) {
      if (ended || typeof ms !== 'number' || ms < FEATURE_HOVER_MS) return;
      featMs += Math.round(ms);
      if (featRows.has(row)) return;
      featRows.add(row);
      try { _log(EV.UP_FEATURE_HOVER, { ...envelope(), row, key, ms: Math.round(ms) }); } catch (_) {}
    },

    // Longest hesitation on the price row / primary CTA (no event — summary only).
    priceHover(ms) {
      if (ended || typeof ms !== 'number' || ms < FEATURE_HOVER_MS) return;
      if (priceHesMs == null || ms > priceHesMs) priceHesMs = Math.round(ms);
    },
    ctaHover(ms) {
      if (ended || typeof ms !== 'number' || ms < FEATURE_HOVER_MS) return;
      if (ctaHesMs == null || ms > ctaHesMs) ctaHesMs = Math.round(ms);
    },

    // Monthly|Annual toggle bookkeeping. Returns {seq_n, t_ms} so the caller
    // can enrich its existing pricing_plan_toggle event with the timing.
    planToggle(plan) {
      if (ended) return { seq_n: togglesN, t_ms: tMs() };
      planFinal = plan;
      togglesN += 1;
      if (togglesN <= TOGGLE_SEQ_MAX) toggleSeq.push(PLAN_CODE[plan] || '?');
      return { seq_n: togglesN, t_ms: tMs() };
    },

    noteError() { if (!ended) errorSeen = true; },

    // Every click inside the surface: rage/dead bookkeeping for the summary
    // (independent of trace arming) + a trace record when armed.
    click(tgt, interactive) {
      if (ended) return;
      const now = _now();
      if (!interactive) deadN += 1;
      if (rage.tgt !== tgt) rage = { tgt, times: [], fired: false };
      rage.times = rage.times.filter((t) => now - t < RAGE_WINDOW_MS);
      if (rage.times.length === 0) rage.fired = false;   // burst over → a new one may fire again
      rage.times.push(now);
      pushRec(interactive ? 'click' : 'dead', tgt);
      if (rage.times.length >= RAGE_MIN_CLICKS && !rage.fired) {
        rage.fired = true;
        rageN += 1;
        pushRec('rage', tgt, { n: rage.times.length });
      }
    },

    // The exposure's resolution — first one wins (a CTA click followed by an
    // error and a close stays outcome:'cta'; error_seen carries the failure).
    // kind: 'cta' | 'invite_alt' | 'demo_cta' | 'dismiss'
    outcome(kind, { method = null, plan = null } = {}) {
      if (ended || outcome) return;
      outcome = { kind, method };
      if (plan) planFinal = plan;
      pushRec(kind);
    },

    // ── Micro-interaction trace (armed only when it can't overlap the ps_trace
    //    journey firehose or the public page's lp_trace) ──
    armTrace() { traceArmed = true; },
    isTraceArmed() { return traceArmed; },

    traceInput(tgt) {
      if (!traceArmed || ended) return;
      const now = _now();
      if (now - lastInputAt < INPUT_THROTTLE_MS) return;   // coalesce keystrokes
      lastInputAt = now;
      pushRec('input', tgt);                               // field identity only — never the value
    },

    traceVisibility(hidden) { pushRec(hidden ? 'hide' : 'show'); },

    flushTrace,

    // up_exposure_summary (once — first of tab-hidden / unmount / pagehide,
    // same semantics as lp_dwell) + a beacon flush of the trace. A tab-hide is
    // NOT terminal: interaction tracking continues if the user returns (a late
    // CTA still fires its own must-land pricing_creator_intent; the summary
    // just under-reports that rare path). Terminal ends stop everything.
    // A terminal end with no recorded outcome = the user navigated/closed
    // without acting → outcome 'dismiss', method defaults to 'nav'.
    end({ terminal = true, method = 'nav' } = {}) {
      if (ended) return;
      flushTrace(true);
      if (!summaryFired) {
        summaryFired = true;
        const kind = outcome ? outcome.kind : (terminal ? 'dismiss' : 'hidden');
        // Zeros/nulls always present — omitting them would skew the SQL
        // medians and make "no interaction" indistinguishable from "not measured".
        try {
          _logNow(EV.UP_EXPOSURE_SUMMARY, {
            ...envelope(),
            outcome: kind,
            dismiss_method: kind === 'dismiss' ? ((outcome && outcome.method) || method) : null,
            plan_final: planFinal,
            toggles_n: togglesN,
            toggle_seq: toggleSeq.join('>'),
            dwell_ms: tMs(),
            ttfi_ms: ttfi,
            feat_rows: [...featRows].sort((a, b) => a - b),
            feat_ms: featMs,
            price_hes_ms: priceHesMs,
            cta_hes_ms: ctaHesMs,
            rage_n: rageN,
            dead_n: deadN,
            error_seen: errorSeen,
          });
        } catch (_) {}
      }
      if (terminal) ended = true;
    },

    // Test-only visibility (mirrors landingMetrics' injectable-seams discipline).
    __state() {
      return {
        viewed, ended, summaryFired, exposureN,
        outcome: outcome ? { ...outcome } : null,
        ttfi, planFinal, togglesN, toggleSeq: toggleSeq.slice(),
        featRows: new Set(featRows), featMs, priceHesMs, ctaHesMs,
        rageN, deadN, errorSeen,
        traceArmed, traceBuf: traceBuf.slice(), traceRows,
      };
    },
  };
}
