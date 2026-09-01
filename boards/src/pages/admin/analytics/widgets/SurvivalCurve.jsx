// SurvivalCurve — the chance of making the NEXT visit, given you made this one.
//
// Every other retention panel on this dashboard is indexed by CALENDAR: days
// since signup, weeks since signup, days out of 28. Indexed that way this
// product looks like it leaks steadily, and a steady leak invites steady,
// diffuse work — a bit of onboarding, a bit of email, a bit of activation.
//
// Indexed by VISIT it is not a leak at all. The first step is far worse than
// every step after it, and the later steps climb. That is a door that does not
// open, not a bucket with holes, and it says to put everything into the first
// return and nothing into the rest.
//
// The whole reason this component exists is that the finding above was made in
// an ad-hoc query and could not be re-read from the product. A dashboard that
// cannot express its own most important result will keep re-deriving it by
// hand, or — much worse — quietly stop believing it.
//
// The intervals are drawn, not implied. The deep steps rest on very few people
// and would otherwise render exactly like the first one, which is the specific
// way this dashboard has misled before.

import { formatCount } from '../../../../lib/adminFormat.js';
import { wilson, mdePP, readableWeeks } from '../../../../lib/retentionStats.js';
import { VAR } from '../../viz/palette.js';
import { ChartPlaceholder } from '../../SmallN.jsx';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

// Below this the step is drawn but explicitly marked as not carrying weight.
// Matches the dashboard's locked directional floor (see safeRate).
const TRUST_N = 20;

const H = 190;
const PAD_T = 14;
const PAD_B = 34;
const PLOT = H - PAD_T - PAD_B;

/**
 * One step of the curve: a point estimate with its 95% Wilson interval.
 *
 * Drawn as an interval first and a point second, deliberately. A bar chart of
 * these numbers would give a step measured on a handful of people the same
 * visual authority as one measured on hundreds, and at this volume that
 * difference is most of the story.
 */
function Step({ row, x, w, hi }) {
  const reached = num(row.reached);
  const ci = wilson(num(row.continued), reached);
  if (ci.p == null) return null;

  const y = (v) => PAD_T + PLOT - v * PLOT;
  const cx = x + w / 2;
  const thin = reached < TRUST_N;
  // The first step is the finding. It is coloured as a loss because that is
  // what it is; the rest are neutral so the contrast carries the point.
  const colour = hi ? VAR.bad : (thin ? VAR.inkSoft : VAR.cat[0]);

  return (
    <g>
      <line
        x1={cx} x2={cx} y1={y(ci.hi)} y2={y(ci.lo)}
        stroke={colour} strokeWidth="1.5" opacity={thin ? 0.5 : 0.8}
      />
      <line x1={cx - 4} x2={cx + 4} y1={y(ci.hi)} y2={y(ci.hi)} stroke={colour} strokeWidth="1.5" opacity={thin ? 0.5 : 0.8} />
      <line x1={cx - 4} x2={cx + 4} y1={y(ci.lo)} y2={y(ci.lo)} stroke={colour} strokeWidth="1.5" opacity={thin ? 0.5 : 0.8} />
      <circle cx={cx} cy={y(ci.p)} r={hi ? 5 : 4} fill={colour} />
      {thin && (
        <circle cx={cx} cy={y(ci.p)} r={hi ? 5 : 4} fill="none" stroke={VAR.grid} strokeWidth="1" />
      )}
      {/* Above the upper CAP, not above the point. Sitting it over the point
          puts it straight through the whisker whenever the interval is tight,
          which is exactly the case on the steps with the most data. */}
      <text x={cx} y={y(ci.hi) - 7} textAnchor="middle" className="adm-surv-val" fill={colour}>
        {(ci.p * 100).toFixed(0)}%
      </text>
      <text x={cx} y={H - 18} textAnchor="middle" className="adm-surv-step">
        {num(row.visit)}→{num(row.visit) + 1}
      </text>
      <text x={cx} y={H - 6} textAnchor="middle" className="adm-surv-n">
        n={formatCount(reached)}
      </text>
    </g>
  );
}

