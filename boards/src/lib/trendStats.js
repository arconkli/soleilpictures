// trendStats.js — has it gone up for weeks, or did one week go up?
//
// The Overview's tiles used to answer "how is it going?" with one seven-day
// delta. At this product's volume a single week is mostly noise: one viral
// post, one bulk import or one quiet holiday can move it more than a month of
// real trend does, and "+40%" looks the same whether it is the fifth rise in a
// row or a coin that landed heads. The question actually being asked is "is
// this going up CONSISTENTLY?", which is about a run of complete weeks, not
// about any one of them. weeklyTrend() answers it from the WeekPoint[] that
// weeklySeries.js builds: a literal per-week strip, and one sentence.
//
// Two instruments, because each is blind where the other sees:
//
//   - Mann-Kendall: do later weeks tend to be higher than earlier ones? It
//     reads only their ORDER, so a viral week counts as one high rank, not as
//     a slope. One-sided at 5% and never halved, because the read only ever
//     asks "up?" or "down?". Up to EXACT_MAX_N untied weeks the null is exact
//     (exactTailP), since short series are where the normal approximation is
//     coarsest; past that, or with ties, it is the tie-corrected normal with a
//     continuity correction.
//   - Theil-Sen, the median of every pairwise slope: how MUCH. A rank test can
//     be certain about a rise far too small to matter, and a median is what
//     one enormous week cannot drag.
//
// Then a guard for each way the sentence could overclaim:
//
//   - The noise floor. A rise is only 'solid' if it clears what the two ends of
//     the window could differ by anyway. Under Poisson, x_end - x_start has
//     variance lambda_start + lambda_end, so the floor is NOISE_K * sqrt(start +
//     end), each end the median of its half of the window. Reading both ends is
//     what treats a fall like its mirror-image rise: a floor read from the start
//     alone is higher for a fall (it starts high) than for the same rise, and so
//     asked declines for more evidence. On a flat series the two ends agree and
//     this is exactly NOISE_K * sqrt(2 * base), the single-ended floor, so the
//     calibration where nothing is happening is unchanged. MIN_BASE stops a
//     near-zero end from giving a floor that one extra sign-up clears. Cards
//     arrive in bulk imports, so their floor is robust instead: 1.4826 * MAD of
//     the week-to-week differences, which one import barely moves.
//   - The events gate. A significant rank test resting on fewer than
//     MIN_DELTA_EVENTS events is 'directional' at most, and the detail says
//     how few there were. Under MIN_ZERO_EVENTS the read is "Nothing yet", and
//     under MIN_WEEKS usable weeks it is "Too few weeks", never a direction.
//   - A short window. At four or five usable weeks the rank test has almost no
//     power: 10, 12, 11, 15 is up 50% end to end and scores p = 1/6. Finding
//     no direction there is not finding that there is none, so under
//     STEADY_WEEKS a read with no direction says "No clear direction over n
//     weeks". "Flat" would print an absence of evidence as evidence of
//     absence. The code is 'flat' either way; only the sentence changes.
//   - Shapes that are not trends are named as what they are: one week carrying
//     most of the movement is a step ("Stepped up (week of ...)"), and a rise
//     whose newest PLATEAU_N weeks have stopped is "Rose, then flat".
//   - A spike is an ISOLATED week: more than SPIKE_K * sqrt(max(median, 1))
//     above the larger of its nearest neighbours with readings. It is reported,
//     never removed. It is not judged against the median, because that flags
//     the top of every clean rise as a spike.
//   - Definition breaks. Weeks before a cut measured something else, so they
//     are excluded, and the read carries a caveat until a full window of weeks
//     has accumulated after the change; from then on the timeline marker
//     alone records it.
//   - The current week is partial, so it is never scored. It comes back as
//     thisWeek, for display only.
//   - The strip is a literal record: a step is up, down or flat on exact
//     values, and a week with no reading is a gap, never a zero. The noise
//     judgement belongs to the sentence, not to the glyphs.
//
// weekDelta() gives the tiles' single-week comparison the same honesty: inside
// the noise it says flat, and under MIN_DELTA_EVENTS it says there is too
// little to compare, where a bare percentage would have said "+200%".
//
// Pure: no React, no DOM, no clock and no randomness, so all of it runs under
// node. The one import is addDays from weeklySeries.js, which owns the UTC week
// calendar (see its header): two files doing week arithmetic is how a marker
// ends up a column off.

