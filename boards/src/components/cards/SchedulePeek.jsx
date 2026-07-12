// Day / Hour Peek — the schedule card's local-only zoom panel. A day (or hour)
// rendered at a comfortable size in a body-portaled panel placed beside the
// source slot, regardless of how small the card is on canvas. Pure UI state:
// nothing here writes schedView/anchor, so collaborators never see it.
//
// The panel is a dumb shell — ScheduleCard passes the slot layer in as
// children (the SAME renderSlotLayer the card body uses), and the root emits
// data-grid-id so every attribute-driven CanvasSurface pipeline (drops, paste
// routing, focus, uploads) engages inside the portal exactly as on the card.
//
// Escape is handled on window CAPTURE (PdfViewer pattern): the canvas's own
// bubble-phase Escape (clear selection) must never fire while the panel is up.
// It yields to an open slot menu so one press closes one layer at a time.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { useScrollEdges } from '../../hooks/useScrollEdges.js';
import { SCHED_TUNING } from '../../lib/schedLayout.js';
import { placeBeside } from './GridCellMenu.jsx';
import { Icon } from '../Icon.jsx';
import { ChevronLeft, ChevronRight, ArrowLeft, X } from '../../lib/icons.js';

const stop = (e) => e.stopPropagation();

export function SchedulePeek({ cardId, title, sourceRect, contentH, hourMode = false,
                               onPrev, onNext, onBack = null, onOpenAsDayView = null,
                               onClose, children }) {
  const ref = useRef(null);
  const bodyRef = useRef(null);
  // Outside-close must ignore every portal that stacks above the panel (slot
  // menus, context menus, the add-link prompt) plus sibling peek triggers —
  // clicking another day's trigger re-targets the open panel, not close+reopen.
  useDismissOnOutside(ref, true, onClose, {
    escape: false,
    ignore: '.gridc-cell-menu, .ctx-menu, .feedback-bg, .feedback-dialog, .schedc-peek-btn',
  });
  useScrollEdges(bodyRef);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.gridc-cell-menu')) return; // menu's own hook closes it
      e.stopPropagation();
      onClose?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const panelH = Math.min(SCHED_TUNING.PEEK_MAX_H,
    Math.floor((typeof window !== 'undefined' ? window.innerHeight : 768) * 0.8));

  // placeBeside against the source slot, re-run once mounted (real offsetWidth/
  // Height) and on resize — the GridCellMenu placement pattern.
  const [style, setStyle] = useState({ position: 'fixed', left: 0, top: 0, visibility: 'hidden' });
  const aKey = sourceRect ? `${sourceRect.left},${sourceRect.top},${sourceRect.width},${sourceRect.height}` : null;
  useLayoutEffect(() => {
    if (!sourceRect) return undefined;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const { left, top } = placeBeside(sourceRect,
        el.offsetWidth || SCHED_TUNING.PEEK_W, el.offsetHeight || panelH,
        window.innerWidth, window.innerHeight);
      setStyle((prev) => (prev.left === left && prev.top === top && !prev.visibility
        ? prev : { position: 'fixed', left, top }));
    };
    place();
    const id = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', place); };
  }, [aKey, panelH]);

  const node = (
    <div className="schedc-peekpanel" ref={ref} role="dialog" aria-label={title}
         data-grid-id={cardId}
         style={{ ...style, width: SCHED_TUNING.PEEK_W, height: panelH }}
         onWheel={stop} onContextMenu={stop}>
      <div className="schedc-peekhead" onPointerDown={stop}>
        {onBack && (
          <button type="button" className="schedc-peeknav" title="Back to day" aria-label="Back to day"
            onClick={(e) => { e.stopPropagation(); onBack(); }}>
            <Icon as={ArrowLeft} size={13} />
          </button>
        )}
        <button type="button" className="schedc-peeknav"
          title={hourMode ? 'Previous hour' : 'Previous day'} aria-label={hourMode ? 'Previous hour' : 'Previous day'}
          onClick={(e) => { e.stopPropagation(); onPrev?.(); }}>
          <Icon as={ChevronLeft} size={13} />
        </button>
        <span className="schedc-peektitle" title={title}>{title}</span>
        <button type="button" className="schedc-peeknav"
          title={hourMode ? 'Next hour' : 'Next day'} aria-label={hourMode ? 'Next hour' : 'Next day'}
          onClick={(e) => { e.stopPropagation(); onNext?.(); }}>
          <Icon as={ChevronRight} size={13} />
        </button>
        <span className="schedc-spring" />
        {onOpenAsDayView && (
          <button type="button" className="schedc-peekday" title="Open as the card's Day view"
            onClick={(e) => { e.stopPropagation(); onOpenAsDayView(); }}>
            Day view
          </button>
        )}
        <button type="button" className="schedc-peeknav schedc-peekclose" title="Close" aria-label="Close"
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}>
          <Icon as={X} size={13} />
        </button>
      </div>
      <div className="schedc-peekbody" ref={bodyRef}>
        <div className="schedc-peekcontent" style={{ height: contentH }}>
          {children}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export default SchedulePeek;
