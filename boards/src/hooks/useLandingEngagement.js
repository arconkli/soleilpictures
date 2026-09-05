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
      // Fractional layout heights leave scrollTop ~1px short of the max, so a
      // strict ratio never reaches 1.0 and the 100% threshold would be
      // systematically undercounted — bottom-within-2px IS a full read.
      if (el.scrollTop >= range - 2) return 1;
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

    // ── Section visibility (viewport root) ──
    // A section counts as seen at ≥50% of ITSELF or ≥50% of the VIEWPORT — the
    // second arm exists because a section taller than the screen can never reach
    // ratio 0.5.
    //
    // That second arm cannot be expressed with ratio thresholds, which is why
    // this used to under-report every long section on the site. For a section
    // taller than two viewports the ratio never reaches 0.5, so a
    // threshold-[0.5,0.95] observer delivers only the implicit 0-crossings —
    // and at both entry and exit the intersection is a hairline, so the
    // "≥50% of the viewport" escape hatch is false at exactly the moments it
    // gets to run. The section could fill the screen for a full minute in
    // between and never fire. Only sections already on screen at mount were
    // recorded, via the observer's initial delivery.
    //
    // So: two observers, one exact test. The centre-line observer has its root
    // shrunk to a zero-height band at the viewport middle, so it fires while a
    // tall section actually covers the screen. Any run of ≥half the viewport
    // must contain the midpoint, so nothing satisfying the second arm is
    // missed. Both feed consider(), which measures against the real viewport
    // rather than trusting a clipped intersectionRect. sectionSeen() dedupes on
    // its own, so a double delivery is harmless.
    if (typeof IntersectionObserver !== 'undefined') {
      const observers = [];
      const consider = (target) => {
        const r = target.getBoundingClientRect();
        const vh = window.innerHeight || 0;
        const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
        if (visible <= 0) return;
        if (visible < r.height * 0.5 && visible < vh * 0.5) return;
        for (const [id, reg] of lp.__sections) {
          if (reg.el === target) {
            tracker.sectionSeen(id, reg.idx);
            for (const io of observers) io.unobserve(target);
            break;
          }
        }
      };
      const onEntries = (entries) => {
        for (const entry of entries) if (entry.isIntersecting) consider(entry.target);
      };
      observers.push(
        new IntersectionObserver(onEntries, { threshold: [0, 0.5, 0.95] }),
        new IntersectionObserver(onEntries, { rootMargin: '-50% 0px -50% 0px', threshold: 0 }),
      );
      // Facade so sectionRef's observe/unobserve calls reach both observers.
      lp.__sections.observer = {
        observe(el)   { for (const io of observers) io.observe(el); },
        unobserve(el) { for (const io of observers) io.unobserve(el); },
      };
      for (const [, reg] of lp.__sections) if (reg.el) lp.__sections.observer.observe(reg.el);
      cleanups.push(() => {
        for (const io of observers) io.disconnect();
        lp.__sections.observer = null;
      });
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