import { addDays } from './weeklySeries.js';

export const DEFAULT_WINDOW   = 8;     // complete calendar weeks scored
export const WEEKS_FETCHED    = 14;    // weekly rows fetched: 13 complete weeks + the week so far
export const MIN_WEEKS        = 4;     // fewer usable weeks -> 'too_few'
export const STEADY_WEEKS     = 6;     // n >= this before "steady"/"uneven"/flat-dominant wording, and "Flat"
export const EXACT_MAX_N      = 12;    // exact Mann-Kendall null up to here (untied only)
export const ALPHA_SOLID      = 0.05;  // one-sided; stated in the UI tooltip, never halved
export const ALPHA_LEAN       = 0.10;  // one-sided
export const NOISE_K          = 2;     // floor multiplier
export const MIN_BASE         = 2;     // Poisson floor never computed from a base below this
export const SPIKE_K          = 3;     // a week more than SPIKE_K*sqrt(max(median,1)) above both neighbours is a spike
export const SHIFT_SHARE      = 0.6;   // one step carrying >= 60% of the directional movement = step change
export const PLATEAU_N        = 4;     // trailing points examined for "rose, then flat"
export const MIN_DELTA_EVENTS = 10;    // weekDelta thin gate; also the 'solid' events gate
export const MIN_ZERO_EVENTS  = 3;     // window total below this -> 'zero' verdict
export const STEADY_UP_SHARE  = 0.7;   // steady: up >= 0.7*m and down <= 1
export const Z_90_ONE_SIDED   = 1.644854;

// ── The exact null ────────────────────────────────────────────────────────
/**
 * Exact P(S >= s) under the untied null, for n <= EXACT_MAX_N (null outside that).
 * S = N - 2I with N = n(n-1)/2 and I the inversion count, whose distribution is
 * the Mahonian numbers: the coefficients of prod_{i=1..n} (1 + x + ... + x^(i-1)).
 */
export function exactTailP(n, s) {
  if (!Number.isInteger(n) || n < 0 || n > EXACT_MAX_N || !Number.isFinite(s)) return null;
  let counts = [1];
  for (let i = 2; i <= n; i += 1) {
    const next = new Array(counts.length + i - 1).fill(0);
    counts.forEach((c, k) => { for (let j = 0; j < i; j += 1) next[k + j] += c; });
    counts = next;
  }
  const kMax = Math.min(Math.floor(((n * (n - 1)) / 2 - s) / 2), counts.length - 1);
  let hits = 0;
  for (let k = 0; k <= kMax; k += 1) hits += counts[k];
  let all = 1;
  for (let i = 2; i <= n; i += 1) all *= i;
  return hits / all;
}

// ── Small arithmetic ──────────────────────────────────────────────────────
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// Middle element, or the mean of the two middle ones; null for nothing.
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── The rank test and the slope ───────────────────────────────────────────
/** Standard normal CDF via erfc (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7 on erf). */
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erfc = poly * Math.exp(-x * x);
  return z >= 0 ? 1 - erfc / 2 : erfc / 2;
}

// Sizes of the groups of equal values (only groups of two or more), in value order.
function tieGroups(xs) {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].filter(([, c]) => c >= 2).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

/**
 * Mann-Kendall on the usable values, in time order (a non-number is a gap and
 * is skipped). Returns { n, S, varS, z, pUp, pDown, p, dir, method, ties }:
 *   'exact'      no ties and n <= EXACT_MAX_N: pUp = exactTailP(n, S), pDown = exactTailP(n, -S)
 *   'normal'     otherwise, tie-corrected variance, z = (S - sgn(S)) / sqrt(varS)
 *   'degenerate' varS = 0 (fewer than two values, or all equal): z = 0, p = 1, dir 'none'
 * p = min(pUp, pDown), one-sided. dir is S's sign ('none' at S = 0), which is the
 * smaller side whenever the two differ; at |S| = 1 under the normal they tie at 0.5.
 */
