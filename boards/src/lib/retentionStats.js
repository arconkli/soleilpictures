// retentionStats.js — how sure are we, and when will we know?
//
// Every retention panel on this dashboard prints a percentage. None of them
// print how much of that percentage is noise, and at this product's volume the
// answer is frequently "most of it". A step measured on a couple of dozen
// people and a step measured on a couple of hundred render identically, so a
// reader has no way to tell a finding from a coin flip — and a summer of
// monthly retention work has been read as flat partly for that reason.
//
// Two questions, both arithmetic, neither currently answered anywhere:
//
//   1. Given k of n came back, what range is the true rate plausibly in?
//      → wilson(). NOT the normal approximation: p ± 1.96·sqrt(p(1-p)/n)
//        produces intervals running below 0% and above 100% on exactly the
//        small, lopsided cells this dashboard is full of, and it is visibly
//        wrong when k is 0 or n. Wilson is well behaved at both ends and costs
//        the same to compute.
//
//   2. How long until a change of the size we care about would be visible?
//      → readableWeeks(). This is the number that reframes the whole roadmap:
//        when the honest answer is "a third of a year", the correct response is
//        to stop running underpowered comparisons and go find a leading
//        indicator instead. Better to print that than to keep squinting at
//        differences that cannot be there yet.
//
// Pure and dependency-free, like upsellSlot.js / shareAsk.js / depthDock.js, so
// the arithmetic is unit-testable under node with no React and no DOM.

// z for a 95% two-sided interval, and the two constants a power calculation
// needs. Spelled out rather than pulled from a stats package: this is the whole
// of the distribution theory used here, and a dependency for three numbers
// would be its own liability.
export const Z_95 = 1.959964;   // alpha = 0.05, two-sided
export const Z_80 = 0.8416212;  // power = 0.80

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Wilson score interval for a binomial proportion.
 *
 * Returns { p, lo, hi, n } as fractions in [0, 1]. n <= 0 yields a null
 * estimate with the full [0, 1] range, which is the honest rendering of "we
 * have not measured this" and keeps callers from having to special-case a
 * divide by zero on an empty cohort cell.
 */
export function wilson(successes, n, z = Z_95) {
  const k = Number(successes) || 0;
  const total = Number(n) || 0;
  if (!(total > 0)) return { p: null, lo: 0, hi: 1, n: 0 };

  const p = clamp01(k / total);
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));

  return { p, lo: clamp01(centre - half), hi: clamp01(centre + half), n: total };
}

/** Width of the 95% interval, in percentage points. The "how firm is this" number. */
export function intervalWidthPP(successes, n, z = Z_95) {
  const w = wilson(successes, n, z);
  return w.p == null ? null : (w.hi - w.lo) * 100;
}

/**
 * Users per arm needed to detect an absolute lift, for a two-proportion test.
 *
 * n = (z_a + z_b)^2 * (p1(1-p1) + p2(1-p2)) / (p2 - p1)^2
 *
 * Absolute (percentage-point) lift rather than relative, because that is how
 * product decisions here are actually phrased — "is this worth ten points" —
 * and because a relative lift off a low baseline hides how big the ask is.
 */
export function sampleSizePerArm(baseline, liftPP, { z = Z_95, zPower = Z_80 } = {}) {
  const p1 = Number(baseline);
  const d = Number(liftPP) / 100;
  if (!(p1 >= 0 && p1 <= 1) || !(d > 0)) return null;
  const p2 = p1 + d;
  if (p2 > 1) return null;
  const num = (z + zPower) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil(num / (d * d));
}

/**
 * The inverse: given a fixed number per arm, the smallest lift that would be
 * detectable. Solved by bisection rather than algebraically — p2 appears inside
 * the variance term, so there is no clean closed form, and twenty iterations of
 * bisection is exact to well past the precision anyone reads off a chart.
 */