export function SurvivalCurve({ rows = [], weeklySignups }) {
  // Steps whose denominator is too small to draw honestly are dropped rather
  // than plotted as a confident 100% — the tail of this curve reaches n=2.
  const steps = (rows || [])
    .filter((r) => num(r.reached) >= 5)
    .sort((a, b) => num(a.visit) - num(b.visit));

  if (steps.length < 2) {
    return <ChartPlaceholder title="Not enough visits measured yet" sub="Needs at least two steps above the suppression floor." />;
  }

  const first = steps[0];
  const firstCi = wilson(num(first.continued), num(first.reached));
  const rest = steps.slice(1).filter((r) => num(r.reached) >= 5);
  const restReached = rest.reduce((a, r) => a + num(r.reached), 0);
  const restCont = rest.reduce((a, r) => a + num(r.continued), 0);
  const restCi = wilson(restCont, restReached);

  const W = 100 * steps.length;
  const w = W / steps.length;

  // What it would take to move the step that matters. This is the number that
  // has been missing from every retention comparison made here: without it a
  // difference of a few points reads as a result, when at this volume it is
  // not yet distinguishable from nothing.
  const weekly = num(weeklySignups);
  const mde = weekly > 0 ? mdePP(firstCi.p, num(first.reached)) : null;
  const weeks10 = weekly > 0 ? readableWeeks(firstCi.p, 10, weekly) : null;

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label="Chance of making the next visit, by visit number" className="adm-surv">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={0} x2={W} y1={PAD_T + PLOT - g * PLOT} y2={PAD_T + PLOT - g * PLOT}
            stroke={VAR.grid} strokeWidth="1" />
        ))}
        {steps.map((r, i) => (
          <Step key={num(r.visit)} row={r} x={i * w} w={w} hi={i === 0} />
        ))}
      </svg>

      <div className="adm-surv-read">
        {restCi.p != null && firstCi.p != null && (
          <p>
            The first step is <strong>{(firstCi.p * 100).toFixed(0)}%</strong>
            {' '}(95% CI {(firstCi.lo * 100).toFixed(0)}–{(firstCi.hi * 100).toFixed(0)}).
            {' '}Every later step pooled is <strong>{(restCi.p * 100).toFixed(0)}%</strong>.
            {' '}People who come back a second time mostly keep coming back — the loss is one step, not a slope.
          </p>
        )}
        {mde != null && weeks10 != null && (
          <p className="adm-surv-power">
            At the current intake this step can only resolve a change of about
            {' '}<strong>{mde.toFixed(0)} points</strong>; a 10-point move needs roughly
            {' '}<strong>{weeks10} weeks</strong> of collection to separate from noise.
            Anything smaller is not measurable here yet, however it is reported.
          </p>
        )}
      </div>
    </>
  );
}

/**
 * How long until the second visit — among the people who make one.
 *
 * The companion to step 1, and the number that judges anything timed. Return
 * here is overwhelmingly immediate, so a nudge scheduled a week out is aimed at
 * a window that has already shut for most of its audience. That has been true
 * across several passes and kept being rediscovered in prose.
 */
export function ReturnGap({ rows = [] }) {
  const list = (rows || []).slice().sort((a, b) => num(a.lo) - num(b.lo));
  const total = list.reduce((a, r) => a + num(r.n), 0);
  if (!total) return <ChartPlaceholder title="No second visits measured yet" />;

  const max = Math.max(...list.map((r) => num(r.n)), 1);

  return (
    <div className="adm-gap">
      {list.map((r, i) => {
        const pct = num(r.pct) * 100;
        return (
          <div className="adm-gap-row" key={r.bucket}>
            <span className="adm-gap-label">{r.bucket}</span>
            {/* The deck's own bar, not a second one. Same track, same fill
                geometry, same light-theme handling as every other bar here. */}
            <span className="adm-bar-track">
              <span
                className="adm-bar-fill"
                style={{ width: `${(num(r.n) / max) * 100}%`, background: VAR.cat[0] }}
              />
            </span>
            <span className="adm-gap-val">{pct.toFixed(0)}%</span>
            {/* On the first row the cumulative share is the row's own share by
                definition, and printing the same number twice reads as a fault
                rather than as a running total. */}
            <span className="adm-gap-cum">
              {i === 0 ? '' : `${(num(r.cum_pct) * 100).toFixed(0)}% by here`}
            </span>
          </div>
        );
      })}
      <div className="admin-panel-note">
        Among people who returned at all — this is when they came back, not whether.
        Read against step 1 of the survival curve, which is the whether.
      </div>
    </div>
  );
}
