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
//
// The weekly stack (widgets/WeeklyMultiples.jsx) adds four things, each off by
// default so every other chart draws exactly as before:
//
//   * `markers`: dated events as dashed verticals at a fractional index, named
//     in the hover tip, with the kind's glyph on top when `markerGlyphs` is set.
//     They are their own class and never `.adm-area-vgrid`: the vertical rules
//     are the graticule, and the graph-paper guard counts them.
//   * `bands`: hatched spans where nothing was being recorded, in the same
//     `--adm-hatch` the streak strip and the cohort matrix use for that.
//   * `markPoints` and `partialLast`: a dot per reading, and the newest reading,
//     a period still being counted, drawn hollow and never joined. A line into
//     a half-counted week would read as a fall every Monday.
//   * `axis={false}`: no date row, for a stack that draws one shared axis.

import { useId, useMemo, useRef, useState } from 'react';
import { VAR } from './palette.js';
import { MARKER_KINDS, glyphFor } from './markerGlyphs.js';

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
/**
 * Minor cells per major cell, on both axes.
 *
 * Four is what makes it read as graph paper rather than as a slightly denser
 * set of gridlines, and — the whole point — every SUBth minor line lands
 * exactly on a tick, because both are expressed as fractions of the same box.
 */
const SUB = 4;

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
  /** Dated events, [{ index, edge, kind, label, day }]: a dashed vertical at x(index), where
   *  index may fall between two points. `edge` draws it flush inside the right rule. */
  markers = [],
  /** Draw each marker's kind glyph at the top of its line (one chart of a stack, not all). */
  markerGlyphs = false,
  /** A dot on every reading, for a few discrete totals rather than a curve. */
  markPoints = false,
  /** The last point is a period still being counted: left out of the line, the fill and
   *  markLast, and drawn as a hollow dot. */
  partialLast = false,
  /** Hatched spans, [{ from, to, title }] in index units, drawn from x(from) to x(to). */
  bands = [],
  /** false leaves out the date row under the plot, for a caller that draws one shared axis. */
  axis = true,
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

  // The index of the reading still being counted, or -1. The line and the fill
  // are drawn from `joined`, which leaves it out; the hollow dot below draws it.
  const partial = partialLast ? n - 1 : -1;
  const joined = (s) => s.values.map((v, i) => (i === partial ? null : num(v)));

  // Markers and bands come from callers, so anything that cannot be placed is
  // dropped and anything past an end is pinned to it.
  const pin = (i) => Math.min(n - 1, Math.max(0, i));
  const marks = (Array.isArray(markers) ? markers : []).filter((m) => Number.isFinite(m?.index));
  const spans = (Array.isArray(bands) ? bands : [])
    .filter((b) => Number.isFinite(b?.from) && Number.isFinite(b?.to))
    .map((b) => ({ from: pin(b.from), to: pin(b.to), title: b.title }))
    .filter((b) => b.to > b.from);
  const markText = (m) => [m.day, m.label].filter(Boolean).join(' · ');

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
          className="adm-area-plot is-ruled"
          style={{ '--adm-gx': vLines * SUB, '--adm-gy': gridLines * SUB }}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* THE GRATICULE IS THE SCALE, AND THE PAPER SUBDIVIDES IT.
             *
             * The dense ruling is back, but it is no longer independent of the
             * chart. It used to sit at a fixed 18px pitch, and tick spacing is
             * a function of the data's RANGE, so the two could never line up —
             * two grids crossing at unrelated intervals, which is what made
             * this look wrong.
             *
             * Now the paper is drawn in PERCENTAGES of the same divisions:
             * SUB minor cells per major, on both axes. Every fourth minor line
             * therefore falls exactly on a tick, at any size, with no
             * arithmetic to keep in sync — see --adm-gx / --adm-gy below. */}
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

          {/* Unmeasured spans, then dated markers. Both come after the rules:
             `.adm-area-grid:first-of-type` strokes the baseline, and a band
             ahead of it would become the first div and take that away. */}
          {spans.map((b, k) => (
            <div
              key={`b${k}`}
              className="adm-area-band"
              style={{ left: `${x(b.from)}%`, width: `${x(b.to) - x(b.from)}%` }}
              title={b.title || undefined}
              aria-hidden="true"
            />
          ))}
          {marks.map((m, k) => (
            <div
              key={`m${k}`}
              className={`adm-area-marker is-${MARKER_KINDS.includes(m.kind) ? m.kind : 'other'}${m.edge ? ' is-edge' : ''}`}
              style={{ left: `${x(pin(m.index))}%` }}
              title={markText(m) || undefined}
              aria-hidden="true"
            >
              {markerGlyphs ? <span className="adm-area-marker-glyph">{glyphFor(m.kind)}</span> : null}
            </div>
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
              const vals = joined(s);
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

          {/* A dot per reading when asked for, and always the hollow one for a
             reading still being counted. HTML, so a dot stays round however
             the plot is stretched. */}
          {live.flatMap((s, si) => s.values.map((raw, i) => {
            const v = num(raw);
            if (v == null || i >= n || (!markPoints && i !== partial)) return null;
            return (
              <div
                key={`p${si}-${i}`}
                className={`adm-area-pt${i === partial ? ' is-partial' : ''}`}
                style={{ left: `${x(i)}%`, top: `${y(v)}%`, '--_c': s.color }}
                aria-hidden="true"
              />
            );
          }))}

          {/* Last value, called out — the number you look for first. */}
          {markLast && live.map((s) => {
            const vals = joined(s);
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
                // Hollow on the reading still being counted, as it is at rest.
                const hollow = hover === partial;
                return (
                  <div
                    key={s.name}
                    className={`adm-area-dot${hollow ? ' is-partial' : ''}`}
                    style={{ left: `${x(hover)}%`, top: `${y(v)}%`, ...(hollow ? { '--_c': s.color } : { background: s.color }) }}
                  />
                );
              })}
              <div className={`adm-area-tip ${x(hover) > 62 ? 'is-left' : ''}`} style={{ left: `${x(hover)}%` }}>
                {labels[hover] && (
                  <span className="adm-area-tip-x">{labels[hover]}{hover === partial ? ' · so far' : ''}</span>
                )}
                {live.map((s) => {
                  const v = num(s.values[hover]);
                  // A hole inside a band says what the band says, not just "no data".
                  const why = v == null && spans.find((b) => hover >= b.from && hover < b.to)?.title;
                  return (
                    <span className="adm-area-tip-row" key={s.name}>
                      <span className="adm-legend-swatch" style={{ background: s.color }} />
                      <span className="adm-area-tip-v">{v == null ? (why || 'no data') : formatValue(v)}</span>
                      {live.length > 1 && <span className="adm-area-tip-n">{s.name}</span>}
                    </span>
                  );
                })}
                {/* The markers in this column: a day belongs to the week it falls in. */}
                {marks.filter((m) => Math.floor(pin(m.index)) === hover).map((m, k) => (
                  <span className="adm-area-tip-m" key={`m${k}`}>{markText(m)}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {axis && (
        <div className="adm-area-x">
          <span>{labels[0]}</span>
          <span>{labels[Math.floor((n - 1) / 2)]}</span>
          <span>{labels[n - 1]}</span>
        </div>
      )}
    </div>
  );
}

export const AREA_COLORS = VAR.cat;