export function mdePP(baseline, nPerArm, opts = {}) {
  const p1 = Number(baseline);
  const n = Number(nPerArm);
  if (!(p1 >= 0 && p1 <= 1) || !(n > 0)) return null;

  let lo = 0;
  let hi = (1 - p1) * 100;
  if (!(hi > 0)) return null;
  // An arm can be too small to detect even the largest possible lift.
  if ((sampleSizePerArm(p1, hi, opts) ?? Infinity) > n) return null;

  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const need = sampleSizePerArm(p1, mid, opts);
    if (need == null || need > n) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Weeks of collection before a lift of this size becomes readable.
 *
 * weeklyN is the total weekly intake, which SPLITS across the two arms — the
 * mistake this helper exists to prevent is dividing the required per-arm sample
 * by the whole weekly flow and getting an answer half the truth.
 */
export function readableWeeks(baseline, liftPP, weeklyN, opts = {}) {
  const perArm = sampleSizePerArm(baseline, liftPP, opts);
  const rate = Number(weeklyN);
  if (perArm == null || !(rate > 0)) return null;
  return Math.ceil((perArm * 2) / rate);
}

/**
 * The same answer as a date, for printing next to a panel.
 * `from` is accepted rather than read off the clock so this stays pure.
 */
export function readableOn(baseline, liftPP, weeklyN, from, opts = {}) {
  const weeks = readableWeeks(baseline, liftPP, weeklyN, opts);
  if (weeks == null) return null;
  const start = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(start.getTime())) return null;
  const out = new Date(start.getTime());
  out.setUTCDate(out.getUTCDate() + weeks * 7);
  return out;
}

/**
 * Is a difference between two cells worth reporting at all?
 *
 * Deliberately conservative: overlapping 95% intervals means NOT separated.
 * That test is stricter than a two-proportion z-test — non-overlapping
 * intervals imply significance, but the converse does not hold — and being
 * stricter is the correct bias for a dashboard whose findings get shipped.
 * Three premises here have already been read as real off small unstratified
 * cells; none of them would have cleared this bar.
 */
export function separated(aSucc, aN, bSucc, bN, z = Z_95) {
  const a = wilson(aSucc, aN, z);
  const b = wilson(bSucc, bN, z);
  if (a.p == null || b.p == null) return false;
  return a.hi < b.lo || b.hi < a.lo;
}

/**
 * Does an effect hold its sign across every band it was measured in?
 *
 * This is the confound guard, and it is the most important function in the
 * file. Read without stratifying, this product's data has repeatedly produced
 * confident and false headlines — including one that says shipping errors
 * IMPROVES retention, because depth drives both the errors and the returning.
 * Splitting by depth and demanding a consistent sign is what catches it.
 *
 * cells: [{ band, withSucc, withN, withoutSucc, withoutN }]
 * Returns { verdict, bands, positive, negative, usable } where verdict is
 *   'unmeasured'  — nothing with enough data to say anything
 *   'inconsistent'— the sign flips across bands; report NO effect size
 *   'directional' — consistent sign, but no band separates on its own
 *   'supported'   — consistent sign AND at least one band separates
 *
 * `minDeltaPP` is a dead zone around zero, and it is not a fudge factor. Without
 * it, a band differing by a fraction of a point counts as a direction, and one
 * essentially FLAT band is enough to condemn a signal that is otherwise
 * consistent — which is the same over-reading of small differences this whole
 * module exists to prevent, just pointed the other way. A gap under the
 * threshold is recorded as neither, exactly like an exact tie.
 */
export function consistency(cells, { minCell = 5, minDeltaPP = 2, z = Z_95 } = {}) {
  const usable = (Array.isArray(cells) ? cells : []).filter(
    (c) => Number(c?.withN) >= minCell && Number(c?.withoutN) >= minCell,
  );
  if (!usable.length) return { verdict: 'unmeasured', bands: 0, positive: 0, negative: 0, usable };

  let positive = 0;
  let negative = 0;
  let anySeparated = false;
  const dead = Math.abs(Number(minDeltaPP) || 0) / 100;

  for (const c of usable) {
    const withP = c.withSucc / c.withN;
    const withoutP = c.withoutSucc / c.withoutN;
    const d = withP - withoutP;
    if (d > dead) positive += 1;
    else if (d < -dead) negative += 1;
    if (separated(c.withSucc, c.withN, c.withoutSucc, c.withoutN, z)) anySeparated = true;
  }

  // Ties and near-ties count as neither, so a flat band neither supports nor
  // refutes — it just fails to be evidence.
  if (positive > 0 && negative > 0) {
    return { verdict: 'inconsistent', bands: usable.length, positive, negative, usable };
  }
  // Every usable band was inside the dead zone: consistent only in the sense
  // that nothing happened. That is an absence of effect, not evidence of one.
  if (positive === 0 && negative === 0) {
    return { verdict: 'unmeasured', bands: usable.length, positive, negative, usable };
  }
  return {
    verdict: anySeparated ? 'supported' : 'directional',
    bands: usable.length, positive, negative, usable,
  };
}
