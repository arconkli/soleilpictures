// UniverseLegend — the key the universe never had, and now also its filter.
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
//
// Clicking a row hides that kind. This is the honest answer to the palette
// ceiling above: when two hues sit near the discrimination floor, the way to
// tell them apart is not a seventh colour, it is to switch one of them off and
// watch what disappears. Hidden rows stay listed (struck through, count
// intact) rather than vanishing — a filter you cannot see is a filter you
// forget you set, and this one silently changes what every other number on the
// screen appears to describe.

import { KIND_LEGEND, KIND_COLORS } from './UniverseGraph.jsx';

export function UniverseLegend({ graph, hiddenKinds, onToggleKind, onShowAll }) {
  const byKind = graph?.byKind || {};
  const rows = KIND_LEGEND
    .map((k) => ({ ...k, n: Number(byKind[k.key]) || 0 }))
    .filter((k) => k.n > 0)
    .sort((a, b) => b.n - a.n);

  if (rows.length === 0) return null;

  const hidden = hiddenKinds || null;
  const anyHidden = !!hidden && hidden.size > 0;
  const interactive = typeof onToggleKind === 'function';

  return (
    <div className="universe-legend surface-frosted" aria-label="Node kinds">
      {rows.map((r) => {
        const off = !!hidden && hidden.has(r.key);
        const title = r.key === 'card'
          ? 'Shapes, videos, schedules, PDFs, audio and files — kinds too rare to earn their own hue'
          : r.label;
        const rowClass = `universe-legend-row ${off ? 'is-off' : ''} ${interactive ? 'is-clickable' : ''}`.trim();
        const body = (
          <>
            <span className="universe-legend-dot" style={{ background: KIND_COLORS[r.key] }} />
            <span className="universe-legend-label">{r.label}</span>
            <span className="universe-legend-n">{r.n.toLocaleString()}</span>
          </>
        );
        if (!interactive) {
          return <div className={rowClass} key={r.key} title={title}>{body}</div>;
        }
        return (
          <button
            type="button"
            className={rowClass}
            key={r.key}
            aria-pressed={!off}
            title={`${title} — click to ${off ? 'show' : 'hide'}`}
            onClick={() => onToggleKind(r.key)}
          >
            {body}
          </button>
        );
      })}
      {interactive && anyHidden && (
        <button type="button" className="universe-legend-reset" onClick={onShowAll}>
          Show all
        </button>
      )}
    </div>
  );
}
