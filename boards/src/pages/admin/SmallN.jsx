// SmallN — the shared honesty layer for the admin dashboard.
//
// At early-stage volumes almost every rate rests on a tiny denominator, so the
// dashboard must never show "100%" off n=1 as if it were a trend. These pieces
// implement the locked two-tier rule (see safeRate in adminFormat.js):
//   denom ≥ 20  → solid          (trust it)
//   5..19       → amber ⚠ flag    (directional only)
//   < 5         → suppressed      ("—" / placeholder)
// and the chart floor MIN_POINTS (don't draw a line through 1-2 points).
//
// Red is reserved for leaks/losses; amber means "interpret carefully".

import { MIN_POINTS, formatCount, formatPct, safeRate } from '../../lib/adminFormat.js';

// Amber "directional · n=N" chip — for KPI tiles whose rate is below the trust
// floor but above the suppression floor.
export function NFlag({ n }) {
  return <span className="admin-stat-flag" title="Sample too small to trust as a trend">directional · n={formatCount(n)}</span>;
}

// Dashed-top footer note: a panel captioning its own sample size / caveat.
export function PanelNote({ children }) {
  return <div className="admin-panel-note">{children}</div>;
}

// Diagonal-hatch "not enough data yet" block. Distinct from an empty state
// (which means the query returned zero rows): here rows exist but are below the
// floor at which a chart would be honest.
export function ChartPlaceholder({ title = 'Not enough data yet', sub }) {
  return (
    <div className="admin-chart-placeholder">
      <div className="admin-chart-placeholder-title">{title}</div>
      {sub && <div className="admin-chart-placeholder-sub">{sub}</div>}
    </div>
  );
}

// Gate a chart on having enough real datapoints; otherwise render the
// placeholder so we never draw a misleading flat 2-point line.
export function ChartGate({ count, min = MIN_POINTS, title, sub, children }) {
  if ((Number(count) || 0) < min) return <ChartPlaceholder title={title} sub={sub} />;
  return children;
}

// Inline rate for a table cell: solid % (trusted), muted %+⚠ (directional), or
// "—" with the sample size (suppressed). Always pass numerator + denominator so
// trust can be judged — never a pre-computed ratio.
export function RateCell({ numer, denom }) {
  const r = safeRate(numer, denom);
  if (r.hide) return <span className="admin-muted" title={`n=${formatCount(r.n)} — too small to show a rate`}>—</span>;
  if (r.flag) return <span className="admin-lown" title={`directional · n=${formatCount(r.n)}`}>{formatPct(r.rate)} ⚠</span>;
  return <span>{formatPct(r.rate)}</span>;
}
