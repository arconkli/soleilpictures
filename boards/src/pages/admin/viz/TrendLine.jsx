// TrendLine — a value over time, drawn in SVG.
//
// Replaces every Recharts LineChart / AreaChart / sparkline on the dashboard.
// The point is not to save the dependency (though it saves 136KB gzipped); it
// is that Recharts' defaults ARE the look the dashboard was being judged for.
//
// Two implementation notes that matter if you edit this:
//
//   * The plot is a 0..100 x 0..100 viewBox with preserveAspectRatio="none",
//     so the path stretches to whatever box it is given without any measuring.
//     Strokes carry vector-effect="non-scaling-stroke" so they stay 2px through
//     that stretch. Anything that must NOT distort — the hover dot, every label
//     — is HTML positioned over the SVG, never a shape inside it.
//
//   * GAPS ARE REAL. metrics_daily has no backfill, so the series genuinely has
//     holes, and a line drawn straight across a hole invents the days it is
//     missing. A null `v` breaks the path into a new segment, and a lone point
//     with holes either side is drawn as a dot rather than silently dropped.

import { useId, useMemo, useRef, useState } from 'react';
import { MIN_POINTS } from '../../../lib/adminFormat.js';
import { VAR } from './palette.js';

const num = (x) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));

/** Split into runs of consecutive non-null points, keeping original indices. */
function segments(values) {
  const runs = [];
  let cur = null;
  values.forEach((v, i) => {
    if (v == null) { cur = null; return; }
    if (!cur) { cur = []; runs.push(cur); }
    cur.push(i);
  });
  return runs;
}

