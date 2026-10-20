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

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { Prohibit } from '../../lib/icons.js';
import { onDragSession } from '../../lib/springLoad.js';

const QUIET_MS = 250;

export function DragLabel({ resolve, idle = 'Drop on a cluster or a board' }) {
  const [shown, setShown] = useState(null);   // { x, y, label, thumbs, n }
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

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
    return () => { unsubscribe(); stop(); };
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
          {label.top}
        </span>
        {label.sub && <span className="sbf-draglabel-sub">{label.sub}</span>}
        {label.hint && <span className="sbf-draglabel-sub">{label.hint}</span>}
      </span>
    </div>,
    document.body,
  );
}
