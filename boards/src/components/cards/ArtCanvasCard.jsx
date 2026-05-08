// Art canvas card — a bounded drawing surface within a board. Strokes
// live ON the card (`card.strokes` array), so they translate / scale
// with the card and never bleed onto the board's stroke layer.
//
// The component just renders. Stroke capture is owned by CanvasSurface
// — when the draw tool fires inside an art card's bounds, it pushes
// the new stroke onto the card via updateCard({ strokes: [...] }).

export function ArtCanvasCard({ strokes = [], bg = '#ffffff', w = 200, h = 200 }) {
  return (
    <div className="art-canvas-card" style={{ background: bg, width: '100%', height: '100%' }}>
      <svg className="art-canvas-svg"
           viewBox={`0 0 ${w} ${h}`}
           width="100%"
           height="100%"
           preserveAspectRatio="none">
        {(strokes || []).map((s, i) => {
          if (!s?.points?.length) return null;
          let d = `M${s.points[0][0]},${s.points[0][1]}`;
          for (let j = 1; j < s.points.length; j++) {
            d += ` L${s.points[j][0]},${s.points[j][1]}`;
          }
          return (
            <path key={i} d={d}
                  fill="none"
                  stroke={s.color || '#0a0a0c'}
                  strokeWidth={s.width || 3}
                  strokeLinecap="round"
                  strokeLinejoin="round" />
          );
        })}
      </svg>
    </div>
  );
}
