// Heatmap — when the product is actually used, as a weekday × hour grid.
//
// This is the chart the dashboard was missing. Every other panel here answers
// "how many"; at six to seventeen daily actives the daily totals are too small
// to have a shape, and the honest response was a lot of small numbers. Folded
// onto a week, the same events accumulate into real structure — dead hours,
// whether weekends exist, whether this is a workday tool or a night one.
//
// 168 cells, every one drawn. admin_activity_heatmap zero-fills, and it must:
// a heatmap that omits its empty cells is a lie about the shape of the week,
// and the empty cells are half of what you read.
//
// Intensity steps the sequential ramp rather than fading one hue's opacity.
// Opacity over a single colour on a near-black ground has almost no range —
// the first attempt made every busy hour the same blue — where the ramp runs
// from a deep navy to a pale blue and separates the buckets properly.
//
// Five steps, not a continuous scale: 168 cells read as a pattern, and the eye
// compares them in bands anyway. Zero gets its own flat tone so "nothing
// happened" never looks like "a little happened".
//
// The scale is sqrt, not linear. One outlier hour of 1,207 events against a
// median in the tens would otherwise push every other cell into the bottom
// bucket and the grid would read as empty.
//
// MARGINALS. A per-hour total across the top and a per-day total down the right
// side. The grid alone makes you squint to answer "which day is busiest" and
// "which hour is busiest", which are the two questions people bring to it; the
// margins answer both at a glance and cost no extra query, because the 168
// cells were already fetched.
//
// The day margin plots ACTORS, not events. `actors` has been returned by the
// RPC all along and appeared nowhere except a hover tooltip, and it is the more
// honest of the two at this end: one person having a very busy Tuesday should
// not make Tuesday look like a popular day.

import { useState } from 'react';
import { VAR } from './palette.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

/** 12a / 6a / 12p / 6p — enough to orient, few enough to read. */
const HOUR_TICKS = { 0: '12a', 6: '6a', 12: '12p', 18: '6p' };

export function Heatmap({
  /** [{ dow (1=Mon…7=Sun), hour (0-23), events, actors }] */
  cells = [],
  formatValue = (v) => `${v.toLocaleString()} events`,
  emptyLabel = 'No activity recorded in this window.',
}) {
  const [hover, setHover] = useState(null);

  const byKey = new Map(cells.map((c) => [`${num(c.dow)}-${num(c.hour)}`, c]));
  const peak = Math.max(0, ...cells.map((c) => num(c.events)));
  if (!peak) return <div className="admin-empty">{emptyLabel}</div>;

  // sqrt compresses the long tail so the median hours stay visible.
  const step = (v) => {
    if (v <= 0) return -1;
    const t = Math.sqrt(v / peak);
    return Math.min(4, Math.floor(t * 5));
  };

  // Margins. Hours sum events across the seven days; days sum DISTINCT-ish
  // actors across the twenty-four hours — a per-hour distinct count, so summing
  // it over-counts anyone active in two hours. That is stated in the tooltip
  // rather than silently presented as a headcount.
  const hourTotals = Array.from({ length: 24 }, (_, h) =>
    DAYS.reduce((a, _d, di) => a + num(byKey.get(`${di + 1}-${h}`)?.events), 0));
  const hourMax = Math.max(1, ...hourTotals);

  const dayActors = DAYS.map((_d, di) =>
    Array.from({ length: 24 }, (_, h) => num(byKey.get(`${di + 1}-${h}`)?.actors))
      .reduce((a, b) => a + b, 0));
  const dayMax = Math.max(1, ...dayActors);
  const busiestDay = dayActors.indexOf(Math.max(...dayActors));

  return (
    <div className="adm-heat">
      <div className="adm-heat-grid has-margins" onPointerLeave={() => setHover(null)}>
        <div className="adm-heat-corner" />
        {Array.from({ length: 24 }, (_, h) => (
          <div className="adm-heat-hour" key={`h${h}`} style={{ gridColumn: h + 2 }}>
            {HOUR_TICKS[h] || ''}
          </div>
        ))}

        {/* Hour margin — total events at this hour across the whole window. */}
        {hourTotals.map((t, h) => (
          <div
            className="adm-heat-marg is-hour"
            key={`hm${h}`}
            style={{ gridColumn: h + 2, gridRow: 2 }}
            title={`${HOUR_TICKS[h] || `${h}:00`} — ${formatValue(t)} across the window`}
          >
            <span style={{ height: `${Math.max(4, (t / hourMax) * 100)}%` }} />
          </div>
        ))}
        <div className="adm-heat-marg-label" style={{ gridColumn: 26, gridRow: 2 }}>people</div>

        {DAYS.map((day, di) => (
          <div className="adm-heat-day" key={day} style={{ gridRow: di + 3 }}>{day}</div>
        ))}

        {DAYS.map((day, di) => Array.from({ length: 24 }, (_, h) => {
          const c = byKey.get(`${di + 1}-${h}`);
          const v = num(c?.events);
          const si = step(v);
          const isPeak = v === peak;
          return (
            <button
              type="button"
              key={`${di}-${h}`}
              className={`adm-heat-cell ${isPeak ? 'is-peak' : ''} ${si < 0 ? 'is-zero' : ''}`}
              style={{
                gridColumn: h + 2,
                gridRow: di + 3,
                background: si < 0 ? 'var(--adm-heat-zero)' : VAR.seq[si],
              }}
              onPointerEnter={() => setHover({ day, h, v, actors: num(c?.actors) })}
              aria-label={`${day} ${h}:00 — ${formatValue(v)}`}
            />
          );
        }))}

        {/* Day margin — people, not events, for the reason in the header. */}
        {dayActors.map((t, di) => (
          <div
            className={`adm-heat-marg is-day ${di === busiestDay ? 'is-busiest' : ''}`}
            key={`dm${di}`}
            style={{ gridColumn: 26, gridRow: di + 3 }}
            title={`${DAYS[di]} — ${t} person-hours (someone active in two hours counts twice)`}
          >
            <span style={{ width: `${Math.max(4, (t / dayMax) * 100)}%` }} />
          </div>
        ))}
      </div>

      <div className="adm-heat-foot">
        <div className="adm-heat-legend">
          <span>less</span>
          <span className="adm-heat-swatch" style={{ background: 'var(--adm-heat-zero)' }} />
          {VAR.seq.map((c, i) => (
            <span key={i} className="adm-heat-swatch" style={{ background: c }} />
          ))}
          <span>more</span>
        </div>
        <div className="adm-heat-read">
          {hover
            ? <>
                <b>{hover.day} {hover.h === 0 ? '12am' : hover.h < 12 ? `${hover.h}am` : hover.h === 12 ? '12pm' : `${hover.h - 12}pm`}</b>
                {' · '}{formatValue(hover.v)}
                {hover.actors > 0 && <> · {hover.actors} {hover.actors === 1 ? 'person' : 'people'}</>}
              </>
            : <span className="adm-heat-hint">peak {formatValue(peak)} in one hour</span>}
        </div>
      </div>
    </div>
  );
}
