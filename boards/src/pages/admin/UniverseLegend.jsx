// UniverseLegend — the key the universe never had.
//
// Why this exists rather than more colors: the six shipped planet hues already
// saturate the perceptual field. Measured all-pairs against the space
// background, link-blue and palette-teal sit at ΔE 10.6 under NORMAL vision —
// below the 15 floor — before anything new is added, and every candidate extra
// hue tested collided harder (rose↔teal ΔE 1.4 under deuteranopia). So the
// renderer stopped at one addition (grid) and everything else shares the
// neutral slate; this legend is what carries identity instead, and it earns
// its place twice over by showing the per-kind counts, which nothing else did.
//
// Counts come from the renderer's own tally, so a kind listed here is a kind
// you can actually see.

import { KIND_LEGEND, KIND_COLORS } from './UniverseGraph.jsx';

export function UniverseLegend({ graph }) {
  const byKind = graph?.byKind || {};
  const rows = KIND_LEGEND
    .map((k) => ({ ...k, n: Number(byKind[k.key]) || 0 }))
    .filter((k) => k.n > 0)
    .sort((a, b) => b.n - a.n);

  if (rows.length === 0) return null;

  return (
    <div className="universe-legend surface-frosted" aria-label="Node kinds">
      {rows.map((r) => (
        <div className="universe-legend-row" key={r.key}
             title={r.key === 'card'
               ? 'Shapes, videos, schedules, PDFs, audio and files — kinds too rare to earn their own hue'
               : r.label}>
          <span className="universe-legend-dot" style={{ background: KIND_COLORS[r.key] }} />
          <span className="universe-legend-label">{r.label}</span>
          <span className="universe-legend-n">{r.n.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
