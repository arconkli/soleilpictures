// useLandingEngagement — the DOM/React layer over lib/landingMetrics.js. One
// hook call per public page wires the whole uniform lp_* engagement package:
//
//   const lp = useLandingEngagement({ page: spec.path, pageKind: spec.kind,
//                                     getScrollEl: () => scrollRef.current });
//   <a {...lp.ctaProps('hero', cta.href)} …>          // lp_cta_click (beacon)
//   <section ref={lp.sectionRef('steps', 4)} …>       // lp_section at ≥50% visible
//   lp.faqOpen(i, q); lp.exampleClick(slug, i);
//
// Scroll modes: 'container' (default — listens on getScrollEl() or the document
// scroller), 'manual' (caller drives lp.tracker.reportProgress, e.g. the
// sign-in reveal's rAF loop), 'none' (canvas pages — no scroll axis).
//
// The anonymous micro-interaction trace (lp_trace) is armed only when the
// visitor has no session AND no post-signup journey is open, so it can never
// overlap journey.js's ps_trace firehose. Target descriptors come exclusively
// from journey.describeTarget — structural identifiers only, never values.

import { useEffect, useMemo, useRef } from 'react';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { supabase } from '../lib/supabase.js';
import { describeTarget, isJourneyOpen } from '../lib/journey.js';
import {
  setLandingSink, createLandingTracker, isInteractiveTarget,
  lpCtaClick, TRACE_FLUSH_MS, HOVER_HESITATION_MS,
} from '../lib/landingMetrics.js';

setLandingSink({ logEvent, logEventNow });

// Re-exported so call sites outside a tracked component (AuthGate's OTP form)
// import from here — this module is what guarantees the sink is wired.
export { lpCtaClick };

