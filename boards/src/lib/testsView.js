// testsView.js — turns admin_tests_read (0810) into what Analytics › Tests says:
// each side's rate per 100, the gap with its 95% range, the verdict word, and
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
//   error:     text          that test's read failed

import { TESTS, TEST_GROUPS, EARLIER_TESTS, isTestOn } from './testsCatalog.js';

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

// B − A in points per 100, with a 95% (Wald) range. Fewer than MIN_N on a side
// is too few to read.
export function gapOf(m) {
  if (!m || !m.A || !m.B) return null;
  const na = num(m.A.n), nb = num(m.B.n);
  if (na < MIN_N || nb < MIN_N) return { few: true, min: Math.min(na, nb) };
  const pa = num(m.A.k) / na, pb = num(m.B.k) / nb;
  const d = (pb - pa) * 100;
  const se = Math.sqrt((pa * (1 - pa)) / na + (pb * (1 - pb)) / nb) * 100;
  return { d, lo: d - Z95 * se, hi: d + Z95 * se };
}

// The plot's axis: ±40 points unless a range reaches further, then the next 10.
export function spanOf(gaps) {
  let s = 40;
  for (const g of gaps) {
    if (g && !g.few) s = Math.max(s, Math.ceil(Math.max(Math.abs(g.lo), Math.abs(g.hi)) / 10) * 10);
  }
  return s;
}

// The measure a test is read on: its first "decides" or "aims at".
export function headlineMeasure(t) {
  return t.measures.find((m) => m.role === 'decides' || m.role === 'aims at') || t.measures[0] || null;
}

const toneFor = (t, side) => (side === (t.goodSide || 'B') ? 'good' : 'bad');

// The colour of a measure's range: only once the verdict date has come, and only
// for what the test is read on.
export function measureTone(t, m, g, nowIso) {
  if (!g || g.few || !t.verdictIso || !hasCome(t.verdictIso, nowIso)) return '';
  if (m.role !== 'decides' && m.role !== 'aims at') return '';
  if (g.lo > 0) return toneFor(t, 'B');
  if (g.hi < 0) return toneFor(t, 'A');
  return '';
}

const startOf = (t, r) => r?.start || t.startIso || null;
const notYetStarted = (t, nowIso) => t.registry && t.startIso && ms(nowIso) < ms(t.startIso);
const noOne = (t) => (t.unit === 'device' ? 'No visitor in it yet' : 'No one in it yet');

function pendingText(t, r, x, nowIso) {
  if (t.kind === 'beforeafter' && !num(r?.in?.B)) return t.noneText || noOne(t);
  const inN = num(r?.in?.A) + num(r?.in?.B);
  if (!x || !num(x.due)) return inN === 0 ? (t.noneText || noOne(t)) : (t.noneText || 'None due yet');
  if (x.next) return `First ones finish ${fmtUntil(x.next, nowIso)}`;
  return 'Waiting for both sides';
}

// One line per measure: both sides' rates and counts, the gap, or why not yet.
export function measureRows(t, r, nowIso) {
  const rows = t.measures.map((m) => {
    const x = r?.measures?.[m.id];
    const na = num(x?.A?.n), nb = num(x?.B?.n);
    if (!x || na === 0 || nb === 0) return { m, pending: pendingText(t, r, x, nowIso) };
    const g = gapOf(x);
    return {
      m,
      A: { n: na, k: num(x.A.k), rate: rateOf(x.A) },
      B: { n: nb, k: num(x.B.k), rate: rateOf(x.B) },
      gap: g,
      tone: measureTone(t, m, g, nowIso),
    };
  });
  return { rows, span: spanOf(rows.map((x) => x.gap)) };
}

export function verdictOf(t, r, nowIso) {
  if (t.kind === 'rotation' && r?.idle) return { tone: 'wait', text: 'Waits for the next send' };
  if (notYetStarted(t, nowIso)) return { tone: 'wait', text: `Starts ${fmtStart(t.startIso)}` };
  if (!isTestOn(t, nowIso)) return { tone: 'off', text: 'Off' };
  if (!t.verdictIso) return { tone: 'wait', text: 'No read date set' };
  if (!hasCome(t.verdictIso, nowIso)) return { tone: 'wait', text: `Too early · verdict ${fmtDay(t.verdictIso)}` };
  const m = headlineMeasure(t);
  const g = m && gapOf(r?.measures?.[m.id]);
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
    return { id: 'put_in', name, state: 'ok', text: `${inN} ${nounOf(t, inN)} due an email since ${fmtDay(start)}: ${num(r.in.A)} sent, ${num(r.in.B)} held back.` };
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
  return [reach, events];
}

export function checksOf(t, r, nowIso) {
  if (!r || r.error) return [{ id: 'read', name: 'Its numbers', state: 'look', text: 'Its read didn’t come back, so nothing here can be checked.' }];
  if (t.kind === 'rotation') {
    return r.idle
      ? [{ id: 'idle', name: 'Waiting', state: 'wait', text: 'Nothing to check until the next update email goes out.' }]
      : [{ id: 'sending', name: 'Sending', state: 'ok', text: r.last_run ? `Last sent ${fmtSince(r.last_run, nowIso)}.` : 'Sending now.' }];
  }
  if (notYetStarted(t, nowIso)) return [{ id: 'start', name: 'Not started', state: 'wait', text: `Starts ${fmtStart(t.startIso)}.` }];
  if (!isTestOn(t, nowIso)) {
    const n = num(r.stamped_off);
    return [n > 0
      ? { id: 'off', name: 'Switched off', state: 'look', text: `${n} ${nounOf(t, n)} got a side while it’s off.` }
      : { id: 'off', name: 'Switched off', state: 'ok', text: 'Nobody has a side, as it should be while it’s off.' }];
  }
  if (t.kind === 'beforeafter') return beforeAfterChecks(t, r, nowIso);
  return [putInCheck(t, r, nowIso), splitCheck(t, r), eventsCheck(t, r, nowIso), matchCheck(t, r)];
}

export function healthOf(t, r, nowIso, checks = checksOf(t, r, nowIso)) {
  if (checks.some((c) => c.state === 'look')) return { tone: 'look', text: 'Needs a look' };
  if (t.kind === 'rotation' && r?.idle) return { tone: 'wait', text: 'Nothing sent lately' };
  if (notYetStarted(t, nowIso)) return { tone: 'wait', text: 'Not started' };
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
    off: !on && !(t.kind === 'rotation') ? (t.offNote || (notYetStarted(t, nowIso) ? `Starts ${fmtStart(t.startIso)}.` : 'Switched off.')) : null,
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
  };
}

// The page: each section with its tests, and the counts for the status strip.
export function testsPage(read, nowIso = read?.now || new Date().toISOString()) {
  const per = read?.tests || {};
  const models = TESTS.map((t) => testModel(t, per[t.key] || null, nowIso));
  return {
    now: nowIso,
    groups: TEST_GROUPS.filter((g) => g.id !== 'earlier').map((g) => ({ ...g, tests: models.filter((m) => m.t.group === g.id) })),
    earlier: { ...TEST_GROUPS.find((g) => g.id === 'earlier'), tests: EARLIER_TESTS },
    running: models.filter((m) => m.t.group === 'running' && m.on).length,
    looks: models.filter((m) => m.health.tone === 'look').length,
  };
}