export function mannKendall(values) {
  const xs = (Array.isArray(values) ? values : []).filter(isNum);
  const n = xs.length;
  let S = 0;
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) S += sgn(xs[j] - xs[i]);
  const ties = tieGroups(xs);
  const tieTerm = ties.reduce((sum, t) => sum + t * (t - 1) * (2 * t + 5), 0);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  if (!(varS > 0)) {
    return { n, S, varS: 0, z: 0, pUp: 1, pDown: 1, p: 1, dir: 'none', method: 'degenerate', ties };
  }
  const z = (S - sgn(S)) / Math.sqrt(varS);
  const exact = ties.length === 0 && n <= EXACT_MAX_N;
  const pUp = exact ? exactTailP(n, S) : 1 - normalCdf(z);
  const pDown = exact ? exactTailP(n, -S) : normalCdf(z);
  const dir = S > 0 ? 'up' : S < 0 ? 'down' : 'none';
  return { n, S, varS, z, pUp, pDown, p: Math.min(pUp, pDown), dir, method: exact ? 'exact' : 'normal', ties };
}

/**
 * Theil-Sen: perWeek = the median over all pairs i < j of (x_j - x_i) / (t_j - t_i),
 * with t the calendar week index (a missing week leaves a hole in t; t defaults
 * to 0, 1, 2, ...). rise = perWeek * (t_last - t_first). Fewer than two usable
 * weeks have no slope: { perWeek: null, rise: null, pairs: 0 }.
 */
export function theilSen(values, t) {
  const xs = Array.isArray(values) ? values : [];
  const ts = Array.isArray(t) ? t : xs.map((_, i) => i);
  const pts = [];
  xs.forEach((x, i) => { if (isNum(x) && isNum(ts[i])) pts.push([ts[i], x]); });
  const slopes = [];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
  }
  if (!slopes.length) return { perWeek: null, rise: null, pairs: 0 };
  const perWeek = median(slopes);
  return { perWeek, rise: perWeek * (pts.at(-1)[0] - pts[0][0]), pairs: slopes.length };
}

// ── One week against the last ─────────────────────────────────────────────
const signed = (d) => `${d >= 0 ? '+' : ''}${d}`;
const percent = (diff, prev) => `${signed(Math.round((100 * diff) / prev))}%`;

/**
 * One week against the one before. null when either side is not a number.
 *   kind 'count' (people, cards): cur + prev < MIN_DELTA_EVENTS -> { dir: 'thin', n, text: '+2' };
 *     prev 0 -> { dir: 'up', text: 'new' }; no change -> { dir: 'flat', z: 0, text: '+0%' };
 *     |z| < Z_90_ONE_SIDED with z = (cur - prev) / sqrt(cur + prev) -> { dir: 'flat', noise: true, z, text };
 *     else { dir: 'up'|'down', z, text } with text the signed, rounded percentage.
 *   kind 'exact' (MRR, a ledger): the plain sign, no gate, no noise key; prev 0 -> 'new'.
 */
export function weekDelta(cur, prev, { kind = 'count' } = {}) {
  if (!isNum(cur) || !isNum(prev)) return null;
  const diff = cur - prev;
  if (kind === 'exact') {
    if (diff === 0) return { dir: 'flat', text: '+0%' };
    if (prev === 0) return cur > 0 ? { dir: 'up', text: 'new' } : { dir: 'down', text: signed(diff) };
    return { dir: diff > 0 ? 'up' : 'down', text: percent(diff, prev) };
  }
  const total = cur + prev;
  if (total < MIN_DELTA_EVENTS) return { dir: 'thin', n: total, text: signed(diff) };
  if (prev === 0) return { dir: 'up', text: 'new' };
  const z = diff / Math.sqrt(total);
  if (diff === 0) return { dir: 'flat', z, text: '+0%' };
  if (Math.abs(z) < Z_90_ONE_SIDED) return { dir: 'flat', noise: true, z, text: percent(diff, prev) };
  return { dir: diff > 0 ? 'up' : 'down', z, text: percent(diff, prev) };
}

