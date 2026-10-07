// WeeklyMultiples — four weekly series, one above another, on one calendar.
//
// Complete UTC weeks plus the week so far, for each metric the Overview trends.
// Small multiples rather than one chart: the series sit on scales an order of
// magnitude apart, and a shared y axis would press the small ones flat against
// the floor. What they do share is the x axis, so it is drawn once, under the
// stack, and every chart in it leaves its own out.
//
// A marker about the product (a note, an alert, a release) is drawn on every
// chart, because a step in any one line is what a marker is there to explain and
// the eye should not have to carry a date down from another row to find it. A
// definition break is about one counter, so it is drawn only on the charts whose
// column it names, and a break about a counter none of these charts draw is on
// none of them (lib/weeklySeries.js markersForColumn); the markers list beside
// the stack still carries it. A marker's glyph is drawn once, on the first row
// that draws the marker: the top row for one on every chart, the work row for a
// break about the work counter. The shape names the kind once, and four copies
// of it would be noise. The hover tip leads every marker line with its glyph, so
// a row without glyphs still says the kind.
//
// Two honesty rules, drawn rather than written:
//
//   * the week so far is a hollow point the line never reaches. A line into a
//     half-counted week reads as a collapse every Monday.
//   * a week nothing was recording is hatched, in the same --adm-hatch the
//     streak strip uses, and never drawn as a zero. A row with nothing measured
//     in the whole window still draws its plot, hatched end to end.
//
// The charts are pictures; what they mean in words is the verdict on each tile
// above them. The markers are the one thing only the charts carry, so the ones
// drawn are also listed for a screen reader, once each.

import { AreaChart } from '../../viz/AreaChart.jsx';
import {
  WEEKLY_METRICS, bandsFromMeasurable, markerIndex, markersForColumn, weekLabel,
} from '../../../../lib/weeklySeries.js';
import { formatCount } from '../../../../lib/adminFormat.js';

// A row's key is a WEEKLY_METRICS key; the column it names is what a break's series lists.
const COLUMN_OF = new Map(WEEKLY_METRICS.map((m) => [m.key, m.col]));

/**
 * @param {string[]} weeks         UTC Mondays ('YYYY-MM-DD'), oldest first, the week so far last
 * @param {object[]} series        one row per chart: { key, name, color, values: (number|null)[], measurable: boolean[] }.
 *                                 `key` MUST be a WEEKLY_METRICS key ('signups', 'active', 'work', 'cards'): it names
 *                                 the column a definition break's `series` lists, so a row keyed anything else draws
 *                                 only the markers that are on every chart.
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
  // What each row draws, and the list of what is drawn anywhere: in order, and
  // once per day and label, since four rows can draw the same marker.
  const perRow = series.map((row) => markersForColumn(placed, COLUMN_OF.get(row?.key)));
  // The first row each marker is drawn on, which is where its glyph goes. Keyed
  // by the placed object, which every row's list shares.
  const glyphRow = new Map();
  perRow.forEach((ms, i) => ms.forEach((m) => { if (!glyphRow.has(m)) glyphRow.set(m, i); }));
  const drawn = new Set(glyphRow.keys());
  const seen = new Set();
  const listed = placed.filter((m) => {
    const id = `${m.day}\u0000${m.label}`;
    if (!drawn.has(m) || seen.has(id)) return false;
    seen.add(id);
    return true;
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
            markers={perRow[i].map((m) => ({ ...m, glyph: glyphRow.get(m) === i }))}
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

      {listed.length > 0 && (
        <ul className="sr-only">
          {listed.map((m, k) => (
            <li key={k}>{`Marker, ${m.day}, ${m.kind}: ${m.label}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
