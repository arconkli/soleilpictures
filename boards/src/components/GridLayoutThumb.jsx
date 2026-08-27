import { computeCellRects } from '../lib/gridLayout.js';

// A layout's shape at a glance: the cell rects of its fraction tree and nothing
// else. Pure SVG — no images, no network, no measurement — so a panel of thirty
// of these renders in one frame, works offline, and works under ?local=1.
//
// It renders from the SAME computeCellRects the card itself uses, so the tile in
// the picker and the grid you get after clicking are the same tiling by
// construction rather than by a designer keeping two things in sync.

const VB = { w: 56, h: 44 };
const INSET = 1; // hairline gap so adjacent cells read as separate boxes

export function GridLayoutThumb({ tree, title }) {
  const rects = tree ? computeCellRects(tree, { x: 0, y: 0, w: VB.w, h: VB.h }) : [];
  return (
    <svg
      className="tplt-thumb"
      viewBox={`0 0 ${VB.w} ${VB.h}`}
      width={VB.w}
      height={VB.h}
      role="img"
      aria-label={title ? `${title} layout` : 'Layout preview'}
    >
      {rects.map((r) => (
        <rect
          key={r.id}
          x={r.x + INSET}
          y={r.y + INSET}
          width={Math.max(0, r.w - INSET * 2)}
          height={Math.max(0, r.h - INSET * 2)}
          rx="1.5"
        />
      ))}
    </svg>
  );
}
