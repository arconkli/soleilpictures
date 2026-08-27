import { computeCellRects, readingOrder } from '../lib/gridLayout.js';

// A layout's shape at a glance: the cell rects of its fraction tree and nothing
// else. Pure SVG — no images, no network, no measurement — so a panel of thirty
// of these renders in one frame, works offline, and works under ?local=1.
//
// It renders from the SAME computeCellRects the card uses, so the tile in the
// picker and the grid you get after clicking are the same tiling by
// construction rather than by a designer keeping two things in sync.
//
// `numbered` and `highlight` exist for the save dialog, where the diagram has to
// answer "which box is field 2". Numbering follows READING ORDER, matching how
// hints are indexed and how a person counts cells — not the depth-first order
// the tree happens to store them in.

const VB = { w: 56, h: 44 };
const INSET = 1; // hairline gap so adjacent cells read as separate boxes

export function GridLayoutThumb({ tree, title, numbered = false, highlight = -1 }) {
  const rects = tree ? computeCellRects(tree, { x: 0, y: 0, w: VB.w, h: VB.h }) : [];
  // Map cell id → its position in reading order, so a rect can find its number.
  const order = numbered || highlight >= 0
    ? new Map(readingOrder(rects).map((id, i) => [id, i]))
    : null;

  return (
    <svg
      className={`tplt-thumb${numbered ? ' is-numbered' : ''}`}
      viewBox={`0 0 ${VB.w} ${VB.h}`}
      width={VB.w}
      height={VB.h}
      role="img"
      aria-label={title ? `${title} layout` : 'Layout preview'}
    >
      {rects.map((r) => {
        const i = order ? order.get(r.id) : -1;
        const on = i >= 0 && i === highlight;
        return (
          <g key={r.id}>
            <rect
              className={on ? 'is-highlight' : undefined}
              x={r.x + INSET}
              y={r.y + INSET}
              width={Math.max(0, r.w - INSET * 2)}
              height={Math.max(0, r.h - INSET * 2)}
              rx="1.5"
            />
            {numbered && i >= 0 && (
              <text
                className={on ? 'is-highlight' : undefined}
                x={r.x + r.w / 2}
                y={r.y + r.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {i + 1}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
