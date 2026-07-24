// useUpsellExposure — the DOM/React layer over lib/upsellMetrics.js. One hook
// call per upsell surface wires the whole up_* exposure package:
//
//   const up = useUpsellExposure({ surface: 'modal', header, via,
//     uid: user?.id, tier,
//     userState: { demoCardCount, cardLimit, signupAt: user?.created_at },
//     getRootEl: () => modalRef.current });
//   logEventOnce(key, 'pricing_view', { ...up.envelope(), ... });
//   up.outcome('cta', { plan });        // before the must-land intent event
//   const t = up.planToggle(p);         // enrich pricing_plan_toggle with {seq_n,t_ms}
//
// Hover zones are declared with data attributes stamped by PricingBits:
//   [data-up-feat]  — Creator feature rows → up_feature_hover (which pitch
//                     line did they read)
//   [data-up-price] — the price row        → price_hes_ms in the summary
//   [data-up-cta]   — the primary CTA      → cta_hes_ms (hesitated, no click)
//
// Listeners are DELEGATED to getRootEl() (not window) — the modal sits over
// the live workspace, and workspace clicks must never pollute the exposure.
// The micro-interaction trace (up_trace) arms only when the surface isn't the
// public pricing page (lp_trace already covers anon visitors there) AND no
// post-signup journey is open (ps_trace covers the first authed session).
// Target descriptors come exclusively from journey.describeTarget —
// structural identifiers only, never values.

import { useEffect, useMemo, useRef } from 'react';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { describeTarget, isJourneyOpen } from '../lib/journey.js';
import { isInteractiveTarget } from '../lib/landingMetrics.js';
import { COPY_REV } from '../lib/billingCopy.js';
import {
  setUpsellSink, createUpsellExposure, TRACE_FLUSH_MS, FEATURE_HOVER_MS,
} from '../lib/upsellMetrics.js';

setUpsellSink({ logEvent, logEventNow });

export function useUpsellExposure({ surface, header = null, via = null, uid, tier, userState, getRootEl } = {}) {
  const getRootElRef = useRef(getRootEl);
  getRootElRef.current = getRootEl;
  const uidRef = useRef(uid);
  uidRef.current = uid;

  // One exposure per MOUNT of a surface identity, behind a render-stable
  // facade so the surrounding component can call up.* inside its own handlers.
  // The mount effect below renews an already-ended exposure (StrictMode's dev
  // double-mount ends the throwaway one — without renewal the real mount would
  // record nothing).
  const up = useMemo(() => {
    const make = () => createUpsellExposure({
      surface, header, via, copyRev: COPY_REV, uid: uidRef.current,
    });
    const state = { x: make() };
    return {
      get tracker() { return state.x; },
      __renew() { state.x = make(); },
      envelope: () => state.x.envelope(),
      timing: () => state.x.timing(),
      outcome: (kind, opts) => state.x.outcome(kind, opts),
      planToggle: (p) => state.x.planToggle(p),
      noteError: () => state.x.noteError(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, header, via]);

  // tier / userState resolve async (useMyTier) — keep the envelope current.
  useEffect(() => { up.tracker.update({ tier, userState }); });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (up.tracker.__state().ended) up.__renew();   // StrictMode remount → fresh exposure
    const x = up.tracker;
    x.update({ tier, userState });
    x.view();
    const cleanups = [];

    // The surface's own DOM; the portal renders before effects run, so the ref
    // is set by now. document is only a fallback for surfaces without a root.
    const root = getRootElRef.current?.() || document;

    // ── Hover zones (enter → leave with elapsed ms; a clicked CTA is a
    //    conversion, not a hesitation) ──
    const zones = [
      {
        sel: '[data-up-feat]',
        onLeave: (el, ms) => x.featureHover(
          parseInt(el.getAttribute('data-up-feat'), 10),
          el.getAttribute('data-up-featkey') || null,
          ms,
        ),
      },
      { sel: '[data-up-price]', onLeave: (_el, ms) => x.priceHover(ms) },
      { sel: '[data-up-cta]', suppressOnClick: true, onLeave: (_el, ms) => x.ctaHover(ms) },
    ];
    for (const z of zones) z.cur = null;   // {el, at, clicked}

    const onOver = (e) => {
      for (const z of zones) {
        const el = e.target?.closest?.(z.sel);
        if (!el || (z.cur && z.cur.el === el)) continue;
        z.cur = { el, at: Date.now(), clicked: false };
      }
    };
    const onOut = (e) => {
      for (const z of zones) {
        if (!z.cur) continue;
        const from = e.target?.closest?.(z.sel);
        if (from !== z.cur.el) continue;
        if (e.relatedTarget?.closest?.(z.sel) === z.cur.el) continue;   // still inside
        const ms = Date.now() - z.cur.at;
        if (!(z.suppressOnClick && z.cur.clicked)) z.onLeave(z.cur.el, ms);
        z.cur = null;
      }
    };
    // A hidden tab gets no pointerout, so an open hover would accumulate
    // asleep wall-clock time and report an absurd read on return — abandon
    // open zones at hide instead of crediting the nap.
    const dropOpenHovers = () => { for (const z of zones) z.cur = null; };
    const onClick = (e) => {
      x.markInteraction();
      x.click(describeTarget(e.target), isInteractiveTarget(e.target));
      for (const z of zones) {
        if (z.cur && e.target?.closest?.(z.sel) === z.cur.el) z.cur.clicked = true;
      }
    };
    const onInput = (e) => { x.markInteraction(); x.traceInput(describeTarget(e.target)); };
    const onKey = () => x.markInteraction();

    const opts = { passive: true, capture: true };
    root.addEventListener('click', onClick, opts);
    root.addEventListener('input', onInput, opts);
    root.addEventListener('keydown', onKey, opts);
    root.addEventListener('pointerover', onOver, opts);
    root.addEventListener('pointerout', onOut, opts);
    cleanups.push(() => {
      const off = { capture: true };
      root.removeEventListener('click', onClick, off);
      root.removeEventListener('input', onInput, off);
      root.removeEventListener('keydown', onKey, off);
      root.removeEventListener('pointerover', onOver, off);
      root.removeEventListener('pointerout', onOut, off);
    });

    // ── Micro-interaction trace — never overlaps lp_trace (public /pricing is
    //    anon-covered there) or ps_trace (first authed session). The arming
    //    check is DEFERRED a tick: child effects run before parent effects in
    //    the same commit, so on a direct /pricing load this hook can otherwise
    //    read isJourneyOpen()=false in the very commit where TierRouter's
    //    effect opens the journey. ──
    if (surface !== 'public_page') {
      const armTimer = setTimeout(() => { if (!isJourneyOpen()) x.armTrace(); }, 0);
      const flushTimer = setInterval(() => x.flushTrace(false), TRACE_FLUSH_MS);
      cleanups.push(() => { clearTimeout(armTimer); clearInterval(flushTimer); });
    }

    // ── Summary: first of tab-hidden / pagehide / unmount (lp_dwell semantics;
    //    StrictMode's dev double-mount adds one ~0ms summary — accepted noise).
    //    A tab-hide is non-terminal: tracking continues if the user returns. ──
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') { x.traceVisibility(false); return; }
      dropOpenHovers();
      x.traceVisibility(true);
      x.end({ terminal: false });
    };
    const onPageHide = () => x.end();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    cleanups.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    });

    return () => {
      x.end();                                       // modal closed / SPA navigation away
      for (const fn of cleanups) { try { fn(); } catch (_) {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [up]);

  return up;
}

export { FEATURE_HOVER_MS };
