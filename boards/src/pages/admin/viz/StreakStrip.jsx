// StreakStrip — one glyph per week, and the sentence they add up to.
//
// The strip is a literal record, not a verdict: each glyph says how a complete
// week compared with the one before it, on exact values (see the last bullet of
// the header in lib/trendStats.js). Whether that run is a trend or a coin that
// kept landing heads is the sentence's job, so the sentence is the strip's
// accessible name, taken from the same TrendRead, and the two cannot drift.
//
// Five slot states. Three are drawn:
//
//   up / down / flat   ▲ ▼ ·   Direction is carried by shape as well as colour;
//                              good and bad are indistinguishable to a
//                              red/green-blind reader (see viz/palette.js).
//
// and two are hatched and EMPTY, which is the point:
//
//   gap          a week with no reading. A flat dot here would be a measured
//                zero, and it was not measured.
//   unmeasured   nothing was being recorded yet, or the series is too short to
//                read (verdict 'too_few'). Never a direction.
//
// `settling` is an outline rather than a colour: the newest weeks of some
// series are still being written, so that step is real but may still move.
//
// The glyphs are text nodes, never `content:` — generated text enters the
// accessible name. They are aria-hidden because the strip as a whole is an
// image named by the verdict.

import { streakSlots } from '../../../lib/weeklySeries.js';
import { DEFAULT_WINDOW } from '../../../lib/trendStats.js';

const GLYPH = { up: '▲', down: '▼', flat: '·', gap: '', unmeasured: '' };

/**
 * `trend` is the TrendRead from weeklyTrend(); null renders nothing. `slots`
 * defaults to the comparisons a full window yields (n weeks make n - 1 steps).
 */
export function StreakStrip({ trend, slots = DEFAULT_WINDOW - 1 }) {
  if (!trend) return null;
  return (
    <span className="adm-streak" role="img" aria-label={trend.verdict?.label}>
      {streakSlots(trend, slots).map(({ state, settling, title }, i) => (
        <span
          // Positional: a fixed-length run, newest last, with no identity of
          // its own for a slot to keep from one poll to the next.
          key={i}
          className={`adm-streak-g is-${state}${settling ? ' is-settling' : ''}`}
          aria-hidden="true"
          title={title || undefined}
        >
          {GLYPH[state]}
        </span>
      ))}
    </span>
  );
}
