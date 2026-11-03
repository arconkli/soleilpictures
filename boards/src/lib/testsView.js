// testsView.js — turns admin_tests_read (0810; helpers re-aimed by 0855) into
// what Analytics › Tests says: each side's rate per 100, the gap with its 95%
// range (Newcombe's hybrid score interval; like for like by Mantel-Haenszel
// where a test is read over strata; a reach against its target by the exact
// binomial range), the verdict word, and
// whether the test is really running (people put in, an even split, its events
// still arriving, nobody in both groups, nobody in a test that's off).
//
// Pure and node-testable (testsView.test.mjs): no React, no Supabase. Times are
// read and written in UTC, as everywhere else in the admin.
//
// The numbers are always shown, live. The verdict word ("<side> ahead" / "No
// clear difference" / "Too few to say") waits for the test's verdict date: before
// it the chip says "Too early" and names the date (owner's pick, 10-29).
//
// What the read returns per test (keys missing when they don't apply):
//   in:        { A, B }      people (accounts, devices, emails) on each side since the start
//   eligible:  n             who could have been put in since the start (coin tests)
//   recent:    { eligible, assigned }   the same over the last 3 days
//   last:      { A, B }      the last event carrying each side (ISO or null)
//   mismatched: n            people seen on both sides / held back yet sent
//   stamped_off: n           people given a side while the test is off
//   signals:   { <id>: { last, due } }  a test's own event: when last seen, and
//                            how many people were due it since then
//   parts:     [{ label, A, B }]        the email hold-back, per email
//   last_run:  ISO           the email sender's last decision
//   holdout_pct: n           the email hold-back: the share held back, as configured
//   shown:     n             the share ask: people shown it since the release
//   idle:      bool          the rotation: nothing sent lately
//   measures:  { <id>: { A: {n, k}, B: {n, k}, due, next } }
//              n counts only people old enough for the measure's window; due
//              counts everyone in its population; next is when the first one
//              not yet counted will be.
//   start:     ISO           when the read knows the start better than the code
//   on_from / fix_from: ISO  a start that only the read can know: the first
//                            sighting of the release that carries it (0855)
//   strata:    [{ page, phone, A: {n, k}, B: {n, k} }]   the sign-up box's
//                            like-for-like strata (page group × phone)
//   misses:    [{ reason, n }]  the share ask: why the rest weren't asked
//   signals.click: { views, clicks }   first_board_more: the ask clicked through
//   signals.reach: { views, early }    trial_early: B's offers under 13 cards,
//                            and how many offered the early trial
//   signals.leak / signals.lost_to_ask: n   counts, not { last, due }
//   weeks:     n             the email hold-back's configured length
//   error:     text          that test's read failed

import { TESTS, TEST_GROUPS, EARLIER_TESTS, SIGNUP_BOX_PAGE_GROUPS, isTestOn } from './testsCatalog.js';