// ── The weekly read ───────────────────────────────────────────────────────
const MAD_SD = 1.4826; // 1.4826 * MAD estimates a normal standard deviation

const isWeek = (w) => addDays(w, 0) !== null; // a real ISO day, by weeklySeries' own parse
const byWeek = (a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0);
const valueOf = (p) => (isNum(p?.value) ? p.value : null);
// The two sentences that can count exactly one week say "1 week"; every other label is fixed.
const weeksWord = (k) => (k === 1 ? 'week' : 'weeks');

// The cut that applies is the latest one; an entry without a real week cuts nothing.
function latestBreak(breaks) {
  let latest = null;
  for (const b of Array.isArray(breaks) ? breaks : []) {
    if (b && isWeek(b.week) && (!latest || b.week > latest.week)) latest = b;
  }
  return latest;
}

function countSteps(steps) {
  const counts = { up: 0, down: 0, flat: 0, gaps: 0, total: 0 };
  for (const st of steps) {
    if (st.dir === 1) counts.up += 1;
    else if (st.dir === -1) counts.down += 1;
    else if (st.dir === 0) counts.flat += 1;
    else counts.gaps += 1;
  }
  counts.total = counts.up + counts.down + counts.flat;
  return counts;
}

// The run at the newest end: a step of any other kind (or a gap) ends it.
function streakOf(steps) {
  const last = steps.at(-1);
  if (!last || last.dir === null) return { dir: 'none', len: 0 };
  let len = 0;
  for (let i = steps.length - 1; i >= 0 && steps[i].dir === last.dir; i -= 1) len += 1;
  return { dir: last.dir === 1 ? 'up' : last.dir === -1 ? 'down' : 'flat', len };
}

function slopeOf(usable, steps, dispersion) {
  const xs = usable.map((u) => u.value);
  const { perWeek, rise } = theilSen(xs, usable.map((u) => u.t));
  const level = median(xs);
  // The two ends of the window: the first and the last floor(n/2) readings (with an odd
  // n the middle one belongs to neither).
  const half = Math.floor(xs.length / 2);
  const baseline = half > 0 ? median(xs.slice(0, half)) : null;
  const endLevel = half > 0 ? median(xs.slice(-half)) : null;
  let floor = NOISE_K * Math.sqrt(Math.max(baseline ?? 0, MIN_BASE) + Math.max(endLevel ?? 0, MIN_BASE));
  let floorKind = 'poisson';
  if (dispersion === 'mad') {
    // A difference needs two adjacent weeks with readings, so a gap breaks one.
    const diffs = steps.filter((st) => st.dir !== null).map((st) => st.to - st.from);
    const mid = median(diffs);
    const mad = diffs.length >= 3 ? median(diffs.map((d) => Math.abs(d - mid))) : 0;
    if (mad > 0) {
      floor = NOISE_K * MAD_SD * mad;
      floorKind = 'mad';
    }
  }
  return {
    perWeek,
    pctOfLevelPerWeek: perWeek !== null && level ? (100 * perWeek) / level : null,
    rise, level, baseline, endLevel, floor, floorKind,
    clears: rise !== null && Math.abs(rise) >= floor,
  };
}

// A spike is a week more than SPIKE_K * sqrt(max(level, 1)) above the larger of
// its nearest neighbours with readings (an endpoint has one).
function spikesOf(usable, level) {
  if (level === null) return [];
  const bar = SPIKE_K * Math.sqrt(Math.max(level, 1));
  return usable
    .filter((u, i) => {
      const near = [usable[i - 1], usable[i + 1]].filter(Boolean).map((v) => v.value);
      return near.length > 0 && u.value - Math.max(...near) > bar;
    })
    .map(({ week, value }) => ({ week, value }));
}