export function TrendLine({
  points = [],
  height = 120,
  color = VAR.ink,
  area = false,
  formatValue = (v) => String(v),
  label,
  /** Render at sparkline size: no axis labels, no hover, minimal furniture. */
  spark = false,
  /** Below this many real points, say so instead of drawing a trend. */
  minPoints = MIN_POINTS,
  baselineZero = true,
}) {
  const gradId = useId();
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);

  const vals = useMemo(() => points.map((p) => num(p?.v)), [points]);
  const real = vals.filter((v) => v != null);

  const { lo, hi } = useMemo(() => {
    if (!real.length) return { lo: 0, hi: 1 };
    let min = Math.min(...real);
    let max = Math.max(...real);
    if (baselineZero && min > 0) min = 0;
    if (max === min) { max = min + 1; }        // a flat series still needs a band
    return { lo: min, hi: max };
  }, [real, baselineZero]);

  // A 1–2 point line reads as a trend that has not been measured. Say the true
  // thing instead.
  if (real.length < minPoints) {
    return spark
      ? <div className="admin-stat-spark-empty t-meta">collecting…</div>
      : (
        <div className="adm-viz-empty" style={{ height }}>
          <span>Not enough data yet</span>
          <span className="adm-viz-empty-sub">
            {real.length} of {minPoints} points needed
          </span>
        </div>
      );
  }

  const n = vals.length;
  const x = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v) => 100 - ((v - lo) / (hi - lo)) * 100;

  const runs = segments(vals);
  const paths = runs.filter((r) => r.length > 1)
    .map((r) => r.map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(vals[i]).toFixed(2)}`).join(' '));
  const lonely = runs.filter((r) => r.length === 1).map((r) => r[0]);
  const areaPaths = area
    ? runs.filter((r) => r.length > 1).map((r) => {
      const line = r.map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(vals[i]).toFixed(2)}`).join(' ');
      return `${line} L${x(r[r.length - 1]).toFixed(2)} 100 L${x(r[0]).toFixed(2)} 100 Z`;
    })
    : [];

  const onMove = (e) => {
    if (spark) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    let i = Math.round(t * (n - 1));
    // Snap to the nearest point that actually exists, so hovering a gap reads
    // the neighbour rather than reporting a value for a day with no data.
    if (vals[i] == null) {
      let best = null;
      for (let k = 0; k < n; k++) if (vals[k] != null && (best == null || Math.abs(k - i) < Math.abs(best - i))) best = k;
      i = best;
    }
    if (i == null) return;
    setHover(i);
  };

  const first = points[0]?.label;
  const last = points[n - 1]?.label;

  return (
    <div className={`adm-trend ${spark ? 'is-spark' : ''}`}>
      <div
        ref={wrapRef}
        className="adm-trend-plot"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {area && (
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
          )}
          {areaPaths.map((d, i) => <path key={`a${i}`} d={d} fill={`url(#${gradId})`} />)}
          {paths.map((d, i) => (
            <path
              key={`l${i}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={spark ? 1.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* An isolated reading, with no neighbour to join. Drawn, not dropped. */}
          {lonely.map((i) => (
            <path
              key={`p${i}`}
              d={`M${x(i).toFixed(2)} ${y(vals[i]).toFixed(2)} l0 0`}
              stroke={color}
              strokeWidth={spark ? 2.5 : 4}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Hover furniture lives in HTML — a circle inside a non-uniformly
            scaled viewBox would render as an ellipse. */}
        {hover != null && vals[hover] != null && (
          <>
            <div className="adm-trend-crosshair" style={{ left: `${x(hover)}%` }} />
            <div
              className="adm-trend-dot"
              style={{ left: `${x(hover)}%`, top: `${y(vals[hover])}%`, background: color }}
            />
            <div
              className={`adm-trend-tip ${x(hover) > 60 ? 'is-left' : ''}`}
              style={{ left: `${x(hover)}%` }}
            >
              <span className="adm-trend-tip-v">{formatValue(vals[hover])}</span>
              {points[hover]?.label && <span className="adm-trend-tip-x">{points[hover].label}</span>}
            </div>
          </>
        )}
      </div>

      {!spark && (first || last) && (
        <div className="adm-trend-axis">
          <span>{first}</span>
          {label && <span className="adm-trend-axis-mid">{label}</span>}
          <span>{last}</span>
        </div>
      )}
    </div>
  );
}

/**
 * MultiTrend — several series sharing one plot, one x-axis and one crosshair.
 *
 * This is the only genuine multi-series chart on the dashboard, which is why
 * the categorical palette exists at all. It carries a legend unconditionally
 * (identity must never rest on colour alone) and reads its hues from
 * `series[].color`, so colour follows the entity: hiding a source because it is
 * below the sample floor must not repaint the survivors.
 *
 * `series` = [{ key, label, color, values: (number|null)[] }], all the same
 * length as `labels`.
 */
export function MultiTrend({
  series = [],
  labels = [],
  height = 200,
  formatValue = (v) => String(v),
  domain,
}) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);

  const live = series.filter((s) => (s.values || []).some((v) => v != null));
  if (!live.length) return <div className="admin-empty">Nothing to plot yet.</div>;

  const all = live.flatMap((s) => s.values).filter((v) => v != null).map(Number);
  const lo = domain ? domain[0] : Math.min(0, ...all);
  const hiRaw = domain ? domain[1] : Math.max(...all);
  const hi = hiRaw === lo ? lo + 1 : hiRaw;

  const n = labels.length || Math.max(...live.map((s) => s.values.length));
  const x = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v) => 100 - ((v - lo) / (hi - lo)) * 100;

  const onMove = (e) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(t * (n - 1)));
  };

  return (
    <div className="adm-trend">
      <div className="adm-legend">
        {live.map((s) => (
          <span className="adm-legend-item" key={s.key}>
            <span className="adm-legend-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div
        ref={wrapRef}
        className="adm-trend-plot"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {live.map((s) => {
            const runs = segments(s.values.map((v) => (v == null ? null : Number(v))));
            return runs.filter((r) => r.length > 1).map((r, k) => (
              <path
                key={`${s.key}-${k}`}
                d={r.map((i, j) => `${j === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(Number(s.values[i])).toFixed(2)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ));
          })}
        </svg>

        {hover != null && (
          <>
            <div className="adm-trend-crosshair" style={{ left: `${x(hover)}%` }} />
            {live.map((s) => {
              const v = s.values[hover];
              if (v == null) return null;
              return (
                <div
                  key={s.key}
                  className="adm-trend-dot"
                  style={{ left: `${x(hover)}%`, top: `${y(Number(v))}%`, background: s.color }}
                />
              );
            })}
            <div className={`adm-trend-tip ${x(hover) > 60 ? 'is-left' : ''}`} style={{ left: `${x(hover)}%` }}>
              {labels[hover] && <span className="adm-trend-tip-x">{labels[hover]}</span>}
              {live.map((s) => (
                s.values[hover] == null ? null : (
                  <span className="adm-trend-tip-row" key={s.key}>
                    <span className="adm-legend-swatch" style={{ background: s.color }} />
                    <span className="adm-trend-tip-v">{formatValue(Number(s.values[hover]))}</span>
                    <span className="adm-trend-tip-x">{s.label}</span>
                  </span>
                )
              ))}
            </div>
          </>
        )}
      </div>
      {labels.length > 0 && (
        <div className="adm-trend-axis">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Sparkline shorthand — `values` is a plain number array, oldest first.
 *
 * baselineZero is off here on purpose. A sparkline is 30px tall and exists to
 * show the SHAPE of a series; anchoring it to zero flattens a 96-to-115 signup
 * week into a horizontal line. The tile's own value carries the magnitude.
 */
export function Spark({ values = [], color = VAR.ink, height = 30 }) {
  return (
    <TrendLine
      points={values.map((v) => ({ v }))}
      height={height}
      color={color}
      spark
      baselineZero={false}
    />
  );
}
