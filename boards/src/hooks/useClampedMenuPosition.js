// Position a position:fixed context menu at the pointer, kept on screen.
// Measures the rendered menu before paint (useLayoutEffect) and flips it to
// the other side of the cursor when it would run off the right or bottom
// edge — see clampMenuPosition. Call it unconditionally; while no menu is
// open (x/y null, ref empty) it does nothing.
//
//   const ref = useRef(null);
//   const pos = useClampedMenuPosition(ref, menu?.x, menu?.y);
//   {menu && <div ref={ref} style={{ position: 'fixed', left: pos.left, top: pos.top }}>…}

import { useLayoutEffect, useState } from 'react';
import { clampMenuPosition } from '../lib/tagSurface.js';

export function useClampedMenuPosition(ref, x, y) {
  const [pos, setPos] = useState({ left: x ?? 0, top: y ?? 0 });
  useLayoutEffect(() => {
    if (x == null || y == null) return;
    const el = ref.current;
    if (!el) { setPos({ left: x, top: y }); return; }
    const r = el.getBoundingClientRect();
    setPos(clampMenuPosition({
      x, y, width: r.width, height: r.height,
      vw: window.innerWidth, vh: window.innerHeight,
    }));
  }, [ref, x, y]);
  return pos;
}
