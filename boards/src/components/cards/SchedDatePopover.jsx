// Mini-calendar date-jump popover for the schedule card. Clicking the card's
// header title opens it; picking any date jumps the card's anchor straight
// there (onUpdate({ anchor }) upstream) — the fix for "reaching next week is
// seven ‹ clicks". Browsing months in here touches NOTHING until a pick.
//
// Body-portaled + position:fixed (cards live in a transformed canvas layer —
// same trap GridCellMenu documents), placed under the title button and
// viewport-clamped. Styled like the .cbt-menu frosted family.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import {
  WEEKDAYS, monthMatrix, monthTitle, addMonths, todayISO, parseISO,
} from '../../lib/schedDates.js';
import { Icon } from '../Icon.jsx';
import { ChevronLeft, ChevronRight } from '../../lib/icons.js';

const PAD = 10;
const GAP = 6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const stop = (e) => e.stopPropagation();

// Under the anchor (a header title), falling back to above — a dropdown's
// order, unlike placeBeside's right-first order for cell menus.
function placeUnder(rect, w, h, vw, vh) {
  const left = clamp(rect.left, PAD, vw - w - PAD);
  if (rect.bottom + GAP + h <= vh - PAD) return { left, top: rect.bottom + GAP };
  if (rect.top - GAP - h >= PAD) return { left, top: rect.top - GAP - h };
  return { left, top: clamp(vh - h - PAD, PAD, vh - PAD) };
}

export function SchedDatePopover({ anchorRect, anchor, onPick, onClose }) {
  const ref = useRef(null);
  const [viewMonth, setViewMonth] = useState(anchor);
  useDismissOnOutside(ref, true, onClose, { escape: false });

  // Own Escape on capture — the canvas's bubble-phase Escape must not clear
  // the card selection underneath while the popover eats the press.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const [style, setStyle] = useState({ position: 'fixed', left: 0, top: 0, visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!anchorRect) return undefined;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const { left, top } = placeUnder(anchorRect, el.offsetWidth || 210, el.offsetHeight || 240,
        window.innerWidth, window.innerHeight);
      setStyle({ position: 'fixed', left, top });
    };
    place();
    const id = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', place); };
  }, [anchorRect]);

  const today = todayISO();
  const cells = monthMatrix(viewMonth);

  const node = (
    <div className="schedc-datepop" ref={ref} role="dialog" aria-label="Jump to date" style={style}
         onPointerDown={stop} onWheel={stop} onContextMenu={stop}>
      <div className="schedc-dp-head">
        <button type="button" className="schedc-dp-nav" title="Previous month" aria-label="Previous month"
          onClick={(e) => { e.stopPropagation(); setViewMonth((m) => addMonths(m, -1)); }}>
          <Icon as={ChevronLeft} size={12} />
        </button>
        <span className="schedc-dp-title">{monthTitle(viewMonth)}</span>
        <button type="button" className="schedc-dp-nav" title="Next month" aria-label="Next month"
          onClick={(e) => { e.stopPropagation(); setViewMonth((m) => addMonths(m, 1)); }}>
          <Icon as={ChevronRight} size={12} />
        </button>
      </div>
      <div className="schedc-dp-grid">
        {WEEKDAYS.map((w) => <span key={w} className="schedc-dp-wd">{w[0]}</span>)}
        {cells.map((c) => (
          <button key={c.date} type="button"
            className={[
              'schedc-dp-day',
              c.outside ? 'is-outside' : '',
              c.date === today ? 'is-today' : '',
              c.date === anchor ? 'is-anchor' : '',
            ].filter(Boolean).join(' ')}
            title={c.date}
            onClick={(e) => { e.stopPropagation(); onPick?.(c.date); }}>
            {parseISO(c.date).d}
          </button>
        ))}
      </div>
      <button type="button" className="schedc-dp-today"
        onClick={(e) => { e.stopPropagation(); onPick?.(today); }}>
        Today
      </button>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export default SchedDatePopover;
