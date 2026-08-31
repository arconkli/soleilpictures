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

  return (
    <div className="adm-heat">
      <div className="adm-heat-grid" onPointerLeave={() => setHover(null)}>
        <div className="adm-heat-corner" />
        {Array.from({ length: 24 }, (_, h) => (
          <div className="adm-heat-hour" key={`h${h}`} style={{ gridColumn: h + 2 }}>
            {HOUR_TICKS[h] || ''}
          </div>
        ))}

        {DAYS.map((day, di) => (
          <div className="adm-heat-day" key={day} style={{ gridRow: di + 2 }}>{day}</div>
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
                gridRow: di + 2,
                background: si < 0 ? 'var(--adm-heat-zero)' : VAR.seq[si],
              }}
              onPointerEnter={() => setHover({ day, h, v, actors: num(c?.actors) })}
              aria-label={`${day} ${h}:00 — ${formatValue(v)}`}
            />
          );
        }))}
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
