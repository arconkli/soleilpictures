// AreaChart — the big one. A series over time, at a size worth looking at.
//
// TrendLine is deliberately bare: no axes, no grid, no scale, because it is
// used at 38px inside a metric tile. This is the opposite brief — a chart that
// is the reason you scrolled to a section, with a gradient ground, a readable
// scale, and a crosshair that tells you the value on any day.
//
// Same two mechanics as TrendLine, for the same reasons:
//
//   * The plot is a 0..100 viewBox with preserveAspectRatio="none" so the path
//     stretches to any box without measuring. Strokes use non-scaling-stroke;
//     anything that must not distort — dots, labels, grid lines — is HTML
//     positioned over the SVG.
//
//   * A null value breaks the path. metrics_daily has no backfill, so the
//     series genuinely has holes, and a line drawn across a hole invents the
//     days it is missing.

import { useId, useMemo, useRef, useState } from 'react';
import { VAR } from './palette.js';

const num = (x) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));

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

/** A rounded scale ceiling, so the axis reads 0 / 40 / 80 rather than 0 / 37 / 74. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

export function AreaChart({
  /** [{ label, values: [n|null, …], color, name }] — all the same length. */
  series = [],
  labels = [],
  height = 260,
  formatValue = (v) => v.toLocaleString(),
  /** Draw the last point as a dot with its value in a pill. */
  markLast = true,
  gridLines = 4,
  /** Vertical divisions of the time span. Equal divisions of a linear date
   *  axis are equal intervals, so these carry meaning rather than texture. */
  vLines = 6,
  emptyLabel = 'Nothing to plot yet',
}) {
  const uid = useId();
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);

  const live = series.filter((s) => (s.values || []).some((v) => num(v) != null));
  const n = labels.length || Math.max(0, ...live.map((s) => s.values.length));

  const top = useMemo(() => {
    const all = live.flatMap((s) => s.values).map(num).filter((v) => v != null);
    return niceMax(Math.max(1, ...all));
  }, [live]);

  if (!live.length || n < 2) return <div className="admin-empty">{emptyLabel}</div>;

  const x = (i) => (i / (n - 1)) * 100;
  const y = (v) => 100 - (v / top) * 100;

  const onMove = (e) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(Math.round(t * (n - 1)));
  };

  const ticks = Array.from({ length: gridLines + 1 }, (_, i) => (top / gridLines) * i);

  return (
    <div className="adm-area">
      {live.length > 1 && (
        <div className="adm-legend">
          {live.map((s) => (
            <span className="adm-legend-item" key={s.name}>
              <span className="adm-legend-swatch" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <div className="adm-area-frame" style={{ height }}>
        {/* Scale. HTML rather than SVG text so it never stretches with the plot. */}
        <div className="adm-area-scale" aria-hidden="true">
          {ticks.slice().reverse().map((t, i) => (
            <div className="adm-area-tick" key={i}>
              <span>{formatValue(Math.round(t))}</span>
            </div>
          ))}
        </div>

        <div
          ref={wrapRef}
          className="adm-area-plot"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* THE GRATICULE IS THE SCALE.
             *
             * There used to be a second, decorative graph paper behind this at
             * a fixed pixel pitch, and because the tick spacing is a function
             * of the data's range it never lined up with these — two grids
             * crossing at unrelated intervals, which is what made the charts
             * look busy rather than instrumented.
             *
             * So the ruling is only ever the axes now. Horizontals sit on the
             * value ticks; verticals divide the time span evenly, which on a
             * linear date axis is a real interval and not a decoration. */}
          {ticks.map((t, i) => (
            <div key={i} className="adm-area-grid" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden="true" />
          ))}
          {Array.from({ length: vLines + 1 }, (_, i) => (
            <div
              key={`v${i}`}
              className="adm-area-vgrid"
              style={{ left: `${(i / vLines) * 100}%` }}
              aria-hidden="true"
            />
          ))}

          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              {live.map((s, si) => (
                <linearGradient key={s.name} id={`${uid}-g${si}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.34" />
                  <stop offset="55%" stopColor={s.color} stopOpacity="0.10" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>

            {live.map((s, si) => {
              const vals = s.values.map(num);
              const runs = segments(vals);
              return (
                <g key={s.name}>
                  {runs.filter((r) => r.length > 1).map((r, k) => {
                    const line = r.map((i, j) => `${j === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(vals[i]).toFixed(2)}`).join(' ');
                    return (
                      <path
                        key={`f${k}`}
                        d={`${line} L${x(r[r.length - 1]).toFixed(2)} 100 L${x(r[0]).toFixed(2)} 100 Z`}
                        fill={`url(#${uid}-g${si})`}
                      />
                    );
                  })}
                  {runs.filter((r) => r.length > 1).map((r, k) => (
                    <path
                      key={`l${k}`}
                      d={r.map((i, j) => `${j === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(vals[i]).toFixed(2)}`).join(' ')}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              );
            })}
          </svg>

          {/* Last value, called out — the number you look for first. */}
          {markLast && live.map((s) => {
            const vals = s.values.map(num);
            let li = -1;
            for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) { li = i; break; }
            if (li < 0) return null;
            return (
              <div
                key={s.name}
                className="adm-area-last"
                style={{ left: `${x(li)}%`, top: `${y(vals[li])}%`, '--_c': s.color }}
              >
                <span className="adm-area-last-dot" />
              </div>
            );
          })}

          {hover != null && (
            <>
              <div className="adm-area-crosshair" style={{ left: `${x(hover)}%` }} />
              {live.map((s) => {
                const v = num(s.values[hover]);
                if (v == null) return null;
                return (
                  <div
                    key={s.name}
                    className="adm-area-dot"
                    style={{ left: `${x(hover)}%`, top: `${y(v)}%`, background: s.color }}
                  />
                );
              })}
              <div className={`adm-area-tip ${x(hover) > 62 ? 'is-left' : ''}`} style={{ left: `${x(hover)}%` }}>
                {labels[hover] && <span className="adm-area-tip-x">{labels[hover]}</span>}
                {live.map((s) => {
                  const v = num(s.values[hover]);
                  return (
                    <span className="adm-area-tip-row" key={s.name}>
                      <span className="adm-legend-swatch" style={{ background: s.color }} />
                      <span className="adm-area-tip-v">{v == null ? 'no data' : formatValue(v)}</span>
                      {live.length > 1 && <span className="adm-area-tip-n">{s.name}</span>}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="adm-area-x">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor((n - 1) / 2)]}</span>
        <span>{labels[n - 1]}</span>
      </div>
    </div>
  );
}

export const AREA_COLORS = VAR.cat;