// The verdict tree; the first match wins. Labels are shown verbatim elsewhere
// (the streak strip's accessible name is the label), so tests pin every one.
function verdictOf({ xs, sum, missing, minWeeks, mk, slope, steps, counts, spikes }) {
  const n = xs.length;
  // Nothing is scored, so nothing qualifies the read: no detail.
  const unread = (code, label) => ({ code, label, confidence: 'none', detail: null });
  if (n < minWeeks) return unread('too_few', `Too few weeks (${n} of ${minWeeks})`);
  if (sum < MIN_ZERO_EVENTS) return unread('zero', `Nothing yet (${sum} in ${n} weeks)`);

  // A rank test passed at 5% is still only 'directional' when the rise is inside
  // the noise floor or rests on under MIN_DELTA_EVENTS events. On purpose.
  const confidence = mk.p <= ALPHA_SOLID && slope.clears && sum >= MIN_DELTA_EVENTS ? 'solid'
    : mk.p <= ALPHA_LEAN ? 'directional'
      : 'none';
  const notes = [];
  if (spikes.length === 1) notes.push(`one spike week (${spikes[0].week})`);
  else if (spikes.length > 1) notes.push(`${spikes.length} spike weeks`);
  if (mk.p <= ALPHA_SOLID && sum < MIN_DELTA_EVENTS) notes.push(`${sum} events in ${n} weeks`);
  if (steps.at(-1)?.settling) notes.push('newest week still settling');
  const say = (code, label) => ({ code, label, confidence, detail: notes.length ? notes.join(' · ') : null });

  if (confidence === 'none') {
    // The newest week only gets named when its own change is outside the noise.
    const last = steps.at(-1);
    const quiet = !last || last.dir === 0 || last.dir === null
      || ['flat', 'thin'].includes(weekDelta(last.to, last.from)?.dir);
    // Under STEADY_WEEKS readings it cannot call it flat, only say it sees no direction (header).
    const short = n < STEADY_WEEKS;
    if (!quiet && last.dir === 1) {
      return say('flat', short ? `Up this week, no clear direction over ${n}` : `Up this week, flat over ${n}`);
    }
    if (!quiet && last.dir === -1) {
      return say('flat', short ? `Down this week, no clear direction over ${n}` : `Down this week, flat over ${n}`);
    }
    return say('flat', short ? `No clear direction over ${n} weeks` : `Flat over ${n} weeks`);
  }

  // Past here p <= ALPHA_LEAN, so S is not 0 and mk.dir is 'up' or 'down'.
  const up = mk.dir === 'up';
  if (counts.total >= 4) {
    // One step carrying most of the movement is a level change, not a trend.
    const size = (st) => Math.abs(st.to - st.from);
    const moves = steps.filter((st) => st.dir === (up ? 1 : -1));
    const moved = moves.reduce((total, st) => total + size(st), 0);
    const big = moves.reduce((best, st) => (size(st) > size(best) ? st : best), moves[0]);
    if (big && size(big) / moved >= SHIFT_SHARE && weekDelta(big.to, big.from)?.dir === mk.dir) {
      const day = big.week.slice(5);
      return say(up ? 'shift_up' : 'shift_down', up
        ? `Stepped up (week of ${day} carried most of the rise)`
        : `Stepped down (week of ${day} carried most of the drop)`);
    }
  }
  if (n >= STEADY_WEEKS) {
    // Rose (or fell), then stopped: the newest PLATEAU_N weeks no longer move,
    // and they sit at the top (or the bottom) of the window.
    const tail = xs.slice(-PLATEAU_N);
    const tailS = mannKendall(tail).S;
    const mid = median(tail);
    if (up && tailS <= 0 && mid >= slope.level) return say('plateau', `Rose, then flat for ${PLATEAU_N} weeks`);
    if (!up && tailS >= 0 && mid <= slope.level) return say('trough', `Fell, then flat for ${PLATEAU_N} weeks`);
  }

  const { up: u, down: d, flat: f, total: m } = counts;
  if (confidence === 'directional') {
    return up
      ? say('leaning_up', `Leaning up, ${u} of ${m} weeks`)
      : say('leaning_down', `Leaning down, ${d} of ${m} weeks`);
  }
  const [code, word, k, against] = up ? ['rising', 'Up', u, d] : ['falling', 'Down', d, u];
  // Missing counts WEEKS without a reading, not the steps that touch them.
  if (missing > 0) return say(code, `${word} ${k} of ${m} measured ${weeksWord(m)}, ${missing} missing`);
  if (n >= STEADY_WEEKS && k >= STEADY_UP_SHARE * m && against <= 1) {
    return say(code, `${word} ${k} of the last ${m} weeks, steady`);
  }
  if (n >= STEADY_WEEKS && f > k) return say(code, `${word} ${k}, flat ${f} of the last ${m} weeks`);
  if (n >= STEADY_WEEKS) return say(code, `${word} ${k} of the last ${m} weeks, uneven`);
  return say(code, `${word} ${k} of the last ${m} weeks`);
}

