import { useLayoutEffect, useRef, useState } from 'react';

// The islands' inset from the canvas's edges, and the room between two.
const EDGE = 12;

// Where a bar of the toolbar look sits on a desktop canvas's bottom row (the
// note bar, the draw bar, the shape bars: .tob-a), and how far it folds.
//
// It's the bottom row's middle island, centred in the room the rail and the
// zoom leave it (--tob-l, --tob-r), or from the canvas's edge, under the rail,
// where the rail doesn't reach down to the bottom row and the row needs the
// room. Where the row doesn't fit either way (a narrow window, the sidebar
// open) it folds a step (fold 1, 2… up to `max`), rather than scroll its end
// out of reach, and unfolds a step once the row it measured before that step
// fits again; where even folded all the way it doesn't fit, it sits over the
// zoom (--tob-b). Measured after every render as well as on a resize: the row
// grows when a control joins it (a note's Comment, once its editor is up; the
// draw bar's brushes, back from the eraser).
//
// `on` is false under a finger, where the bar keeps the place its CSS gives it
// and the bar folds as far as its own rules say. Returns the fold.
export function useIslandFit(barRef, { on, max }) {
  const [fold, setFold] = useState(0);
  const widths = useRef([]);
  const fitRef = useRef(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const room = bar?.offsetParent;
    if (!bar || !room || !on) { fitRef.current = null; return undefined; }
    const fit = () => {
      // In the room's own terms, as left/right/bottom are: a focus could
      // scroll the canvas (overflow hidden, it scrolled all the same), which
      // moved the islands on the screen, not in the room.
      const box = room.getBoundingClientRect();
      const ox = box.left + room.clientLeft - room.scrollLeft;
      const oy = box.top + room.clientTop - room.scrollTop;
      const width = room.clientWidth;
      const height = room.clientHeight;
      const shown = (sel) => {
        const b = room.querySelector(sel)?.getBoundingClientRect();
        return b && b.width > 0 ? { left: b.left - ox, right: b.right - ox, top: b.top - oy, bottom: b.bottom - oy } : null;
      };
      const rail = shown('.cnv-tools');
      const zoom = shown('.cnv-zoom');
      const right = zoom ? Math.round(width - zoom.left) + EDGE : EDGE;
      const lefts = [rail ? Math.round(rail.right) + EDGE : EDGE];
      if (rail && rail.bottom < height - EDGE - bar.offsetHeight - 8) lefts.push(EDGE);
      const roomFor = (w, r) => lefts.find((l) => width - l - r >= w - 1);
      if (fold > 0 && roomFor(widths.current[fold - 1], right) != null) { setFold(fold - 1); return; }
      let left = roomFor(bar.scrollWidth, right);
      if (left == null && fold < max) { widths.current[fold] = bar.scrollWidth; setFold(fold + 1); return; }
      let r = right;
      if (left == null && zoom) { r = EDGE; left = roomFor(bar.scrollWidth, r); }
      if (left == null) left = lefts[lefts.length - 1];
      bar.style.setProperty('--tob-l', `${left}px`);
      bar.style.setProperty('--tob-r', `${r}px`);
      if (r !== right) bar.style.setProperty('--tob-b', `${Math.round(height - zoom.top) + 8}px`);
      else bar.style.removeProperty('--tob-b');
    };
    fitRef.current = fit;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fitRef.current?.());
    ro?.observe(room);
    const zoomEl = room.querySelector('.cnv-zoom');
    if (zoomEl) ro?.observe(zoomEl);
    return () => { ro?.disconnect(); fitRef.current = null; };
  }, [barRef, on, fold, max]);
  useLayoutEffect(() => { fitRef.current?.(); });
  return fold;
}
