// The sidebar's right edge, as a handle: drag it anywhere from 240 to 480px,
// double-click to put it back, or focus it and use ←/→ (Home/End for the
// ends). A separator in the ARIA sense, so a screen reader announces the
// width it sets. Only the desktop sidebar has one: in the mobile shell the
// sidebar is a drawer with its own width.

import { useRef } from 'react';
import { SIDEBAR_W, clampSidebarWidth, widthFromDrag, widthFromKey } from '../../lib/sidebarWidth.js';

export function SidebarResizer({ width, onChange, onCommit }) {
  const drag = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { startX: e.clientX, startW: width, last: width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.body.classList.add('sbf-resizing');
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    d.last = widthFromDrag(d.startW, d.startX, e.clientX);
    onChange(d.last);
  };
  const end = (e) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch (_) { /* already released */ }
    document.body.classList.remove('sbf-resizing');
    onCommit?.(d.last);
  };

  return (
    <div className="sbf-resizer"
         role="separator" aria-orientation="vertical" tabIndex={0}
         aria-label="Resize sidebar"
         aria-valuemin={SIDEBAR_W.MIN} aria-valuemax={SIDEBAR_W.MAX} aria-valuenow={width}
         title="Drag to resize · double-click to reset"
         onPointerDown={onPointerDown}
         onPointerMove={onPointerMove}
         onPointerUp={end}
         onPointerCancel={end}
         onDoubleClick={() => { onChange(SIDEBAR_W.DEFAULT); onCommit?.(SIDEBAR_W.DEFAULT); }}
         onKeyDown={(e) => {
           const next = widthFromKey(width, e.key);
           if (next == null) return;
           e.preventDefault();
           const w = clampSidebarWidth(next);
           onChange(w);
           onCommit?.(w);
         }} />
  );
}
