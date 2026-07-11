import { useEffect, useRef, useState } from 'react';
import { useBreakpoint } from '../hooks/useBreakpoint.js';

// First-run guided tour overlay. Renders the active step as a Milanote-style
// frosted pill with a pointer arrow, anchored to the live on-screen position of
// the step's target (the element carrying `data-tour="<anchor>"`), and puts a
// glowing ring on that target so it's unmistakable what the pill points at. It
// is non-modal — never blocks canvas interaction — and advances when the engine
// (driven by App) moves to the next step. Steps with no natural action (the nav
// step) carry an explicit CTA button.

const GAP = 12;        // px between anchor and pill
const MARGIN = 8;      // edge margin within the canvas region
const VISIBLE = (r) =>
  r && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The region the pills live in: the canvas drawing area (excludes the left
// sidebar + topbar already, since .canvas-wrap is the flex child below them),
// further inset by the floating left tool rail and the mobile bottom-nav so a
// pill never sits under either. Falls back to the viewport if the canvas isn't
// mounted (e.g. the QA harness).
function canvasRegion() {
  const wrap = document.querySelector('.canvas-wrap');
  let left = 0;
  let top = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  if (wrap) {
    const r = wrap.getBoundingClientRect();
    left = r.left; top = r.top; right = r.right; bottom = r.bottom;
  }
  const rail = document.querySelector('.cnv-tools');
  if (rail) { const rr = rail.getBoundingClientRect(); if (rr.width) left = Math.max(left, rr.right + 6); }
  const nav = document.querySelector('.mb-nav');
  if (nav) { const nr = nav.getBoundingClientRect(); if (nr.height && nr.top < bottom) bottom = Math.min(bottom, nr.top); }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function place(ar, pr, placement, region) {
  const cx = ar.left + ar.width / 2;
  const cy = ar.top + ar.height / 2;
  let p = placement || 'bottom';
  let top;
  let left;
  const set = (pp) => {
    p = pp;
    if (pp === 'bottom') { top = ar.bottom + GAP; left = cx - pr.width / 2; }
    else if (pp === 'top') { top = ar.top - pr.height - GAP; left = cx - pr.width / 2; }
    else if (pp === 'right') { left = ar.right + GAP; top = cy - pr.height / 2; }
    else { left = ar.left - pr.width - GAP; top = cy - pr.height / 2; }
  };
  set(p);
  // Flip to the opposite side if it would spill past the canvas region.
  if (p === 'bottom' && top + pr.height > region.bottom - MARGIN) set('top');
  else if (p === 'top' && top < region.top + MARGIN) set('bottom');
  else if (p === 'right' && left + pr.width > region.right - MARGIN) set('left');
  else if (p === 'left' && left < region.left + MARGIN) set('right');
  return {
    top: clamp(top, region.top + MARGIN, Math.max(region.top + MARGIN, region.bottom - pr.height - MARGIN)),
    left: clamp(left, region.left + MARGIN, Math.max(region.left + MARGIN, region.right - pr.width - MARGIN)),
    placement: p,
    anchored: true,
  };
}

// Fallback when the anchor is missing / off-screen / hidden: center on the
// canvas region (not the page), so the pill sits where it looks best.
function centered(pr, region) {
  return {
    top: clamp(region.top + (region.height - pr.height) / 2,
      region.top + MARGIN, Math.max(region.top + MARGIN, region.bottom - pr.height - MARGIN)),
    left: clamp(region.left + (region.width - pr.width) / 2,
      region.left + MARGIN, Math.max(region.left + MARGIN, region.right - pr.width - MARGIN)),
    placement: 'bottom',
    anchored: false,
  };
}

export function OnboardingTour({ step, onEvent, onSkip, onView }) {
  const { isTouch } = useBreakpoint();
  const pillRef = useRef(null);
  const [pos, setPos] = useState(null);
  const posRef = useRef(null);
  const highlightRef = useRef(null);
  const stepId = step?.id || null;

  // One-time view event per step.
  useEffect(() => {
    if (stepId) onView?.(stepId);
  }, [stepId, onView]);

  // Milanote-style lock: while a step is showing, flag the body so CSS can make
  // everything except the current target + this pill non-interactive (mirrors the
  // app's data-clean-mode / data-canvas-interacting idiom). Tied to step PRESENCE
  // (not mount) so it clears the moment the tour finishes/skips even if the parent
  // keeps the component mounted. Covers the real app and the ?tour=1 preview.
  const tourShowing = !!stepId;
  useEffect(() => {
    if (!tourShowing) return undefined;
    document.body.setAttribute('data-tour-active', '1');
    return () => document.body.removeAttribute('data-tour-active');
  }, [tourShowing]);

  // Track the anchor's live screen position (it moves with canvas pan/zoom) via
  // rAF, re-rendering only when it shifts, and keep a glow ring on the target.
  useEffect(() => {
    if (!step) return undefined;
    const setHighlight = (el) => {
      if (highlightRef.current === el) return;
      highlightRef.current?.classList.remove('tour-target');
      el?.classList.add('tour-target');
      highlightRef.current = el;
    };
    let raf = 0;
    const tick = () => {
      const pill = pillRef.current;
      if (pill) {
        const pr = pill.getBoundingClientRect();
        const region = canvasRegion();
        // Chrome (incl. the tool rail) fades out while the canvas is being
        // panned/pinched — don't ring or point at an invisible target.
        const interacting = document.body?.dataset?.canvasInteracting === '1';
        const anchorEl = document.querySelector(`[data-tour="${step.anchor}"]`);
        const ar = anchorEl ? anchorEl.getBoundingClientRect() : null;
        const useAnchor = !!(ar && VISIBLE(ar) && !interacting);
        setHighlight(useAnchor ? anchorEl : null);
        // centerPill steps (the final "add anything" step) keep the ring on the
        // target but center the pill so it clears the revealed rail-tooltip column.
        const next = (useAnchor && !step.centerPill)
          ? place(ar, pr, step.placement, region)
          : centered(pr, region);
        const prev = posRef.current;
        if (!prev || Math.abs(prev.top - next.top) > 0.5 ||
            Math.abs(prev.left - next.left) > 0.5 ||
            prev.placement !== next.placement || prev.anchored !== next.anchored) {
          posRef.current = next;
          setPos(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); setHighlight(null); };
  }, [step]);

  // Reset position when the step changes so the new pill re-anchors.
  useEffect(() => { posRef.current = null; setPos(null); }, [stepId]);

  if (!step) return null;

  const body = isTouch ? (step.copy.touch || step.copy.body) : step.copy.body;
  const style = pos
    ? { top: `${pos.top}px`, left: `${pos.left}px` }
    : { top: 0, left: 0, visibility: 'hidden' };
  const arrowClass = pos && !pos.anchored ? ' tour-centered' : '';

  return (
    <div
      ref={pillRef}
      className={`onboarding-tour surface-frosted tour-${pos?.placement || step.placement}${arrowClass}`}
      data-tour-anchor={step.anchor}
      style={style}
      role="dialog"
      aria-live="polite"
    >
      <span className="onboarding-tour-arrow" aria-hidden="true" />
      <div className="onboarding-coachmark-spark" aria-hidden="true">✦</div>
      <div className="onboarding-coachmark-copy">
        <div className="onboarding-coachmark-title">{step.copy.title}</div>
        <div className="onboarding-coachmark-body">{body}</div>
      </div>
      <div className="onboarding-tour-actions">
        {/* ctaWhenUnanchored steps (the List step) only surface their Got-it
            fallback when the real control isn't on screen — anchored users
            complete by clicking the ringed control itself. */}
        {step.cta && (!step.ctaWhenUnanchored || (pos && !pos.anchored)) && (
          <button
            type="button"
            className="onboarding-coachmark-dismiss"
            onClick={() => onEvent?.(step.ackEvent || { type: 'nav_ack' })}
          >
            {step.cta}
          </button>
        )}
        <button type="button" className="onboarding-tour-skip" onClick={() => onSkip?.()}>
          Skip
        </button>
      </div>
    </div>
  );
}
