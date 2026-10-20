// SetupTips — the three tips a new account gets in its workspace
// (lib/setupTips.js has the words, the anchors and when they are due). One at
// a time, each pointing at the part of the sidebar it names, with the tour's
// frosted pill and a ring on what it points at. Non-modal: the board stays
// live behind it, and nothing is focused away from what the person was doing.
//
// In the phone drawer the first tip points at the menu button, and Next opens
// the drawer for the other two; however the tips end, the drawer closes again.
// Opening the drawer by the button itself counts as Next, and shutting it on
// the second or third tip ends them ('dismiss'): what they pointed at is gone.
// The host (SetupInWorkspace) decides when they start and keeps the record.

import './setupInWorkspace.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { Icon } from '../Icon.jsx';
import { tipsFor } from '../../lib/setupTips.js';

const GAP = 12;       // between the anchor and the pill
const MARGIN = 10;    // the pill keeps this far inside the window
const EDGE = 18;      // the arrow never sits closer than this to a corner

const shown = (r) => r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
  && r.top < window.innerHeight && r.left < window.innerWidth;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Where on the anchor the arrow points: near the top of a tall card (the
// clusters card runs the height of the window), the middle of anything small,
// and near the start of a wide header.
function aimAt(ar, side) {
  if (side === 'right' || side === 'left') return ar.height > 200 ? ar.top + Math.min(120, ar.height / 3) : ar.top + ar.height / 2;
  return ar.width > 200 ? ar.left + 40 : ar.left + ar.width / 2;
}

// `clear` is a box the pill keeps out of when it sits to the right: the whole
// sidebar, so a tip about its first card never lands on the second when the
// two cards stand side by side (a tablet held sideways).
function place(ar, pr, want, clear = null) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rightEdge = clear ? Math.max(ar.right, clear.right) : ar.right;
  const room = {
    right: rightEdge + GAP + pr.width <= vw - MARGIN,
    left: ar.left - GAP - pr.width >= MARGIN,
    bottom: ar.bottom + GAP + pr.height <= vh - MARGIN,
    top: ar.top - GAP - pr.height >= MARGIN,
  };
  const order = {
    right: ['right', 'bottom', 'top', 'left'],
    left: ['left', 'right', 'bottom', 'top'],
    bottom: ['bottom', 'top', 'right', 'left'],
    top: ['top', 'bottom', 'right', 'left'],
  }[want] || ['bottom', 'top'];
  const side = order.find((s) => room[s]) || want;
  const aim = aimAt(ar, side);
  if (side === 'right' || side === 'left') {
    const top = clamp(aim - pr.height / 2, MARGIN, Math.max(MARGIN, vh - pr.height - MARGIN));
    // Pushed past the rest of the sidebar, the arrow would point at the wrong
    // card; the ring on the anchor says which one it means.
    const detached = side === 'right' && rightEdge > ar.right + 1;
    return { side, top, left: side === 'right' ? rightEdge + GAP : ar.left - GAP - pr.width, arrow: clamp(aim - top, EDGE, pr.height - EDGE), detached };
  }
  const left = clamp(aim - pr.width / 2, MARGIN, Math.max(MARGIN, vw - pr.width - MARGIN));
  return { side, left, top: side === 'bottom' ? ar.bottom + GAP : ar.top - GAP - pr.height, arrow: clamp(aim - left, EDGE, pr.width - EDGE) };
}

function centered(pr) {
  return {
    side: 'none',
    top: Math.max(MARGIN, window.innerHeight - pr.height - 96),
    left: Math.max(MARGIN, (window.innerWidth - pr.width) / 2),
    arrow: 0,
  };
}

