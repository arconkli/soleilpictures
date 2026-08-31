// BarRows — labelled horizontal bars.
//
// The single most useful form on this dashboard, and the replacement for both
// pie charts, most of the BarCharts, and the ranked tables that were drawing
// numbers with no visual weight at all.
//
// Why bars and not a pie: a pie makes you compare angles and re-find each
// label in a legend. A labelled row puts the name, the magnitude and the value
// on one line, sorts them, and survives twenty categories — which the tier and
// device breakdowns both needed and neither had.
//
// Colour is OPT-IN. The default mark is neutral ink, because a ranked list of
// acquisition sources is magnitude, not identity, and colouring it by rank
// would be the exact anti-pattern of colour-follows-position. Pass `colors`
// only when each row is a real entity whose colour should follow it.

import { VAR } from './palette.js';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

export function BarRows({
  rows = [],
  /** Denominator for bar width. Defaults to the largest row. */
  max,
  formatValue = (v) => v.toLocaleString(),
  /** Optional right-hand column, e.g. a share or a rate. */
  secondary,
  /** Per-row colour. A string, or (row, i) => string. Omit for neutral ink. */
  colors,
  /** Rows below this get the muted treatment — used for the "Other" bucket. */
  isMuted,
  emptyLabel = 'Nothing in this window',
  /** Cap the list and roll the rest into one honest remainder row. */
  limit,
}) {
  const all = rows.filter(Boolean);
  if (!all.length) return <div className="admin-empty">{emptyLabel}</div>;

  let shown = all;
  let rolled = null;
  if (limit && all.length > limit) {
    shown = all.slice(0, limit);
    const rest = all.slice(limit);
    rolled = {
      label: `${rest.length} more`,
      value: rest.reduce((a, r) => a + num(r.value), 0),
      muted: true,
    };
  }

  const ceiling = num(max) || Math.max(1, ...all.map((r) => num(r.value)));
  const colorOf = (row, i) => {
    if (row.muted || isMuted?.(row, i)) return VAR.other;
    if (typeof colors === 'function') return colors(row, i);
    if (typeof colors === 'string') return colors;
    return VAR.ink;
  };

  const render = (row, i) => {
    const v = num(row.value);
    const pct = Math.max(0, Math.min(100, (v / ceiling) * 100));
    return (
      <div className={`adm-bar-row ${row.muted ? 'is-muted' : ''}`} key={row.key ?? row.label ?? i}>
        <div className="adm-bar-label" title={row.title || row.label}>
          {row.glyph}
          <span className="adm-bar-label-text">{row.label}</span>
        </div>
        <div className="adm-bar-track">
          {/* min-width keeps a real-but-tiny value visible: rounding a genuine
              1 down to a zero-width bar reads as "none". */}
          <span
            className="adm-bar-fill"
            style={{ width: `${pct}%`, minWidth: v > 0 ? 3 : 0, background: colorOf(row, i) }}
          />
        </div>
        <div className="adm-bar-value">{formatValue(v, row)}</div>
        {secondary && <div className="adm-bar-secondary">{secondary(row, i)}</div>}
      </div>
    );
  };

  return (
    <div className={`adm-bars ${secondary ? 'has-secondary' : ''}`}>
      {shown.map(render)}
      {rolled && render(rolled, shown.length)}
    </div>
  );
}
