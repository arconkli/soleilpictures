// ReturnRate — D1 / D7 / D30, as the headline above the cohort matrix.
//
// Two things changed here, both corrections rather than restyling:
//
//   1. IT SHOWS "RETURNED WITHIN", NOT JUST "RETURNED ON". admin_return_rate
//      has always returned returned_within / within_pct alongside the on-day
//      figures, and this panel rendered only the on-day ones. "Came back at
//      some point in the first seven days" is the number anyone actually means
//      by D7 retention; "was active on exactly the seventh day" is a much
//      harsher measure that reads as catastrophic churn. Both are here now,
//      with the cumulative one leading because it is the honest headline.
//
//   2. THE CAPTION SAID "ACTIVE = OPENED THE APP THAT DAY". That stopped being
//      true when the view started passing p_require_work — this counts days
//      containing real work, which is a stricter and smaller population. A
//      caption that describes the old query is worse than no caption.
//
// It also stops hand-rolling three bordered boxes with inline styles. Those
// were the last card borders left on the dashboard, and they were drawn in
// tokens that do not exist inside a plot well.

import { formatCount, formatPct, MIN_RATE_SHOW } from '../../../../lib/adminFormat.js';
import { Metric, MetricGrid } from '../../viz/Metric.jsx';
import { VAR } from '../../viz/palette.js';

const OFFSETS = [1, 7, 30];

export function ReturnRate({ rows = [] }) {
  const byOff = new Map(rows.map((r) => [Number(r.day_offset), r]));

  return (
    <MetricGrid>
      {OFFSETS.map((d) => {
        const r = byOff.get(d);
        const elig = Number(r?.eligible) || 0;
        const within = Number(r?.returned_within) || 0;
        const on = Number(r?.returned_on) || 0;
        // A rate off a handful of matured accounts is not a rate. Blank beats a
        // confident-looking number built on n=2.
        const trustworthy = elig >= MIN_RATE_SHOW;

        return (
          <Metric
            key={d}
            label={`D${d} return`}
            value={trustworthy ? formatPct(elig ? within / elig : 0) : null}
            sub={trustworthy
              ? `${formatCount(within)} of ${formatCount(elig)} came back within ${d} day${d === 1 ? '' : 's'}`
              : `too few accounts are ${d} days old yet (n=${formatCount(elig)})`}
            flagN={trustworthy && elig < 20 ? elig : null}
            total={trustworthy
              ? { value: formatPct(elig ? on / elig : 0), label: `on day ${d} exactly` }
              : null}
            ratio={trustworthy
              ? { pct: elig ? within / elig : 0,
                  title: `${formatCount(within)} of ${formatCount(elig)} returned within ${d} days` }
              : null}
            sparkColor={VAR.cat[0]}
            muted={!trustworthy}
            title="Counts days containing real work, not days the app was merely open — the view asks admin_return_rate for p_require_work."
          />
        );
      })}
    </MetricGrid>
  );
}
