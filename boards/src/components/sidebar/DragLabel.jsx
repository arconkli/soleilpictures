// The words at the pointer while files are dragged out of Files (the owner's
// rule: a drag says what letting go will do, before it's let go). One chip:
// the first few files' pictures and a count, then what a drop right here does
// — "Move 3 photos to Locations / Into its files, not onto its board / Hold
// Option (⌥) to copy instead" — or why it can't ("Grade is in Priya's
// workspace"). What it says comes from `resolve(el, e)`, lib/dropRules.js for
// the drop target under the pointer (an element with data-drop-board).
//
// It follows the drag session (lib/springLoad.js): only drags that started in
// Files show it, never a file from the desktop. The browser's own drag image
// is a blank (onDragItem sets it), so this is the one thing under the pointer.
// A dragover arrives several times a second while the pointer is in the
// window; when they stop (it left the window, Safari never says so) the chip
// goes, and comes back on the next one.
//
// A card dragged off the board is a pointer drag, not a drag session: the
// board says where it is with 'soleil-card-drag-over' ({ el, x, y, mods,
// drag: { files, sourceName, workspaceId } }) and stops with
// 'soleil-card-drag-end'. The label answers in the event (detail.decision),
// so the board does what it said. A pointer that holds still sends nothing,
// so that label stays until the end.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { Prohibit } from '../../lib/icons.js';
import { onDragSession } from '../../lib/springLoad.js';

const QUIET_MS = 250;

// The browser's own drag image, blank, for a drag this label speaks for: the
// label is the one thing under the pointer. Only while one is mounted
// (dragLabelShown) — without it a blank image would leave nothing there.
export const BLANK_DRAG_IMAGE = typeof Image !== 'undefined'
  ? Object.assign(new Image(), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' })
  : null;
let mounted = 0;
export const dragLabelShown = () => mounted > 0;

export function DragLabel({ resolve, idle = 'Drop on a cluster or a board' }) {
  const [shown, setShown] = useState(null);   // { x, y, label, thumbs, n }
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  useEffect(() => { mounted += 1; return () => { mounted -= 1; }; }, []);

  useEffect(() => {
    let off = null;
    const stop = () => { off?.(); off = null; setShown(null); };
    const unsubscribe = onDragSession((ev) => {
      if (ev.type === 'end') { stop(); return; }
      if (ev.type !== 'start' || ev.session?.kind !== 'files') return;
      off?.();
      const s = ev.session;
      let frame = 0;
      let quiet = 0;
      let last = null;
      const paint = () => {
        frame = 0;
        if (!last) return;
        const { x, y, el, e } = last;
        const d = el ? resolveRef.current?.(el, e) : null;
        const label = d?.label?.top ? d.label : { top: idle, sub: '', hint: '', no: false, idle: true };
        setShown({ x, y, label, thumbs: s.thumbs || [], n: s.files?.length || 0 });
      };
      const onOver = (e) => {
        last = { x: e.clientX, y: e.clientY, el: e.target?.closest?.('[data-drop-board]') || null, e: { altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey } };
        if (!frame) frame = requestAnimationFrame(paint);
        clearTimeout(quiet);
        quiet = setTimeout(() => setShown(null), QUIET_MS);
      };
      window.addEventListener('dragover', onOver, true);
      off = () => {
        window.removeEventListener('dragover', onOver, true);
        cancelAnimationFrame(frame);
        clearTimeout(quiet);
      };
    });
    // The board's card drags.
    let cardFrame = 0;
    let cardLast = null;
    const paintCard = () => {
      cardFrame = 0;
      if (!cardLast) return;
      const { x, y, label, n } = cardLast;
      setShown({ x, y, label, thumbs: [], n });
    };
    const onCardOver = (ev) => {
      const d0 = ev.detail || {};
      const d = d0.el ? resolveRef.current?.(d0.el, d0.mods || {}, d0.drag || null) : null;
      d0.decision = d;
      const label = d?.label?.top ? d.label : { top: idle, sub: '', hint: '', no: false, idle: true };
      cardLast = { x: d0.x, y: d0.y, label, n: d0.drag?.files?.length || 0 };
      if (!cardFrame) cardFrame = requestAnimationFrame(paintCard);
    };
    const onCardEnd = () => {
      cancelAnimationFrame(cardFrame);
      cardFrame = 0;
      if (cardLast) { cardLast = null; setShown(null); }
    };
    document.addEventListener('soleil-card-drag-over', onCardOver);
    document.addEventListener('soleil-card-drag-end', onCardEnd);
    return () => {
      unsubscribe(); stop();
      document.removeEventListener('soleil-card-drag-over', onCardOver);
      document.removeEventListener('soleil-card-drag-end', onCardEnd);
      cancelAnimationFrame(cardFrame);
    };
  }, [idle]);

  if (!shown) return null;
  // Below and to the right of the pointer; where that runs off the window,
  // to its left or above it.
  const W = 300;
  const left = shown.x + 14 + W > window.innerWidth ? Math.max(8, shown.x - 14 - W) : shown.x + 14;
  const top = shown.y + 22 + 72 > window.innerHeight ? Math.max(8, shown.y - 80) : shown.y + 22;
  const { label } = shown;
  return createPortal(
    <div className={`sbf-draglabel${label.no ? ' is-no' : ''}${label.idle ? ' is-idle' : ''}`}
         style={{ left, top }} role="status" aria-live="polite">
      {shown.n > 0 && (
        <span className="sbf-draglabel-stack" aria-hidden="true">
          {shown.thumbs.slice(0, 3).map((src, i) => <img key={i} src={src} alt="" />)}
          {!shown.thumbs.length && <span className="sbf-draglabel-blank" />}
          <span className="sbf-draglabel-n">{shown.n > 99 ? '99+' : shown.n}</span>
        </span>
      )}
      <span className="sbf-draglabel-text">
        <span className="sbf-draglabel-top">
          {label.no && <Icon as={Prohibit} size={14} weight="regular" />}
          <span className="sbf-draglabel-words">{label.top}</span>
        </span>
        {label.sub && <span className="sbf-draglabel-sub">{label.sub}</span>}
        {label.hint && <span className="sbf-draglabel-sub">{label.hint}</span>}
      </span>
    </div>,
    document.body,
  );
}
