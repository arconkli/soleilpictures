// Metric — one number, and the honest context for it.
//
// Collapses AdminStatCard and AdminKpiStrip's private KpiCard, which had drifted
// into two implementations of the same tile: one supported a delta and a
// sparkline, the other did not, and which you got depended on which view you
// were looking at.
//
// The `hero` flag is the hierarchy. Every stat used to render at 32px display
// type, which meant nothing on the page was bigger than anything else. Large is
// now something you spend — on the four metrics at the top of Today, and
// nowhere else.

import { formatCount } from '../../../lib/adminFormat.js';
import { Spark } from './TrendLine.jsx';
import { VAR } from './palette.js';

/**
 * Period-over-period change.
 *
 * The ▲/▼ glyph is not decoration. Good and bad are ~1.6 apart in OKLab under
 * deuteranopia — a red/green pair is exactly the one colour distinction a large
 * minority of readers cannot make — so the direction has to be carried by shape
 * as well. See lib/chartPalette.test.mjs, which asserts this stays true.
 */
export function DeltaBadge({ delta }) {
  if (!delta) return null;
  const arrow = delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '·';
  const word = delta.dir === 'up' ? 'up' : delta.dir === 'down' ? 'down' : 'flat';
  return (
    <span className={`admin-stat-delta is-${delta.dir}`}>
      <span aria-hidden="true">{arrow}</span>
      <span className="sr-only">{word} </span>
      {delta.text}
    </span>
  );
}

/** Amber "the denominator is thin" chip. A confidence flag, not a warning. */
export function NFlag({ n }) {
  return (
    <span className="admin-stat-flag" title="Sample too small to trust as a trend">
      directional · n={formatCount(n)}
    </span>
  );
}

export function Metric({
  label,
  value,
  sub,
  delta,
  /** Show the directional chip instead of a delta, with this denominator. */
  flagN,
  /**
   * The lifetime counterpart, shown small beside the window figure.
   *
   * Every total on this dashboard is paired with its recent number on purpose.
   * A lifetime count on its own is a vanity number — it only goes up, so it
   * cannot tell you anything is wrong — but sitting next to "this week" it
   * gives the week a sense of scale. `{ value, label }`.
   */
  total,
  muted,
  hero,
  accent,
  /** Plain number array, oldest first. Gated internally on MIN_POINTS. */
  spark,
  /** `{ pct, title }` — a proportion bar for metrics with no daily series. */
  ratio,
  sparkColor = VAR.ink,
  title,
  onClick,
  children,
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={[
        'admin-stat-card',
        hero && 'is-hero',
        accent && 'is-accent',
        muted && 'is-lown',
        onClick && 'is-clickable',
      ].filter(Boolean).join(' ')}
    >
      <div className="admin-stat-head">
        <div className="admin-stat-label">{label}</div>
        {delta ? <DeltaBadge delta={delta} /> : flagN != null ? <NFlag n={flagN} /> : null}
      </div>
      <div className="admin-stat-figures">
        <span className="admin-stat-value">{value == null ? '—' : value}</span>
        {total && (
          <span className="admin-stat-total">
            <b>{total.value}</b>
            <span>{total.label}</span>
          </span>
        )}
      </div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
      {spark && spark.length > 0 && (
        <div className="admin-stat-spark"><Spark values={spark} color={sparkColor} /></div>
      )}
      {/* A metric with a lifetime counterpart but no daily series would leave a
          hole in the row where its neighbours have sparklines. The proportion
          bar fills it with something true: how much of the total this window
          is. */}
      {!spark && ratio != null && (
        <div className="admin-stat-ratio" title={ratio.title}>
          <span style={{ width: `${Math.max(1, Math.min(100, ratio.pct * 100))}%`, background: sparkColor }} />
        </div>
      )}
      {children}
    </Tag>
  );
}

/** The row Metrics sit in. `hero` widens the minimum track so four fit a screen. */
export function MetricGrid({ hero, children }) {
  return <div className={`admin-stat-grid ${hero ? 'is-hero' : ''}`}>{children}</div>;
}

/**
 * Period-over-period delta from a current and prior value.
 *
 * Returns null rather than a zero badge when the prior is unknown —
 * metrics_daily has no backfill, so "no prior datapoint" is common and must
 * read as "—", never as a confident flat.
 */
export function deltaInfo(cur, prev, kind = 'count') {
  const c = cur == null || Number.isNaN(Number(cur)) ? null : Number(cur);
  const p = prev == null || Number.isNaN(Number(prev)) ? null : Number(prev);
  if (c == null || p == null) return null;
  const diff = c - p;
  if (kind === 'rate') {
    const dir = Math.abs(diff) < 0.0005 ? 'flat' : diff > 0 ? 'up' : 'down';
    return { dir, text: `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)}pp` };
  }
  if (p === 0) {
    if (c === 0) return null;
    return { dir: 'up', text: 'new' };
  }
  const pct = (diff / p) * 100;
  return { dir: diff === 0 ? 'flat' : diff > 0 ? 'up' : 'down', text: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%` };
}