export function useLandingEngagement({ page, pageKind, scroll = 'container', getScrollEl, legacy } = {}) {
  const getScrollElRef = useRef(getScrollEl);
  getScrollElRef.current = getScrollEl;

  // One tracker per MOUNT of a page identity, behind a render-stable facade so
  // the surrounding component can reference lp.tracker inside its own
  // long-lived effects. The mount effect below renews an already-ended tracker
  // (StrictMode's dev double-mount ends the throwaway one — without renewal
  // the real mount would record nothing).
  const lp = useMemo(() => {
    const state = { tracker: createLandingTracker({ page, pageKind, legacy }) };
    const sections = Object.assign(new Map(), { observer: null });   // id → {el, idx}
    const sectionRefs = new Map();                                   // id → stable callback ref
    return {
      get tracker() { return state.tracker; },
      __renew() { state.tracker = createLandingTracker({ page, pageKind, legacy }); },
      ctaProps(pos, href, extra) {
        return { 'data-lp-cta': pos, onClick: () => state.tracker.ctaClick(pos, href, extra) };
      },
      exampleClick(slug, pos) { state.tracker.exampleClick(slug, pos); },
      faqOpen(idx, q) { state.tracker.faqOpen(idx, q); },
      sectionRef(id, idx) {
        if (!sectionRefs.has(id)) {
          sectionRefs.set(id, (el) => {
            const prev = sections.get(id);
            if (prev && prev.el && prev.el !== el) sections.observer?.unobserve(prev.el);
            sections.set(id, { el, idx });
            if (el && sections.observer) sections.observer.observe(el);
          });
        }
        return sectionRefs.get(id);
      },
      __sections: sections,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageKind]);

  useEffect(() => {
    if (!page || typeof window === 'undefined') return undefined;
    if (lp.tracker.__state().ended) lp.__renew();   // StrictMode remount → fresh tracker
    const tracker = lp.tracker;
    tracker.view();
    const cleanups = [];

    // ── Scroll depth ──
    const readProgress = () => {
      const el = getScrollElRef.current?.() || document.scrollingElement;
      if (!el) return null;
      const range = el.scrollHeight - el.clientHeight;
      if (range <= 1) return 'flat';                       // no scroll axis — page fully visible
      return (el.scrollTop + el.clientHeight) / el.scrollHeight;
    };
    if (scroll === 'container') {
      const onScroll = () => {
        const p = readProgress();
        if (typeof p === 'number') tracker.reportProgress(p);
      };
      // Initial read after layout: a viewport-fit page records max_depth=1, a
      // tall page records its above-the-fold fraction.
      const raf = requestAnimationFrame(() => {
        const p = readProgress();
        if (p === 'flat') tracker.markFullyVisible();
        else if (typeof p === 'number') tracker.reportProgress(p);
      });
      cleanups.push(() => cancelAnimationFrame(raf));
      const el = getScrollElRef.current?.();
      const target = el || window;                          // document scrolling fires on window
      target.addEventListener('scroll', onScroll, { passive: true });
      cleanups.push(() => target.removeEventListener('scroll', onScroll));
    } else if (scroll === 'none') {
      tracker.markFullyVisible();
    }

    // ── Section visibility (shared IntersectionObserver, viewport root) ──
    // A section counts as seen at ≥50% of itself OR ≥50% of the viewport
    // (sections taller than the screen can never reach ratio 0.5).
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const seen = entry.isIntersecting
            && (entry.intersectionRatio >= 0.5
                || entry.intersectionRect.height >= window.innerHeight * 0.5);
          if (!seen) continue;
          for (const [id, reg] of lp.__sections) {
            if (reg.el === entry.target) { tracker.sectionSeen(id, reg.idx); io.unobserve(entry.target); break; }
          }
        }
      }, { threshold: [0.5, 0.95] });
      lp.__sections.observer = io;
      for (const [, reg] of lp.__sections) if (reg.el) io.observe(reg.el);
      cleanups.push(() => { io.disconnect(); lp.__sections.observer = null; });
    }

    // ── Anonymous interaction trace — armed only with no session + no journey ──
    let cancelled = false;
    supabase?.auth.getSession().then(({ data }) => {
      if (cancelled || data?.session || isJourneyOpen()) return;
      tracker.armTrace();
      const opts = { passive: true, capture: true };
      const onClick = (e) => {
        tracker.traceClick(describeTarget(e.target), isInteractiveTarget(e.target));
        if (hover.pos && e.target?.closest?.('[data-lp-cta]')) hover.clicked = true;
      };
      const onInput = (e) => tracker.traceInput(describeTarget(e.target));
      // CTA hover-hesitation: pointer entered a CTA, left ≥300ms later, no click.
      const hover = { pos: null, at: 0, clicked: false };
      const onOver = (e) => {
        const cta = e.target?.closest?.('[data-lp-cta]');
        if (!cta) return;
        const pos = cta.getAttribute('data-lp-cta');
        if (pos !== hover.pos) { hover.pos = pos; hover.at = Date.now(); hover.clicked = false; }
      };
      const onOut = (e) => {
        if (!hover.pos) return;
        const from = e.target?.closest?.('[data-lp-cta]');
        if (!from || from.getAttribute('data-lp-cta') !== hover.pos) return;
        if (e.relatedTarget?.closest?.('[data-lp-cta]') === from) return;   // still inside the CTA
        const ms = Date.now() - hover.at;
        if (!hover.clicked && ms >= HOVER_HESITATION_MS) tracker.traceHover(hover.pos, ms);
        hover.pos = null;
      };
      window.addEventListener('click', onClick, opts);
      window.addEventListener('input', onInput, opts);
      window.addEventListener('pointerover', onOver, opts);
      window.addEventListener('pointerout', onOut, opts);
      const flushTimer = setInterval(() => tracker.flushTrace(false), TRACE_FLUSH_MS);
      cleanups.push(() => {
        clearInterval(flushTimer);
        const off = { capture: true };
        window.removeEventListener('click', onClick, off);
        window.removeEventListener('input', onInput, off);
        window.removeEventListener('pointerover', onOver, off);
        window.removeEventListener('pointerout', onOut, off);
      });
    }).catch(() => {});

    // ── Dwell: first of tab-hidden / pagehide / unmount (useDwellTime semantics;
    //    StrictMode's dev double-mount adds one ~0ms dwell — accepted noise).
    //    A tab-hide is non-terminal: tracking continues if the visitor returns. ──
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') { tracker.traceVisibility(false); return; }
      tracker.traceVisibility(true);
      tracker.end({ terminal: false });
    };
    const onPageHide = () => tracker.end();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    cleanups.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    });

    return () => {
      cancelled = true;
      tracker.end();                                        // in-SPA navigation away
      for (const fn of cleanups) { try { fn(); } catch (_) {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lp, scroll]);

  return lp;
}