export default function SetupTips({ phone, canImport, onStep, onEnd, onHow, openDrawer, closeDrawer }) {
  const tips = useMemo(() => tipsFor({ phone, canImport }), [phone, canImport]);
  const [i, setI] = useState(0);
  const tip = tips[i];
  const pillRef = useRef(null);
  const ringRef = useRef(null);
  const [pos, setPos] = useState(null);
  const endedRef = useRef(false);
  const viewedRef = useRef(new Set());
  // What the anchor loop may do on a phone, read fresh each frame.
  const drawerRef = useRef({ advance: null, dismiss: null });

  // Each tip's view is logged once, however often the effect runs (StrictMode).
  useEffect(() => {
    if (viewedRef.current.has(tip.id)) return;
    viewedRef.current.add(tip.id);
    onStep?.(tip, 'view');
  }, [tip]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the anchor: every frame for a moment after the tip changes (the
  // drawer slides in), then on a slow poll and on resize.
  useEffect(() => {
    let raf = 0;
    let timer = 0;
    let hotUntil = performance.now() + 700;
    let drawerSeen = false;
    const ring = (el) => {
      if (ringRef.current === el) return;
      ringRef.current?.classList.remove('su-tip-target');
      el?.classList.add('su-tip-target');
      ringRef.current = el;
    };
    const tick = () => {
      raf = 0;
      timer = 0;
      if (phone) {
        const open = !!document.querySelector('.sidebar.is-mobile-open');
        const { advance, dismiss } = drawerRef.current;
        if (open && advance) { advance(); return; }
        if (open) drawerSeen = true;
        else if (drawerSeen && dismiss) { dismiss(); return; }
      }
      const pill = pillRef.current;
      if (pill) {
        const pr = pill.getBoundingClientRect();
        const el = document.querySelector(tip.anchor);
        const ar = el ? el.getBoundingClientRect() : null;
        const frame = phone ? null : document.querySelector('.sbf-frame')?.getBoundingClientRect();
        const at = shown(ar) ? place(ar, pr, tip.placement, frame && frame.width > 0 ? frame : null) : centered(pr);
        ring(at.side === 'none' ? null : el);
        setPos((p) => (p && Math.abs(p.top - at.top) < 0.5 && Math.abs(p.left - at.left) < 0.5
          && p.side === at.side && !p.detached === !at.detached && Math.abs(p.arrow - at.arrow) < 0.5 ? p : at));
      }
      if (performance.now() < hotUntil) raf = requestAnimationFrame(tick);
      else timer = setTimeout(tick, 250);
    };
    const wake = () => {
      hotUntil = performance.now() + 400;
      if (timer) { clearTimeout(timer); timer = 0; raf = requestAnimationFrame(tick); }
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', wake);
    window.addEventListener('scroll', wake, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('resize', wake);
      window.removeEventListener('scroll', wake, true);
      ring(null);
    };
  }, [tip, phone]);

  const end = (action) => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (phone && action !== 'dismiss') closeDrawer?.();
    onEnd?.(tip, action);
  };
  const next = (how = 'next') => {
    if (tip.last) { end('done'); return; }
    onStep?.(tip, how);
    if (phone && i === 0 && how === 'next') openDrawer?.();
    setPos(null);
    setI(i + 1);
  };
  // Only from the tip each belongs to: a frame left over from the first tip
  // must not move the second on.
  drawerRef.current = {
    advance: i === 0 ? () => next('drawer') : null,
    dismiss: i > 0 ? () => end('dismiss') : null,
  };
  const how = () => {
    end('how');
    onHow?.();
  };

  const style = pos
    ? { top: `${pos.top}px`, left: `${pos.left}px`, '--su-arrow': `${pos.arrow}px` }
    : { top: 0, left: 0, visibility: 'hidden' };

  return (
    <div ref={pillRef} className={`onboarding-tour surface-frosted su-tip${phone ? ' is-phone' : ''} at-${pos?.side || 'none'}`}
      style={style} role="dialog" aria-live="polite" aria-label={tip.title} data-tip={tip.id}>
      {pos && pos.side !== 'none' && !pos.detached && <span className="su-tip-arrow" aria-hidden="true" />}
      <div className="onboarding-coachmark-spark" aria-hidden="true">✦</div>
      <div className="onboarding-coachmark-copy">
        <div className="onboarding-coachmark-title">{tip.title}</div>
        <div className="onboarding-coachmark-body">{tip.body}</div>
        <div className="su-tip-foot">
          <span className="su-tip-n">{tip.n} of {tip.of}</span>
          {tip.how
            ? <button type="button" className="su-tip-how" onClick={how}>See how<Icon as={ArrowRight} size={12} weight="bold" /></button>
            : !tip.last && <button type="button" className="onboarding-tour-skip" onClick={() => end('skip')}>Skip</button>}
          <button type="button" className="su-tip-next" onClick={() => next()}>{tip.last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
