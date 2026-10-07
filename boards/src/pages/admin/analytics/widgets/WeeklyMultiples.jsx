// WeeklyMultiples — four weekly series, one above another, on one calendar.
//
// Complete UTC weeks plus the week so far, for each metric the Overview trends.
// Small multiples rather than one chart: the series sit on scales an order of
// magnitude apart, and a shared y axis would press the small ones flat against
// the floor. What they do share is the x axis, so it is drawn once, under the
// stack, and every chart in it leaves its own out.
//
// Every dated marker is drawn on every chart, because a step in any one line is
// what a marker is there to explain, and the eye should not have to carry a date
// down from another row to find it. Only the top row draws the kind's glyph: the
// shape names the kind once, and four copies of it would be noise.
//
// Two honesty rules, drawn rather than written:
//
//   * the week so far is a hollow point the line never reaches. A line into a
//     half-counted week reads as a collapse every Monday.
//   * a week nothing was recording is hatched, in the same --adm-hatch the
//     streak strip uses, and never drawn as a zero.
//
// The charts are pictures; what they mean in words is the verdict on each tile
// above them. The markers are the one thing only the charts carry, so they are
// also listed for a screen reader.

import { AreaChart } from '../../viz/AreaChart.jsx';
import { bandsFromMeasurable, markerIndex, weekLabel } from '../../../../lib/weeklySeries.js';
import { formatCount } from '../../../../lib/adminFormat.js';

/**
 * @param {string[]} weeks         UTC Mondays ('YYYY-MM-DD'), oldest first, the week so far last
 * @param {object[]} series        one row per chart: { key, name, color, values: (number|null)[], measurable: boolean[] }
 * @param {object[]} markers       merged markers, [{ day, kind, label, … }] (lib/weeklySeries.js mergeMarkers)
 * @param {number}   partialWeeks  trailing rows still being counted: 1, or 0 when every row is complete
 */
export function WeeklyMultiples({ weeks = [], series = [], markers = [], partialWeeks = 1 }) {
  // One week is a point, not a line; with nothing to draw, say so once rather
  // than once per row.
  if (!Array.isArray(weeks) || weeks.length < 2 || !Array.isArray(series) || series.length === 0) {
    return <div className="admin-empty">Nothing to plot yet</div>;
  }

  const partial = partialWeeks > 0;
  const labels = weeks.map(weekLabel);
  // Each marker at its day's place on this axis. A day outside the axis has no
  // column to be drawn in, so it is left out here and in the list below.
  const placed = (Array.isArray(markers) ? markers : []).flatMap((m) => {
    const at = markerIndex(m?.day, weeks);
    return at ? [{ ...m, index: at.index, edge: at.edge }] : [];
  });

  return (
    <div className="adm-stack">
      {series.map((row, i) => (
        <div className="adm-stack-row" key={row.key ?? i}>
          <div className="adm-stack-label">{row.name}</div>
          <AreaChart
            height={96}
            // One vertical rule per week. The graph paper then has 4 x (n - 1)
            // minor columns, still a whole number of minors per major.
            vLines={weeks.length - 1}
            axis={false}
            markers={placed}
            markerGlyphs={i === 0}
            markPoints
            partialLast={partial}
            bands={bandsFromMeasurable(row.measurable)}
            labels={labels}
            formatValue={formatCount}
            series={[{ name: row.name, color: row.color, values: row.values }]}
          />
        </div>
      ))}

      <div className="adm-stack-x" aria-hidden="true">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor((weeks.length - 1) / 2)]}</span>
        <span>{partial ? 'so far' : labels[weeks.length - 1]}</span>
      </div>

      {placed.length > 0 && (
        <ul className="sr-only">
          {placed.map((m, k) => (
            <li key={k}>{`Marker, ${m.day}, ${m.kind}: ${m.label}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
