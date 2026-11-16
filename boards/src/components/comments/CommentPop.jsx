import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './commentsLook.css';

// A small layer over the card: the row menu, the @ list, the date. A card
// clips what it holds, so these are drawn on the page and placed against
// the thing they belong to.
//   anchor     the element it belongs to
//   place      'below-end' (a menu under its button, right edges level),
//              'above-start' (the @ list over the box), 'above' (a date,
//              centred over its time)
//   gap        px between the two
// It flips to the other side when there's no room, and stays on screen.
export function CommentPop({ anchor, place = 'below-end', gap = 6, className = '', children, popRef, ...rest }) {
  const own = useRef(null);
  const [pos, setPos] = useState(null);
  const dark = !!anchor?.closest?.('.cmt-dark');

  useLayoutEffect(() => {
    if (!anchor) return undefined;
    const put = () => {
      const el = own.current;
      if (!el || !anchor.isConnected) return;
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left;
      if (place === 'below-end') left = a.right - w;
      else if (place === 'above') left = a.left + a.width / 2 - w / 2;
      else left = a.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      const above = a.top - gap - h;
      const below = a.bottom + gap;
      let top;
      if (place === 'below-end') top = below + h > vh - 8 && above >= 8 ? above : below;
      else top = above < 8 && below + h <= vh - 8 ? below : above;
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    put();
    window.addEventListener('resize', put);
    window.addEventListener('scroll', put, true);
    return () => {
      window.removeEventListener('resize', put);
      window.removeEventListener('scroll', put, true);
    };
  });

  if (!anchor || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={(el) => { own.current = el; if (popRef) popRef.current = el; }}
      className={`cmt-pop${dark ? ' cmt-dark' : ''}${className ? ' ' + className : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, opacity: 0, pointerEvents: 'none' }}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}