export const MIN_N = 30;
const Z95 = 1.96;
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const ms = (iso) => (iso ? Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso) : NaN);

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtDay(iso) {
  const t = ms(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export function fmtClock(iso) {
  const t = ms(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(11, 16);
}
const dayOf = (iso) => new Date(ms(iso)).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((ms(dayOf(b)) - ms(dayOf(a))) / DAY);

// A time that has passed: "04:42 today", "yesterday 22:10", "Oct 27 22:10".
export function fmtSince(iso, nowIso) {
  if (!iso) return '';
  const d = daysBetween(iso, nowIso);
  if (d <= 0) return `${fmtClock(iso)} today`;
  if (d === 1) return `yesterday ${fmtClock(iso)}`;
  return `${fmtDay(iso)} ${fmtClock(iso)}`;
}
// A time to come: "today at 07:00", "tomorrow at 07:00", "Nov 1".
export function fmtUntil(iso, nowIso) {
  if (!iso) return '';
  const d = daysBetween(nowIso, iso);
  if (d <= 0) return `today at ${fmtClock(iso)}`;
  if (d === 1) return `tomorrow at ${fmtClock(iso)}`;
  return fmtDay(iso);
}
// A start: the day, and the clock too when it isn't midnight.
export function fmtStart(iso) {
  const c = fmtClock(iso);
  return c && c !== '00:00' ? `${fmtDay(iso)}, ${c}` : fmtDay(iso);
}
export const sgn = (x) => (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(1);
export const f1 = (x) => (x == null ? '—' : x.toFixed(1));

// Whether a day ('YYYY-MM-DD') has come, by the UTC calendar.
export function hasCome(dayIso, nowIso) {
  return !!dayIso && dayOf(nowIso) >= dayIso;
}

// ── The comparison ───────────────────────────────────────────────────────────
export function rateOf(side) {
  const n = num(side?.n);
  return n ? (100 * num(side?.k)) / n : null;
}

// Fewer than this many events on both sides is too few to read, however many
// people there are: a rate of 0 to 4 in a few hundred has no shape yet.
export const MIN_EVENTS = 5;

// Wilson's score interval for k of n (95%), as proportions.
export function wilson(k, n, z = Z95) {
  if (!(n > 0)) return null;
  const p = k / n, z2 = z * z;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

// Too few on a side (MIN_N), or too few events on both (MIN_EVENTS): the
// shapes the plot and the verdict read as "not yet".
function tooFew(na, nb, ka, kb) {
  if (na < MIN_N || nb < MIN_N) return { few: true, min: Math.min(na, nb) };
  if (ka < MIN_EVENTS && kb < MIN_EVENTS) return { few: true, events: true, most: Math.max(ka, kb) };
  return null;
}

// B − A in points per 100, with a 95% range by Newcombe's hybrid score method
// (Newcombe 1998, method 10): a Wilson interval on each side, combined. It
// keeps its coverage near the edges (rates near 0 or 100, small sides), where
// the Wald range is too narrow. Fewer than MIN_N on a side, or fewer than
// MIN_EVENTS events on both, is too few to read.
export function gapOf(m) {
  if (!m || !m.A || !m.B) return null;
  const na = num(m.A.n), nb = num(m.B.n), ka = num(m.A.k), kb = num(m.B.k);
  const few = tooFew(na, nb, ka, kb);
  if (few) return few;
  const pa = ka / na, pb = kb / nb;
  const wa = wilson(ka, na), wb = wilson(kb, nb);
  const d = pb - pa;
  const lo = d - Math.sqrt((pb - wb.lo) ** 2 + (wa.hi - pa) ** 2);
  const hi = d + Math.sqrt((wb.hi - pb) ** 2 + (pa - wa.lo) ** 2);
  return { d: d * 100, lo: lo * 100, hi: hi * 100 };
}

// Like for like: B − A over strata, the Mantel-Haenszel risk difference with
// Sato's (1989) variance, in points with a 95% range. Each stratum weighs
// nA·nB/N; a stratum missing either side carries no weight and is skipped.
// The too-few rules read the totals.
export function mhGapOf(strata) {
  if (!Array.isArray(strata) || !strata.length) return null;
  let na = 0, nb = 0, ka = 0, kb = 0, top = 0, w = 0, P = 0, Q = 0;
  for (const s of strata) {
    const n0 = num(s?.A?.n), b = num(s?.A?.k), n1 = num(s?.B?.n), a = num(s?.B?.k);
    na += n0; nb += n1; ka += b; kb += a;
    if (!(n0 > 0 && n1 > 0)) continue;
    const N = n0 + n1;
    top += (a * n0 - b * n1) / N;
    w += (n1 * n0) / N;
    P += (n1 * n1 * b - n0 * n0 * a + (n1 * n0 * (n0 - n1)) / 2) / (N * N);
    Q += (a * (n0 - b) + b * (n1 - a)) / (2 * N);
  }
  const few = tooFew(na, nb, ka, kb);
  if (few) return few;
  if (!(w > 0)) return null;
  const d = top / w;
  const se = Math.sqrt(Math.max(0, (d * P + Q) / (w * w)));
  return { d: d * 100, lo: (d - Z95 * se) * 100, hi: (d + Z95 * se) * 100 };
}

// The read returns each device's first page path as seen; the written rule
// weighs SIGNUP_BOX_PAGE_GROUPS x phone/desktop. Pool the entries into those
// groups (a page already named as a group keeps it; an unlisted path is the
// full stage), summing each side's counts per group and device.
export function signupStrataOf(strata) {
  if (!Array.isArray(strata)) return strata;
  const full = SIGNUP_BOX_PAGE_GROUPS.find((g) => g.paths == null)?.id;
  const groupOf = (page) => (SIGNUP_BOX_PAGE_GROUPS.some((g) => g.id === page)
    ? page
    : SIGNUP_BOX_PAGE_GROUPS.find((g) => g.paths && g.paths.includes(page))?.id ?? full);
  const pooled = new Map();
  for (const s of strata) {
    const page = groupOf(s?.page), phone = s?.phone === true;
    const key = `${page}:${phone}`;
    const to = pooled.get(key) || { page, phone, A: { n: 0, k: 0 }, B: { n: 0, k: 0 } };
    for (const side of ['A', 'B']) { to[side].n += num(s?.[side]?.n); to[side].k += num(s?.[side]?.k); }
    pooled.set(key, to);
  }
  return [...pooled.values()];
}

// The strata summed, for the counts beside a like-for-like line.
export function pooledOf(strata) {
  if (!Array.isArray(strata) || !strata.length) return null;
  const add = (side) => strata.reduce((acc, s) => ({ n: acc.n + num(s?.[side]?.n), k: acc.k + num(s?.[side]?.k) }), { n: 0, k: 0 });
  return { A: add('A'), B: add('B') };
}

// Exact (Clopper-Pearson) 95% range for k of n, as proportions: the p at which
// k or more (for the low end), or k or fewer (for the high end), would happen
// one time in 40.
function binomTail(k, n, p, upper) {
  // upper: P(X ≥ k); else P(X ≤ k).
  if (p <= 0) return upper ? (k <= 0 ? 1 : 0) : 1;
  if (p >= 1) return upper ? 1 : (k >= n ? 1 : 0);
  const lc = lnGamma(n + 1), lp = Math.log(p), lq = Math.log(1 - p);
  let sum = 0;
  const [from, to] = upper ? [k, n] : [0, k];
  for (let i = from; i <= to; i++) sum += Math.exp(lc - lnGamma(i + 1) - lnGamma(n - i + 1) + i * lp + (n - i) * lq);
  return Math.min(1, sum);
}
export function exactRange(k, n, alpha = 0.05) {
  if (!(n > 0)) return null;
  // f rises with p; the p where it reaches `at`, by halving.
  const solve = (f, at) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < at) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // Low end: P(X ≥ k) = alpha/2. High end: P(X ≤ k) = alpha/2.
  const low = k <= 0 ? 0 : solve((p) => binomTail(k, n, p, true), alpha / 2);
  const high = k >= n ? 1 : solve((p) => 1 - binomTail(k, n, p, false), 1 - alpha / 2);
  return { lo: low, hi: high };
}

// A reach read on B alone against the target it was registered with (a rate
// per 100): reaching it once the exact range's low end clears the target, short
// of it once its high end is below, else too early to say.
export function reachOf(side, target) {
  const n = num(side?.n), k = num(side?.k);
  if (!n || !Number.isFinite(target)) return null;
  const r = exactRange(k, n);
  const lo = r.lo * 100, hi = r.hi * 100;
  const state = lo > target ? 'reaching' : hi < target ? 'short' : 'open';
  return { rate: (100 * k) / n, lo, hi, target, state };
}

// The plot's axis: ±40 points unless a range reaches further, then the next 10.
export function spanOf(gaps) {
  let s = 40;
  for (const g of gaps) {
    if (g && !g.few && Number.isFinite(g.lo)) s = Math.max(s, Math.ceil(Math.max(Math.abs(g.lo), Math.abs(g.hi)) / 10) * 10);
  }
  return s;
}

// The measure a test is read on: its first "decides" or "aims at".
export function headlineMeasure(t) {
  return t.measures.find((m) => m.role === 'decides' || m.role === 'aims at') || t.measures[0] || null;
}

const toneFor = (t, side) => (side === (t.goodSide || 'B') ? 'good' : 'bad');

// The colour of a measure's range: only once the verdict date has come, and only
// for what the test is read on. A reach against its target colours by the reach.
export function measureTone(t, m, g, nowIso, reach = null) {
  if (!t.verdictIso || !hasCome(t.verdictIso, nowIso)) return '';
  if (m.role !== 'decides' && m.role !== 'aims at') return '';
  if (reach) return reach.state === 'reaching' ? 'good' : reach.state === 'short' ? 'bad' : '';
  if (!g || g.few) return '';
  if (g.lo > 0) return toneFor(t, 'B');
  if (g.hi < 0) return toneFor(t, 'A');
  return '';
}

// A start the read knows (startKey: the release that carries the test) comes
// first; then the read's live start; then the code's.
const startOf = (t, r) => (t.startKey ? r?.[t.startKey] : null) || r?.start || t.startIso || null;
// Not started: before a registry test's start instant, or, for a test that
// starts with a release, while the read hasn't seen that release yet.
const notYetStarted = (t, r, nowIso) => {
  if (t.startKey) return !!r && !r.error && !r[t.startKey];
  return !!(t.registry && t.startIso && ms(nowIso) < ms(t.startIso));
};
const startsWords = (t) => (t.startKey ? 'Starts with its release' : `Starts ${fmtStart(t.startIso)}`);
const noOne = (t) => (t.unit === 'device' ? 'No visitor in it yet' : 'No one in it yet');

function pendingText(t, r, x, nowIso, m) {
  if (m?.target != null && t.fixKey && r && !r.error && !r[t.fixKey]) return 'Starts with the first fixed build';
  if (t.kind === 'beforeafter' && !num(r?.in?.B)) return t.noneText || noOne(t);
  const inN = num(r?.in?.A) + num(r?.in?.B);
  if (inN === 0 && (!x || !num(x.due))) return t.noneText || noOne(t);
  // A measure the read doesn't carry yet (a read older than the catalog).
  if (!x && r && !r.error && r.measures && m) return 'Not in the read yet';
  if (!x || !num(x.due)) return t.noneText || 'None due yet';
  if (x.next) return `First ones finish ${fmtUntil(x.next, nowIso)}`;
  return 'Waiting for both sides';
}

// One line per measure: both sides' rates and counts, the gap, or why not yet.
export function measureRows(t, r, nowIso) {
  const rows = t.measures.map((m) => {
    const strata = m.from === 'strata' ? signupStrataOf(r?.strata) : null;
    const pooled = m.from === 'strata' ? pooledOf(strata) : null;
    const x = m.from === 'strata' ? (pooled ? { ...pooled, due: pooled.A.n + pooled.B.n } : undefined) : r?.measures?.[m.id];
    const na = num(x?.A?.n), nb = num(x?.B?.n);
    // A reach against its target reads B alone, so it shows once B has anyone.
    const waiting = m.target != null ? nb === 0 : (na === 0 || nb === 0);
    if (!x || waiting) {
      const inN = num(r?.in?.A) + num(r?.in?.B);
      if (m.from === 'strata' && r && !r.error && !Array.isArray(r.strata) && inN > 0) return { m, pending: 'Not in the read yet' };
      return { m, pending: pendingText(t, r, x, nowIso, m) };
    }
    const g = m.from === 'strata' ? mhGapOf(strata) : gapOf(x);
    const reach = m.target != null ? reachOf(x.B, m.target) : null;
    return {
      m,
      A: { n: na, k: num(x.A?.k), rate: rateOf(x.A) },
      B: { n: nb, k: num(x.B.k), rate: rateOf(x.B) },
      gap: g,
      reach,
      tone: measureTone(t, m, g, nowIso, reach),
    };
  });
  return { rows, span: spanOf(rows.map((x) => x.gap)) };
}

export function verdictOf(t, r, nowIso) {
  if (t.kind === 'rotation' && r?.idle) return { tone: 'wait', text: 'Waits for the next send' };
  if (notYetStarted(t, r, nowIso)) return { tone: 'wait', text: startsWords(t) };
  if (!isTestOn(t, nowIso)) return { tone: 'off', text: 'Off' };
  if (!t.verdictIso) return { tone: 'wait', text: 'No read date set' };
  if (!hasCome(t.verdictIso, nowIso)) return { tone: 'wait', text: `Too early · verdict ${fmtDay(t.verdictIso)}` };
  const m = headlineMeasure(t);
  // A reach against its registered target: B alone, by its exact range.
  if (m && m.target != null) {
    const reach = reachOf(r?.measures?.[m.id]?.B, m.target);
    if (!reach) return { tone: 'wait', text: 'Too few to say' };
    if (reach.state === 'reaching') return { tone: 'good', text: 'Reaching it' };
    if (reach.state === 'short') return { tone: 'bad', text: 'Short of it' };
    return { tone: 'wait', text: 'Too early to say' };
  }
  const g = !m ? null : m.from === 'strata' ? mhGapOf(signupStrataOf(r?.strata)) : gapOf(r?.measures?.[m.id]);
  if (g?.few && g.events) return { tone: 'wait', text: 'Too few events' };
  if (!g || g.few) return { tone: 'wait', text: 'Too few to say' };
  if (g.lo > 0) return { tone: toneFor(t, 'B'), text: `${t.bName} ahead, ${sgn(g.d)} pts` };
  if (g.hi < 0) return { tone: toneFor(t, 'A'), text: `${t.aName} ahead, ${sgn(-g.d)} pts` };
  return { tone: 'even', text: 'No clear difference' };
}

// ── Is it running properly? ──────────────────────────────────────────────────
// How surprising a split this uneven is if the coin is fair: the exact two-sided
// binomial p, summing every outcome no likelier than the one seen.
function lnGamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
export function splitP(a, n, pA = 0.5) {
  if (!(n > 0)) return 1;
  const lc = lnGamma(n + 1);
  const lp = (k) => lc - lnGamma(k + 1) - lnGamma(n - k + 1) + k * Math.log(pA) + (n - k) * Math.log(1 - pA);
  const seen = lp(a);
  let p = 0;
  for (let k = 0; k <= n; k++) {
    const l = lp(k);
    if (l <= seen + 1e-7) p += Math.exp(l);
  }
  return Math.min(1, p);
}
// Below this a split is uneven enough to look at.
export const SPLIT_LOOK_P = 0.01;
// An arm or a test's own event is quiet when it hasn't been seen for this long
// while people were due it.
const ARM_QUIET_DAYS = 3;
// The email sender runs every hour; two days without a decision is a stopped sender.
const SENDER_QUIET_DAYS = 2;

const nounOf = (t, n = 2) => {
  if (t.unit === 'device') return n === 1 ? 'device' : 'devices';
  if (t.unit === 'email') return n === 1 ? 'person' : 'people';
  return n === 1 ? 'account' : 'accounts';
};
const sideLabel = (t, side) => (t.kind === 'holdout' ? (side === 'A' ? t.aName : t.bName).toLowerCase() : side);

function putInCheck(t, r, nowIso) {
  const name = 'Being put in';
  const start = startOf(t, r);
  const inN = num(r.in?.A) + num(r.in?.B);
  if (t.kind === 'holdout') {
    if (!inN) return { id: 'put_in', name, state: 'wait', text: `Since ${fmtDay(start)}, nobody has been due either email yet.` };
    const weeks = num(r.weeks) ? ` Held back for ${num(r.weeks)} weeks.` : '';
    return { id: 'put_in', name, state: 'ok', text: `${inN} ${nounOf(t, inN)} due an email since ${fmtDay(start)}: ${num(r.in.A)} sent, ${num(r.in.B)} held back.${weeks}` };
  }
  // A test that takes in accounts old and new from its release: no count of
  // who could have been put in, only who was.
  if (t.startKey) {
    if (!inN) return { id: 'put_in', name, state: 'wait', text: `Live since ${fmtSince(start, nowIso)}. Nobody seen with a side yet.` };
    return { id: 'put_in', name, state: 'ok', text: `${inN} ${nounOf(t, inN)} seen with a side since ${fmtDay(start)}.` };
  }
  const elig = Math.max(num(r.eligible), inN);
  if (!elig) {
    const what = t.unit === 'device' ? 'No signed-out visit to a search page since' : 'No account made since';
    return { id: 'put_in', name, state: 'wait', text: `Started ${fmtSince(start, nowIso)}. ${what}; the first one shows here.` };
  }
  const re = r.recent || {};
  if (num(re.eligible) >= 5 && num(re.assigned) === 0) {
    return { id: 'put_in', name, state: 'look', text: `None of the ${num(re.eligible)} new ${nounOf(t)} in the last 3 days got a side.` };
  }
  if (elig >= 20 && inN / elig < 0.5) {
    return { id: 'put_in', name, state: 'look', text: `Only ${inN} of ${elig} new ${nounOf(t)} have a side.` };
  }
  const rest = elig - inN;
  const tail = rest > 0 ? ` The other ${rest} ${t.neitherNote || 'have none'}.` : '';
  return { id: 'put_in', name, state: 'ok', text: `${inN} of ${elig} new ${nounOf(t)} have a side.${tail}` };
}

function splitCheck(t, r) {
  const name = 'Split';
  const a = num(r.in?.A), b = num(r.in?.B), n = a + b;
  if (!n) return { id: 'split', name, state: 'wait', text: `Read from the first ${nounOf(t)} on each side.` };
  // The hold-back's share held back is its config's holdout_pct; a coin is 50/50.
  const pB = r.holdout_pct != null && Number.isFinite(Number(r.holdout_pct)) ? Number(r.holdout_pct) / 100 : 0.5;
  const pA = Math.min(Math.max(1 - pB, 0.01), 0.99);
  const p = splitP(a, n, pA);
  const counts = `${a} ${sideLabel(t, 'A')} · ${b} ${sideLabel(t, 'B')}.`;
  if (p < SPLIT_LOOK_P) return { id: 'split', name, state: 'look', text: `${counts} Chance alone gives a split this uneven less than once in 100.` };
  if (n < MIN_N) return { id: 'split', name, state: 'ok', text: `${counts} Fine at this size.` };
  const k = Math.round(p * 10);
  const odds = k >= 10 ? 'Even.' : k === 0 ? 'Chance alone gives a split this uneven less than once in 10.' : `Chance alone gives a split this uneven ${k} times in 10.`;
  return { id: 'split', name, state: 'ok', text: `${counts} ${odds}` };
}

function signalCheck(t, r, nowIso) {
  for (const s of t.signals || []) {
    const x = r.signals?.[s.id];
    if (!x) continue;
    const due = num(x.due);
    const quiet = !x.last || ms(nowIso) - ms(x.last) > s.quietDays * DAY;
    if (quiet && due >= (s.minDue || 3)) {
      const since = x.last ? `in ${Math.floor((ms(nowIso) - ms(x.last)) / DAY)} days` : 'yet';
      return { state: 'look', text: `${s.label} hasn’t been seen ${since}, though ${due} ${s.due}.` };
    }
  }
  return null;
}

// A signal's click-through (first_board_more: the ask's views, and how many
// were clicked): shown, never a look.
function clickChecks(t, r) {
  const out = [];
  for (const s of t.signals || []) {
    if (!s.click) continue;
    const c = r.signals?.[s.click];
    if (!c || typeof c !== 'object') continue;
    const views = num(c.views), clicks = num(c.clicks);
    const what = s.label.replace(/^The /, 'the ');
    out.push(views
      ? { id: 'click', name: 'Clicked through', state: 'ok', text: `${clicks} of ${views} views of ${what} were clicked through.` }
      : { id: 'click', name: 'Clicked through', state: 'wait', text: `No view of ${what} yet.` });
  }
  return out;
}

// trial_early's own health: B's offers under 13 cards should carry the early
// trial (reach), and A should never be offered it (leak).
function reachCheck(t, r) {
  const id = 'reach', name = 'Reaching B';
  const x = r.signals?.[t.reachKey];
  if (!x || typeof x !== 'object') return { id, name, state: 'wait', text: 'Not in the read yet.' };
  const views = num(x.views), early = num(x.early);
  if (!views) return { id, name, state: 'wait', text: 'No offer shown to B under 13 cards yet.' };
  if (!early && views >= 3) return { id, name, state: 'look', text: `None of the ${views} offers shown to B under 13 cards offered the early trial.` };
  return { id, name, state: 'ok', text: `${early} of the ${views} offers shown to B under 13 cards offered the early trial.` };
}
function leakCheck(t, r) {
  const id = 'match', name = 'Groups match';
  const raw = r.signals?.[t.leakKey];
  if (raw == null) return { id, name, state: 'wait', text: 'Not in the read yet.' };
  const n = num(raw);
  return n > 0
    ? { id, name, state: 'look', text: `${n} ${n === 1 ? 'offer' : 'offers'} to A carried the early trial: there must be none.` }
    : { id, name, state: 'ok', text: 'No one in A was offered the early trial.' };
}

function eventsCheck(t, r, nowIso) {
  const id = 'events', name = 'Events arriving';
  const sig = signalCheck(t, r, nowIso);
  if (sig) return { id, name, ...sig };
  if (t.kind === 'holdout') {
    if (!r.last_run) return { id, name, state: 'look', text: 'The sender hasn’t decided on any email yet.' };
    const quiet = ms(nowIso) - ms(r.last_run) > SENDER_QUIET_DAYS * DAY;
    return { id, name, state: quiet ? 'look' : 'ok', text: `The sender last decided on an email ${fmtSince(r.last_run, nowIso)}${quiet ? ', and runs every hour' : ' (it runs every hour)'}.` };
  }
  const inA = num(r.in?.A), inB = num(r.in?.B);
  if (!inA && !inB) return { id, name, state: 'wait', text: 'None yet: they start with the first one.' };
  const la = r.last?.A || null, lb = r.last?.B || null;
  const fresh = (x) => x && ms(nowIso) - ms(x) <= DAY;
  const stale = (x) => !x || ms(nowIso) - ms(x) > ARM_QUIET_DAYS * DAY;
  for (const [side, mine, other, n] of [['A', la, lb, inA], ['B', lb, la, inB]]) {
    if (n >= 5 && stale(mine) && fresh(other)) {
      return { id, name, state: 'look', text: `${side} events stopped${mine ? `: the last was ${fmtSince(mine, nowIso)}` : ''}, while ${side === 'A' ? 'B' : 'A'}’s still arrive.` };
    }
  }
  const part = (side, x) => (x ? `last ${side} event ${fmtSince(x, nowIso)}` : `no ${side} event yet`);
  const text = `${part('A', la)}, ${part('B', lb)}.`;
  return { id, name, state: 'ok', text: text[0].toUpperCase() + text.slice(1) };
}

function matchCheck(t, r) {
  const id = 'match', name = 'Groups match';
  const inN = num(r.in?.A) + num(r.in?.B);
  if (!inN) return { id, name, state: 'wait', text: 'Nothing to check yet.' };
  const m = num(r.mismatched);
  if (t.kind === 'holdout') {
    return m > 0
      ? { id, name, state: 'look', text: `${m} held-back ${m === 1 ? 'person was' : 'people were'} sent the email.` }
      : { id, name, state: 'ok', text: 'No held-back person was sent the email.' };
  }
  if (t.unit === 'device') {
    return m > 0
      ? { id, name, state: 'look', text: `${m} ${nounOf(t, m)} seen on both sides.` }
      : { id, name, state: 'ok', text: 'No device seen on both sides.' };
  }
  // Arms on accounts aren't on their events: what B gets leaves a trace, and
  // that trace from someone in A is the leak.
  const inA = num(r.in?.A);
  return {
    id, name, state: m > 0 ? 'look' : 'ok',
    text: `${m} of the ${inA} in A ${t.leak || 'got what B gets'}.`,
  };
}

function beforeAfterChecks(t, r, nowIso) {
  const crossed = num(r.in?.B), shown = num(r.shown);
  const start = startOf(t, r);
  const reach = !crossed
    ? { id: 'reach', name: 'Reaching people', state: 'wait', text: `Live since ${fmtSince(start, nowIso)}. No one has reached 10 cards since.` }
    : crossed >= 10 && shown === 0
      ? { id: 'reach', name: 'Reaching people', state: 'look', text: `None of the ${crossed} people who reached 10 cards saw it.` }
      : { id: 'reach', name: 'Reaching people', state: 'ok', text: `${shown} of ${crossed} people who reached 10 cards saw it.` };
  const sig = signalCheck(t, r, nowIso);
  const last = r.signals?.ask_at_10?.last;
  const events = sig
    ? { id: 'events', name: 'Events arriving', ...sig }
    : last
      ? { id: 'events', name: 'Events arriving', state: 'ok', text: `Last ask at 10: ${fmtSince(last, nowIso)}.` }
      : { id: 'events', name: 'Events arriving', state: 'wait', text: 'No ask at 10 yet.' };
  const out = [reach, events];
  if (t.fixKey) {
    const fix = r[t.fixKey];
    out.push(fix
      ? { id: 'fix', name: 'The fix', state: 'ok', text: `First fixed build seen ${fmtSince(fix, nowIso)}; the after side counts from it.` }
      : { id: 'fix', name: 'The fix', state: 'wait', text: 'No fixed build seen yet: the after side starts with the first one.' });
  }
  if (t.lostKey && r.signals?.[t.lostKey] != null) {
    const n = num(r.signals[t.lostKey]);
    out.push({ id: 'lost', name: 'Gave way to it', state: 'ok', text: `${n} upgrade ${n === 1 ? 'offer' : 'offers'} gave the slot to the ask.` });
  }
  return out;
}

export function checksOf(t, r, nowIso) {
  if (!r || r.error) return [{ id: 'read', name: 'Its numbers', state: 'look', text: 'Its read didn’t come back, so nothing here can be checked.' }];
  if (t.kind === 'rotation') {
    return r.idle
      ? [{ id: 'idle', name: 'Waiting', state: 'wait', text: 'Nothing to check until the next update email goes out.' }]
      : [{ id: 'sending', name: 'Sending', state: 'ok', text: r.last_run ? `Last sent ${fmtSince(r.last_run, nowIso)}.` : 'Sending now.' }];
  }
  if (notYetStarted(t, r, nowIso)) {
    const text = t.startKey ? 'Starts with the release that carries it: no build of it seen yet.' : `Starts ${fmtStart(t.startIso)}.`;
    return [{ id: 'start', name: 'Not started', state: 'wait', text }];
  }
  if (!isTestOn(t, nowIso)) {
    const n = num(r.stamped_off);
    return [n > 0
      ? { id: 'off', name: 'Switched off', state: 'look', text: `${n} ${nounOf(t, n)} got a side while it’s off.` }
      : { id: 'off', name: 'Switched off', state: 'ok', text: 'Nobody has a side, as it should be while it’s off.' }];
  }
  if (t.kind === 'beforeafter') return beforeAfterChecks(t, r, nowIso);
  return [
    putInCheck(t, r, nowIso),
    splitCheck(t, r),
    t.reachKey ? reachCheck(t, r) : eventsCheck(t, r, nowIso),
    ...clickChecks(t, r),
    t.leakKey ? leakCheck(t, r) : matchCheck(t, r),
  ];
}

export function healthOf(t, r, nowIso, checks = checksOf(t, r, nowIso)) {
  if (checks.some((c) => c.state === 'look')) return { tone: 'look', text: 'Needs a look' };
  if (t.kind === 'rotation' && r?.idle) return { tone: 'wait', text: 'Nothing sent lately' };
  if (notYetStarted(t, r, nowIso)) return { tone: 'wait', text: 'Not started' };
  if (!isTestOn(t, nowIso)) return { tone: 'off', text: 'Off, as planned' };
  if (checks.some((c) => c.state === 'wait')) return { tone: 'wait', text: 'Waiting for people' };
  return { tone: 'ok', text: 'Running properly' };
}

// ── The rest of a row ────────────────────────────────────────────────────────
// Under the split bar: who the counts are, or who has no side.
export function splitNote(t, r) {
  if (t.kind === 'holdout') {
    const parts = Array.isArray(r?.parts) ? r.parts : [];
    return parts.map((p) => (num(p.A) + num(p.B) === 0
      ? `${p.label}: none due yet`
      : `${p.label} ${num(p.A)} sent, ${num(p.B)} held back`)).join(' · ');
  }
  if (t.inNote) return t.inNote;
  const elig = num(r?.eligible), inN = num(r?.in?.A) + num(r?.in?.B);
  const rest = Math.max(0, elig - inN);
  if (rest > 0 && t.neitherNote) return `${rest} more ${t.neitherNote}, so they’re on neither side`;
  return `For ${nounOf(t)} made from ${fmtStart(startOf(t, r))}`;
}

// The share ask's misses, most first, in words: why the rest weren't asked.
export function missesOf(t, r) {
  if (!t.missReasons || !Array.isArray(r?.misses)) return null;
  return r.misses
    .map((x) => ({ reason: x?.reason, n: num(x?.n), text: t.missReasons[x?.reason] || String(x?.reason || 'Unknown') }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
}

// The like-for-like strata as lines: page group and device, each side's rate.
// Page groups in SIGNUP_BOX_PAGE_GROUPS' order, phones after desktops.
export function strataOf(t, r) {
  if (!t.measures.some((m) => m.from === 'strata') || !Array.isArray(r?.strata)) return null;
  const order = SIGNUP_BOX_PAGE_GROUPS.map((g) => g.id);
  const rank = (s) => (order.indexOf(s?.page) < 0 ? order.length : order.indexOf(s?.page)) * 2 + (s?.phone ? 1 : 0);
  const side = (x) => ({ n: num(x?.n), k: num(x?.k), rate: rateOf(x) });
  return [...signupStrataOf(r.strata)].sort((a, b) => rank(a) - rank(b)).map((s) => ({
    key: `${s?.page}:${s?.phone ? 'phone' : 'desk'}`,
    label: `${SIGNUP_BOX_PAGE_GROUPS.find((g) => g.id === s?.page)?.label || String(s?.page ?? 'Other')} · ${s?.phone ? 'phone' : 'desktop'}`,
    A: side(s?.A),
    B: side(s?.B),
  }));
}

// The line across the top of an open row: the start, each read, and today.
export function timelineOf(t, r, nowIso) {
  const start = startOf(t, r);
  if (!isTestOn(t, nowIso) || !start || !t.reads.length) return null;
  const t0 = ms(start), t1 = ms(t.reads[t.reads.length - 1].iso);
  if (!(t1 > t0)) return null;
  const at = (iso) => Math.max(0, Math.min(100, ((ms(iso) - t0) / (t1 - t0)) * 100));
  const now = at(nowIso);
  return {
    start: { label: fmtDay(start) },
    marks: t.reads.map((x) => ({ at: at(x.iso), label: fmtDay(x.iso), what: x.what, done: hasCome(x.iso, nowIso), end: at(x.iso) > 85 })),
    now: { at: now, label: `today · ${fmtDay(nowIso)}`, flip: now > 75 },
  };
}

// Everything a row says, worked out once.
export function testModel(t, r, nowIso) {
  const checks = checksOf(t, r, nowIso);
  const on = isTestOn(t, nowIso);
  const { rows, span } = measureRows(t, r, nowIso);
  const head = headlineMeasure(t);
  return {
    t,
    on,
    off: !on && !(t.kind === 'rotation') ? (t.offNote || (notYetStarted(t, r, nowIso) ? `${startsWords(t)}.` : 'Switched off.')) : null,
    idle: t.kind === 'rotation' && !!r?.idle,
    inA: num(r?.in?.A),
    inB: num(r?.in?.B),
    countUnit: t.kind === 'beforeafter' ? 'people' : `${t.unit}s`,
    verdict: verdictOf(t, r, nowIso),
    checks,
    health: healthOf(t, r, nowIso, checks),
    rows,
    span,
    headline: head ? rows.find((x) => x.m.id === head.id) : null,
    note: splitNote(t, r),
    timeline: timelineOf(t, r, nowIso),
    misses: missesOf(t, r),
    strata: strataOf(t, r),
  };
}

// The page: each section with its tests, and the counts for the status strip.
export function testsPage(read, nowIso = read?.now || new Date().toISOString()) {
  const per = read?.tests || {};
  const models = TESTS.map((t) => testModel(t, per[t.key] || null, nowIso));
  return {
    now: nowIso,
    // A section with no test in it isn't drawn.
    groups: TEST_GROUPS.filter((g) => g.id !== 'earlier')
      .map((g) => ({ ...g, tests: models.filter((m) => m.t.group === g.id) }))
      .filter((g) => g.tests.length > 0),
    earlier: { ...TEST_GROUPS.find((g) => g.id === 'earlier'), tests: EARLIER_TESTS },
    running: models.filter((m) => m.t.group === 'running' && m.on).length,
    looks: models.filter((m) => m.health.tone === 'look').length,
  };
}
