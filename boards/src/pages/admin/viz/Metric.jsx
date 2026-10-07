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
import { StreakStrip } from './StreakStrip.jsx';
import { VAR } from './palette.js';

/**
 * Period-over-period change, as weekDelta() in lib/trendStats.js reads it.
 *
 * The ▲/▼ glyph is not decoration. Good and bad are ~1.6 apart in OKLab under
 * deuteranopia — a red/green pair is exactly the one colour distinction a large
 * minority of readers cannot make — so the direction has to be carried by shape
 * as well. See lib/chartPalette.test.mjs, which asserts this stays true.
 *
 * Two of weekDelta's answers are not directions, and neither gets an arrow or
 * a colour: `thin` (too few events across both weeks for a percentage to mean
 * anything; the text is the signed count) and `noise` (inside what two Poisson
 * weeks differ by anyway). Both draw the flat dot, and say in words why.
 *
 * `quiet` drops the colour to neutral ink and keeps the glyph, for a badge that
 * sits in a sub line beside a streak that has already made the main claim. Its
 * dot then has no colour to say why it is a dot, so a hover title says it.
 * `suffix` names the comparison ("vs prior 7d").
 */
export function DeltaBadge({ delta, quiet = false, suffix }) {
  if (!delta) return null;
  const thin = delta.dir === 'thin';
  const noise = !thin && delta.noise === true;
  const arrow = thin || noise ? '·' : delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '·';
  const word = thin ? 'too few to compare'
    : noise ? 'flat, within noise'
      : delta.dir === 'up' ? 'up' : delta.dir === 'down' ? 'down' : 'flat';
  const tone = thin ? 'is-thin' : noise ? 'is-flat' : `is-${delta.dir}`;
  const why = !quiet ? undefined : thin ? 'too few to compare' : noise ? 'within noise' : undefined;
  return (
    <span className={`admin-stat-delta ${tone}${quiet ? ' is-quiet' : ''}`} title={why}>
      <span aria-hidden="true">{arrow}</span>
      <span className="sr-only">{word} </span>
      {delta.text}
      {suffix && <span className="admin-stat-delta-suffix"> {suffix}</span>}
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
  /**
   * The TrendRead from weeklyTrend() (lib/trendStats.js), or null.
   *
   * With one, the tile answers "has it gone up for weeks?" and not only "how
   * was this week?": a streak strip of per-week glyphs under the figures, then
   * the verdict sentence. The week-over-week badge moves down into the sub line
   * (quiet, and named "vs prior 7d"), because six hero tiles cannot hold a
   * label, a badge and a strip in one head row. Head-right keeps only the
   * directional chip.
   */
  trend,
  sparkColor = VAR.ink,
  title,
  onClick,
  children,
}) {
  const Tag = onClick ? 'button' : 'div';
  // An empty series is no series. `[]` is truthy, so it used to suppress the
  // proportion bar below while drawing nothing in its place.
  const hasSpark = Array.isArray(spark) && spark.length > 0;
  const flag = flagN != null ? <NFlag n={flagN} /> : null;
  // With a trend the badge moves down into the sub block, on a line of its own
  // (`.admin-stat-sub > .admin-stat-delta` in admin.css). Run inline after a
  // separator it wrapped wherever the sub text happened to end, which stranded
  // the separator at the end of one tile's line and not its neighbour's.
  const subDelta = trend && delta ? <DeltaBadge delta={delta} quiet suffix="vs prior 7d" /> : null;
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
        {/* With a trend the head holds only the label and the directional chip. */}
        {trend ? flag : delta ? <DeltaBadge delta={delta} /> : flag}
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
      {trend && (
        <div className="admin-stat-streak"><StreakStrip trend={trend} /></div>
      )}
      {(sub || subDelta) && <div className="admin-stat-sub">{sub}{subDelta}</div>}
      {/* The hover holds the detail (a spike week, a week still settling, how few
          events) and the caveat, which also prints below: the caveat must not hide
          the detail. Neither, and there is no title, so the tile's own shows through. */}
      {trend && (
        <div
          className="admin-stat-verdict"
          title={[trend.verdict?.detail, trend.caveat].filter(Boolean).join(' · ') || undefined}
        >
          {trend.verdict?.label}
        </div>
      )}
      {/* U+2011, the non-breaking hyphen: at 1280 the line wrapped inside its
          own date, leaving "2026-10-" on one line and "01" on the next. */}
      {trend?.caveat && <div className="admin-stat-caveat">{trend.caveat.replace(/-/g, '\u2011')}</div>}
      {hasSpark && (
        <div className="admin-stat-spark"><Spark values={spark} color={sparkColor} /></div>
      )}
      {/* A metric with a lifetime counterpart but no daily series would leave a
          hole in the row where its neighbours have sparklines. The proportion
          bar fills it with something true: how much of the total this window
          is. */}
      {!hasSpark && ratio != null && (
        <div className="admin-stat-ratio" title={ratio.title}>
          <span style={{ width: `${Math.max(1, Math.min(100, ratio.pct * 100))}%`, background: sparkColor }} />
        </div>
      )}
      {/* A tile with a weekly read but no daily series yet keeps the rail's
          height, and says why the slot is empty — the same words Spark prints
          when it has too few points to draw. */}
      {trend && !hasSpark && ratio == null && (
        <div className="admin-stat-spark">
          <div className="admin-stat-spark-empty t-meta">collecting…</div>
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
