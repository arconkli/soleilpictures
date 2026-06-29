import { useEffect, useRef, useState } from 'react';
import { useBreakpoint } from '../hooks/useBreakpoint.js';

// First-run guided tour overlay. Renders the active step as a Milanote-style
// frosted pill with a pointer arrow, anchored to the live on-screen position of
// the step's target (the element carrying `data-tour="<anchor>"`). It is
// non-modal — it never blocks canvas interaction — and advances when the engine
// (driven by App) moves to the next step. Steps with no natural action (the nav
// step) carry an explicit CTA button.

const GAP = 12;        // px between anchor and pill
const MARGIN = 8;      // viewport edge margin
const VISIBLE = (r) =>
  r && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function place(ar, pr, placement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
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
  // Flip to the opposite side if it would spill off the viewport.
  if (p === 'bottom' && top + pr.height > vh - MARGIN) set('top');
  else if (p === 'top' && top < MARGIN) set('bottom');
  else if (p === 'right' && left + pr.width > vw - MARGIN) set('left');
  else if (p === 'left' && left < MARGIN) set('right');
  return {
    top: clamp(top, MARGIN, vh - pr.height - MARGIN),
    left: clamp(left, MARGIN, vw - pr.width - MARGIN),
    placement: p,
  };
}

function centered(pr) {
  return {
    top: window.innerHeight - pr.height - 96,
    left: (window.innerWidth - pr.width) / 2,
    placement: 'bottom',
  };
}

export function OnboardingTour({ step, onEvent, onSkip, onView }) {
  const { isTouch } = useBreakpoint();
  const pillRef = useRef(null);
  const [pos, setPos] = useState(null);
  const posRef = useRef(null);
  const stepId = step?.id || null;

  // One-time view event per step.
  useEffect(() => {
    if (stepId) onView?.(stepId);
  }, [stepId, onView]);

  // Track the anchor's live screen position (it can move with canvas pan/zoom)
  // via rAF, but only re-render when it actually shifts.
  useEffect(() => {
    if (!step) return undefined;
    let raf = 0;
    const tick = () => {
      const pill = pillRef.current;
      if (pill) {
        const pr = pill.getBoundingClientRect();
        const anchorEl = document.querySelector(`[data-tour="${step.anchor}"]`);
        const ar = anchorEl ? anchorEl.getBoundingClientRect() : null;
        const next = ar && VISIBLE(ar) ? place(ar, pr, step.placement) : centered(pr);
        const prev = posRef.current;
        if (!prev || Math.abs(prev.top - next.top) > 0.5 ||
            Math.abs(prev.left - next.left) > 0.5 || prev.placement !== next.placement) {
          posRef.current = next;
          setPos(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // Reset position when the step changes so the new pill re-anchors.
  useEffect(() => { posRef.current = null; setPos(null); }, [stepId]);

  if (!step) return null;

  const body = isTouch ? (step.copy.touch || step.copy.body) : step.copy.body;
  const style = pos
    ? { top: `${pos.top}px`, left: `${pos.left}px` }
    : { top: 0, left: 0, visibility: 'hidden' };

  return (
    <div
      ref={pillRef}
      className={`onboarding-tour surface-frosted tour-${pos?.placement || step.placement}`}
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
        {step.cta && (
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