/** @typedef {{ week:string, value:number|null, measurable:boolean, complete:boolean, settling?:boolean }} WeekPoint */

/**
 * Scores a WeekPoint[] (weeklySeries.toWeekPoints) and returns the TrendRead:
 *   { window, steps, counts, streak, mk, slope, spikes, thisWeek, caveat, verdict }
 * Points without a real week are dropped; a point that does not say it is
 * complete, or measurable, is excluded with that reason rather than scored.
 */
export function weeklyTrend(points, {
  window = DEFAULT_WINDOW, minWeeks = MIN_WEEKS, breaks = [], dispersion = 'poisson',
} = {}) {
  const all = (Array.isArray(points) ? points : []).filter((p) => p && isWeek(p.week)).sort(byWeek);

  const cut = latestBreak(breaks);
  const excluded = [];
  const remaining = [];
  let thisWeek = null;
  for (const p of all) {
    const reason = p.complete !== true ? 'incomplete'
      : p.measurable !== true ? 'unmeasurable'
        : cut && p.week < cut.week ? 'break'
          : null;
    if (reason === 'incomplete') thisWeek = { week: p.week, value: valueOf(p) };
    if (reason) excluded.push({ week: p.week, reason });
    else remaining.push(p);
  }

  let caveat = null;
  if (cut) {
    const since = remaining.filter((p) => valueOf(p) !== null).length;
    if (since < window) caveat = `Definition changed ${cut.date ?? cut.week}; ${since} ${weeksWord(since)} since`;
  }

  // The last `window` calendar weeks ending at the newest remaining week. The walk opens at
  // `first`, the oldest of them, even when that week has no row, so a missing row and a row
  // with no reading are the same gap at the edge as anywhere else; it opens later only where
  // the scorable history itself begins later (a short series, an unmeasured prefix, a cut).
  const newest = remaining.at(-1)?.week;
  const first = newest ? addDays(newest, -7 * (window - 1)) : null;
  const start = first && remaining[0].week > first ? remaining[0].week : first;
  const at = new Map(remaining.filter((p) => start && p.week >= start).map((p) => [p.week, p]));
  const weeks = [];
  for (let w = start; w && w <= newest; w = addDays(w, 7)) weeks.push(w);
  const values = weeks.map((w) => valueOf(at.get(w)));

  const usable = [];
  values.forEach((value, t) => { if (value !== null) usable.push({ week: weeks[t], value, t }); });
  const n = usable.length;
  const sum = usable.reduce((total, u) => total + u.value, 0);

  const steps = weeks.slice(1).map((week, i) => {
    const from = values[i];
    const to = values[i + 1];
    return { week, from, to, dir: from === null || to === null ? null : sgn(to - from), settling: false };
  });
  if (steps.length && at.get(weeks.at(-1))?.settling === true) steps.at(-1).settling = true;

  const xs = usable.map((u) => u.value);
  const { S, varS, z, p, dir, method } = mannKendall(xs);
  const mk = { S, varS, z, p, dir, method };
  const slope = slopeOf(usable, steps, dispersion);
  const counts = countSteps(steps);
  const spikes = spikesOf(usable, slope.level);
  return {
    window: {
      from: weeks[0] ?? null, to: weeks.at(-1) ?? null, n, calendarWeeks: weeks.length, gaps: weeks.length - n, sum, excluded,
    },
    steps,
    counts,
    streak: streakOf(steps),
    mk,
    slope,
    spikes,
    thisWeek,
    caveat,
    verdict: verdictOf({ xs, sum, missing: weeks.length - n, minWeeks, mk, slope, steps, counts, spikes }),
  };
}
