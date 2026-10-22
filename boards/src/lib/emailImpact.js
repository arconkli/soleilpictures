// emailImpact — what Emails › Impact says, worked out from what its read returns.
//
// The view is the owner's pick of 2026-10-20 ("Over time"). Every sentence and
// every coordinate on it comes out of here, pure, so each one is tested against
// numbers instead of eyeballed:
//
//   impactCalendar   the weeks in view, this week's days so far, the x of a day
//   monthsBand       the band at the top: opened per delivered, month by month
//   openRows         01 · every email, then each email that sent on both sides
//                    of the split day, biggest fall first, and the sentence that
//                    counts how many halved; opensFoot, the line under them
//   openGeometry     one row of opens: dots, line, the two averages
//   sendGroups       02 · sending now, and paused or stopped, a sentence each
//   sendGeometry     one row of sends: sent, made something, held back
//   welcomeSeries    03 · welcomes per 100 new accounts, by sign-up week
//   changesList      What changed, each entry's figure worked out from the read
//   rowMarks         the dated lines, and the glyphs on them, a row draws
//   lostRows, armRows, mailboxRows    04 · Detail
//
// The read is admin_email_impact (0494): UTC weeks, Monday to Sunday, this
// week so far last, and nobody from the team, a banned account or a service
// account. What changed is lib/emailChanges.js, words and days only: every
// figure the page shows comes from the read, at render time.

import { fmt, md, barPath } from './moneyView.js';
import { niceCeiling } from './growthChart.js';
import { addDays, mondayOf } from './weeklySeries.js';
import { EMAIL_CHANGES } from './emailChanges.js';

const DAY = 86_400_000;
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const word = (n) => (n >= 0 && n < WORD.length ? WORD[n] : fmt(n));
const dayOf = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);
const rateOf = (opened, delivered) => (num(delivered) > 0 ? num(opened) / num(delivered) : null);

/** '42%', or '—' when there is nothing to divide by. */
export const pctText = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);

/** Whole days from one UTC day to another, or null. */
export function daysBetween(a, b) {
  const ta = Date.parse(`${dayOf(a)}T00:00:00Z`);
  const tb = Date.parse(`${dayOf(b)}T00:00:00Z`);
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.round((tb - ta) / DAY) : null;
}

/** 'a', 'a and b', 'a, b and c'. */
function joinAnd(parts) {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ── The emails ──────────────────────────────────────────────────────────────

/**
 * Every lifecycle email the cron sends, in the order the page lists them, with
 * its name on the page, its name inside a sentence, and which of
 * send-transactional-email's addresses it goes from (`from`: 'lifecycle' is
 * FROM_LIFECYCLE, 'hello' is FROM_HELLO). Kept in step with lifecycle-email-cron
 * and fromAddress by adminEmailImpactMigration.test.mjs.
 */
export const EMAILS = Object.freeze([
  { type: 'welcome_board',       name: 'Welcome',                 inline: 'the welcome',             from: 'lifecycle' },
  { type: 'activate_nudge_1',    name: 'First nudge',             inline: 'the first nudge',         from: 'lifecycle' },
  { type: 'activate_nudge_2',    name: 'Second nudge',            inline: 'the second nudge',        from: 'lifecycle' },
  { type: 'nudge_dormant_early', name: 'Early nudge',             inline: 'the early nudge',         from: 'lifecycle' },
  { type: 'board_waiting',       name: 'Your cluster is waiting', inline: 'Your cluster is waiting', from: 'lifecycle' },
  { type: 'product_update',      name: 'Product update',          inline: 'the product update',      from: 'hello' },
  { type: 'whats_new',           name: 'What’s new',              inline: 'What’s new',              from: 'lifecycle' },
  { type: 'reengage_1',          name: 'Come back',               inline: 'Come back',               from: 'lifecycle' },
]);

const byType = new Map(EMAILS.map((e, i) => [e.type, { ...e, i }]));

/** 'First nudge'. An email this list has never heard of shows its own name. */
export function emailName(type) {
  return byType.get(type)?.name ?? cap(String(type || '').replace(/_/g, ' '));
}

function inlineName(type) {
  return byType.get(type)?.inline ?? emailName(type);
}

const orderOf = (type) => byType.get(type)?.i ?? EMAILS.length;
const byOrder = (a, b) => orderOf(a.type) - orderOf(b.type) || String(a.type).localeCompare(String(b.type));

// ── The calendar ────────────────────────────────────────────────────────────

/** One row's box in SVG units. The plot runs from X0 to X1; the y labels sit left of X0. */
export const BOX = Object.freeze({ W: 900, X0: 34, X1: 900 });
export const OPEN_H = 72;
export const OPEN_Y = Object.freeze({ top: 8, mid: 35, base: 62 });
export const SEND_H = 72;
export const SEND_Y = Object.freeze({ top: 10, base: 60 });
export const WELCOME_H = 96;
export const WELCOME_Y = Object.freeze({ top: 10, mid: 47, base: 84 });

/** A box x as a percentage of the box's width, for the words laid over it. */
export const pctX = (x) => r1((x / BOX.W) * 100);

/**
 * The weeks in view and where things fall on them. `daysSoFar` is how many of
 * this week's seven days have begun (the read's `today` is a UTC day).
 */
export function impactCalendar(raw) {
  const weeks = Array.isArray(raw?.weeks) ? raw.weeks.map((w) => dayOf(String(w))).filter(Boolean) : [];
  const n = weeks.length;
  const slot = n ? (BOX.X1 - BOX.X0) / n : 0;
  const today = dayOf(raw?.today);
  const into = n && today ? daysBetween(weeks[n - 1], today) : null;
  return {
    weeks,
    n,
    slot,
    bw: Math.min(26, slot * 0.6),
    today,
    daysSoFar: into == null ? null : Math.max(1, Math.min(7, into + 1)),
    left: (i) => BOX.X0 + i * slot,
    center: (i) => BOX.X0 + (i + 0.5) * slot,
    /** The x of a UTC day, or null when it is not a day or not in view. */
    xOfDay(day) {
      const d = n ? daysBetween(weeks[0], day) : null;
      if (d == null || d < 0 || d > n * 7) return null;
      return BOX.X0 + (d / 7) * slot;
    },
  };
}

/** 'week of Jun 22', or 'this week so far' for the last. */
export function weekName(cal, i) {
  return i === cal.n - 1 ? 'this week so far' : `week of ${md(cal.weeks[i])}`;
}

/** The x axis: every fourth week from the first, and 'this week' at the end. */
export function xLabels(cal) {
  const out = [];
  for (let i = 0; i < cal.n - 1; i += 4) {
    if (cal.n - 1 - i > 2) out.push({ key: cal.weeks[i], lx: pctX(cal.center(i)), label: md(cal.weeks[i]) });
  }
  if (cal.n) out.push({ key: 'now', lx: 100, label: 'this week', end: true });
  return out;
}

/** Faint rules between the labelled weeks, so the eye can carry a week down the rows. */
export function weekRules(cal) {
  const out = [];
  for (let i = 2; i < cal.n; i += 4) out.push(r1(cal.left(i)));
  return out;
}

/** Where a hover card goes: centred on its week, or held inside the box at either end. */
export function tipSide(lx) {
  return lx < 14 ? 'start' : lx > 86 ? 'end' : 'mid';
}

// ── The band at the top ─────────────────────────────────────────────────────

function monthName(day) {
  const m = Number(String(day).slice(5, 7));
  return m >= 1 && m <= 12 ? MONTH[m - 1] : '';
}

/**
 * Opened per delivered for this calendar month and the two before it, every
 * lifecycle email together. `head` is this month's figure; `sentence` is the
 * line the opens well opens with.
 */
export function monthsBand(raw) {
  const ms = Array.isArray(raw?.months) ? raw.months.filter((m) => dayOf(m?.month)) : [];
  const rows = ms.map((m, i) => {
    const delivered = num(m.delivered);
    const opened = num(m.opened);
    const rate = rateOf(opened, delivered);
    const cur = i === ms.length - 1;
    const name = `${monthName(m.month)}${cur ? ' so far' : ''}`;
    return {
      key: dayOf(m.month),
      month: monthName(m.month),
      name,
      cur,
      rate,
      pct: pctText(rate),
      w: rate == null ? 0 : r1(Math.min(rate, 1) * 100),
      n: delivered ? `${fmt(opened)} of ${fmt(delivered)} delivered` : 'nothing delivered',
      delivered,
      aria: rate == null ? `${name}: nothing delivered` : `${name}: ${pctText(rate)} opened, ${fmt(opened)} of ${fmt(delivered)} delivered`,
    };
  });
  const last = rows[rows.length - 1] || null;
  const head = last ? {
    k: `Opened in ${last.month} so far`,
    value: last.pct,
    of: last.rate == null ? 'nothing delivered yet' : `of ${fmt(last.delivered)} delivered`,
  } : null;
  const parts = rows.map((r, i) => {
    if (r.rate == null) return `nothing delivered in ${r.month}`;
    if (r.cur) return `${r.pct} so far in ${r.month}`;
    return i === 0 ? `${r.pct} opened in ${r.month}` : `${r.pct} in ${r.month}`;
  });
  return { rows, head, sentence: parts.length ? `About ${parts.join(', ')}.` : '' };
}

// ── 01 · Opens ──────────────────────────────────────────────────────────────

/** A week with fewer delivered than this is drawn hollow: too few to read alone. */
export const THIN_WEEK = 10;
/** An email is compared across the split day only with this many delivered on each side. */
export const MIN_EACH_SIDE = 10;

const arr = (v, n) => Array.from({ length: n }, (_, i) => num(Array.isArray(v) ? v[i] : 0));
const side = (s) => (s && typeof s === 'object' ? { delivered: num(s.delivered), opened: num(s.opened) } : null);

/**
 * The rows of 01. `all` is every lifecycle email together; `each` is every email
 * with at least MIN_EACH_SIDE delivered on both sides of the split day, the
 * biggest fall first. An email halved when its opens after the split are at most
 * half of what they were before.
 */
export function openRows(raw) {
  const cal = impactCalendar(raw);
  const n = cal.n;
  const types = Array.isArray(raw?.types) ? raw.types : [];
  const split = dayOf(raw?.split);
  const weekly = (t) => {
    const d = arr(t.delivered, n); const o = arr(t.opened, n); const s = arr(t.sent, n);
    return d.map((v, i) => ({ delivered: v, opened: o[i], sent: s[i] }));
  };
  const all = Array.from({ length: n }, () => ({ delivered: 0, opened: 0, sent: 0 }));
  for (const t of types) {
    weekly(t).forEach((w, i) => { all[i].delivered += w.delivered; all[i].opened += w.opened; all[i].sent += w.sent; });
  }
  const pool = (key) => types.reduce((a, t) => {
    const s = side(t[key]);
    return s ? { delivered: a.delivered + s.delivered, opened: a.opened + s.opened } : a;
  }, { delivered: 0, opened: 0 });
  const withRates = (row) => {
    const b = row.before ? rateOf(row.before.opened, row.before.delivered) : null;
    const a = row.after ? rateOf(row.after.opened, row.after.delivered) : null;
    return { ...row, beforeRate: b, afterRate: a, halved: b != null && a != null && b > 0 && a <= b / 2 };
  };

  const every = withRates({
    key: 'all', type: null, name: 'Every email', weeks: all,
    before: split ? pool('before') : null, after: split ? pool('after') : null,
  });
  const each = split ? types
    .filter((t) => num(t?.before?.delivered) >= MIN_EACH_SIDE && num(t?.after?.delivered) >= MIN_EACH_SIDE)
    .map((t) => withRates({
      key: t.type, type: t.type, name: emailName(t.type), weeks: weekly(t),
      before: side(t.before), after: side(t.after),
    }))
    .sort((x, y) => (y.beforeRate - y.afterRate) - (x.beforeRate - x.afterRate) || byOrder(x, y)) : [];

  // One scale for every row: 0 to 80%, or to 100% when any week is above 80%.
  const peak = Math.max(0, ...[every, ...each].flatMap((r) => r.weeks.map((w) => (w.delivered ? w.opened / w.delivered : 0))));
  const top = peak > 0.8 ? 1 : 0.8;

  return { split, top, every, each, head: halvedSentence(each, split), meta: eachMeta(each, split) };
}

function halvedSentence(each, split) {
  const n = each.length;
  if (!n || !split) return '';
  const day = md(split);
  const k = each.filter((r) => r.halved).length;
  if (n === 1) return `${cap(inlineName(each[0].type))} ${k ? 'halved' : 'did not halve'} after ${day}.`;
  if (k === n) return n === 2 ? `Both halved after ${day}.` : `All ${word(n)} halved after ${day}.`;
  if (k === 0) return n === 2 ? `Neither halved after ${day}.` : `None of the ${word(n)} halved after ${day}.`;
  const kept = each.filter((r) => !r.halved).map((r) => inlineName(r.type));
  return `${cap(word(k))} of the ${word(n)} halved after ${day}. ${cap(joinAnd(kept))} did not.`;
}

function eachMeta(each, split) {
  if (!split) return '';
  const n = each.length;
  if (!n) return `no email sent on both sides of ${md(split)}`;
  return `${word(n)} ${n === 1 ? 'email that' : 'emails that'} sent across ${md(split)}`;
}

/**
 * The line under the opens. The emails compared send from one address (each
 * EMAILS entry's `from`, pinned to send-transactional-email's fromAddress by
 * adminEmailImpactMigration.test.mjs), so when some halved and some did not, the
 * address alone cannot be why. '' otherwise: then there is nothing to rule out.
 * Nor is there when the emails compared do not all share an address (the
 * product update goes from hello@): then the claim would not be true.
 */
export function opensFoot(opens) {
  const each = opens?.each || [];
  const kept = each.filter((r) => !r.halved);
  if (each.length < 2 || !kept.length || kept.length === each.length) return '';
  if (new Set(each.map((r) => byType.get(r.type)?.from ?? 'lifecycle')).size > 1) return '';
  const all = each.length === 2 ? 'Both send' : `All ${word(each.length)} send`;
  return `${all} from the same address, and ${joinAnd(kept.map((r) => inlineName(r.type)))} did not halve, `
    + 'so the address alone does not explain the drop.';
}

const opensY = (r, top) => OPEN_Y.base - (Math.min(Math.max(r, 0), top) / top) * (OPEN_Y.base - OPEN_Y.top);

/**
 * One row of opens. Dots where something was delivered (hollow under
 * THIN_WEEK), a line through consecutive ones, and the average before the
 * split and after it as two dashed rules, each with its figure.
 */
export function openGeometry(row, cal, { top = 0.8, split = null } = {}) {
  const dots = [];
  const runs = [];
  let run = [];
  row.weeks.forEach((w, i) => {
    if (w.delivered > 0) {
      const x = cal.center(i);
      const y = opensY(w.opened / w.delivered, top);
      run.push([x, y]);
      dots.push({ i, x: r1(x), y: r1(y), thin: w.delivered < THIN_WEEK });
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  const paths = runs.filter((s) => s.length > 1).map((s) => `M${s.map(([x, y]) => `${r1(x)},${r1(y)}`).join('L')}`);

  const means = [];
  const xs = split ? cal.xOfDay(split) : null;
  if (xs != null) {
    const first = row.weeks.findIndex((w) => w.delivered > 0);
    let last = cal.n - 1;
    while (last >= 0 && !(row.weeks[last].delivered > 0)) last -= 1;
    if (row.beforeRate != null && first >= 0 && cal.left(first) + 4 < xs) {
      const y = opensY(row.beforeRate, top);
      means.push({ key: 'before', x1: r1(cal.left(first) + 4), x2: r1(xs), y: r1(y),
        label: { lx: pctX(xs), ly: r1((y / OPEN_H) * 100), t: pctText(row.beforeRate) } });
    }
    if (row.afterRate != null && last >= 0 && xs < cal.left(last + 1) - 4) {
      const x2 = cal.left(last + 1) - 4;
      const y = opensY(row.afterRate, top);
      means.push({ key: 'after', x1: r1(xs), x2: r1(x2), y: r1(y),
        label: { lx: pctX(x2), ly: r1((y / OPEN_H) * 100), t: pctText(row.afterRate) } });
    }
  }
  return { dots, paths, means };
}

/** The opens row's reading: 'before% → after%' and how many were delivered either side. */
export function openReading(row) {
  if (!row.before || !row.after) {
    const d = sum(row.weeks.map((w) => w.delivered));
    const o = sum(row.weeks.map((w) => w.opened));
    return { value: pctText(rateOf(o, d)), when: `${fmt(d)} delivered` };
  }
  return {
    value: `${pctText(row.beforeRate)} → ${pctText(row.afterRate)}`,
    when: `${fmt(row.before.delivered)} then ${fmt(row.after.delivered)} delivered`,
  };
}

/** The hover card for one week of opens. */
export function openTip(row, cal, i) {
  const w = row.weeks[i];
  if (!w) return null;
  const lx = pctX(cal.center(i));
  return {
    lx,
    side: tipSide(lx),
    title: `${weekName(cal, i)} · ${row.name}`,
    value: w.delivered ? pctText(w.opened / w.delivered) : w.sent ? 'none delivered' : 'none sent',
    of: w.delivered ? `${fmt(w.opened)} of ${fmt(w.delivered)} opened` : '',
    lines: [],
  };
}

/** What a screen reader hears for one row of opens. */
export function openAria(row, cal) {
  const weeks = row.weeks.map((w) => (w.delivered ? pctText(w.opened / w.delivered) : 'none'));
  return `${row.name}, opened per delivered each week from ${md(cal.weeks[0])}: ${weeks.join(', ')}.`;
}

// ── 02 · Sends ──────────────────────────────────────────────────────────────

/**
 * How an email has been sending, over the complete weeks in view since its
 * first: 'every week', 'every week but one', 'again since the week of Oct 5'
 * after two or more empty weeks, or 'in 9 of 12 weeks'. '' for one that has
 * not gone out since its last empty run began.
 */
export function sendPace(v, cal) {
  const c = cal.n - 1;                       // complete weeks: 0 .. c - 1
  const first = v.findIndex((x, i) => i < c && x > 0);
  if (first < 0) return v[cal.n - 1] > 0 ? 'from this week' : '';
  const zeros = [];
  for (let i = first; i < c; i += 1) if (!(v[i] > 0)) zeros.push(i);
  if (!zeros.length) return 'every week';
  // The last empty run, and whether anything went out after it.
  const end = zeros[zeros.length - 1];
  let start = end;
  while (zeros.includes(start - 1)) start -= 1;
  if (end - start + 1 >= 2) {
    if (end + 1 < c) return `again since the week of ${md(cal.weeks[end + 1])}`;
    return v[cal.n - 1] > 0 ? 'again this week' : '';
  }
  if (zeros.length === 1) return 'every week but one';
  return `in ${c - first - zeros.length} of ${c - first} weeks`;
}

/**
 * The rows of 02, in two groups. An email is sending now when anything went out
 * this week or last; otherwise it is paused or stopped, and says when it last
 * went out.
 */
export function sendGroups(raw) {
  const cal = impactCalendar(raw);
  const n = cal.n;
  const types = Array.isArray(raw?.types) ? raw.types : [];
  const rows = types.map((t) => {
    const v = arr(t.sent, n);
    const held = arr(t.held, n);
    const row = {
      key: t.type,
      type: t.type,
      name: emailName(t.type),
      v,
      made: arr(t.made, n),
      held,
      heldMade: arr(t.held_made, n),
      young: arr(t.young, n),
      max: niceCeiling(Math.max(5, ...v.map((x, i) => x + held[i]))),
      now: (v[n - 1] || 0) + (n > 1 ? v[n - 2] || 0 : 0) > 0,
      lastSent: dayOf(t.last_sent),
    };
    row.total = sum(row.v);
    row.madeTotal = sum(row.made);
    row.heldTotal = sum(row.held);
    row.heldMadeTotal = sum(row.heldMade);
    row.pace = sendPace(v, cal);
    return row;
  }).sort(byOrder);

  const sending = rows.filter((r) => r.now);
  const stopped = rows.filter((r) => !r.now);
  const groups = [];
  if (sending.length) groups.push({ key: 'now', name: 'Sending now', head: sendingHead(sending), rows: sending });
  if (stopped.length) groups.push({ key: 'stopped', name: 'Paused or stopped', head: 'None of these has gone out this week or last.', rows: stopped });
  return groups;
}

function sendingHead(rows) {
  const byPace = [];
  for (const r of rows) {
    if (!r.pace) continue;
    const g = byPace.find((x) => x.pace === r.pace);
    if (g) g.names.push(inlineName(r.type)); else byPace.push({ pace: r.pace, names: [inlineName(r.type)] });
  }
  return byPace.length ? `${cap(byPace.map((g) => `${joinAnd(g.names)} ${g.pace}`).join('; '))}.` : '';
}

/**
 * The words beside one row of sends. A held-back group is counted beside what
 * was sent, and who in it made something goes under who did among those sent,
 * so the two can be read against each other.
 */
export function sendReading(row, cal) {
  const n = cal.n;
  const thisWeek = row.v[n - 1] || 0;
  return {
    value: fmt(row.total),
    unit: row.heldTotal ? `sent · ${fmt(row.heldTotal)} held back` : 'sent',
    when: `${fmt(row.madeTotal)} made something in 3 days`,
    held: row.heldTotal ? `held back: ${fmt(row.heldMadeTotal)} made something` : null,
    last: thisWeek ? `this week so far ${fmt(thisWeek)}` : row.lastSent ? `last sent ${md(row.lastSent)}` : '',
  };
}

function rectPath(x, y, w, h) {
  return h > 0.2 && w > 0 ? `M${r1(x)},${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z` : '';
}

/**
 * One row of sends on its own scale. Each week is a grey bar of what was sent,
 * the people who then made something as a green foot inside it, and the group
 * held back as a dashed outline on top. This week so far is drawn hollow.
 */
export function sendGeometry(row, cal) {
  const span = SEND_Y.base - SEND_Y.top;
  const bars = [];
  row.v.forEach((v, i) => {
    const x = cal.left(i) + (cal.slot - cal.bw) / 2;
    const part = i === cal.n - 1;
    const h = (v / row.max) * span;
    if (v > 0) bars.push({ key: `s${i}`, tone: part ? 'part' : 'sent', d: barPath(x, SEND_Y.base - h, cal.bw, h, 4) });
    const w = row.made[i];
    if (w > 0) {
      const wh = Math.max((w / row.max) * span, 2);
      const inset = part ? 1 : 0;
      bars.push({ key: `m${i}`, tone: 'made', d: rectPath(x + inset, SEND_Y.base - wh, cal.bw - 2 * inset, wh) });
    }
    const hv = row.held[i];
    if (hv > 0) {
      const hh = Math.max((hv / row.max) * span, 3);
      bars.push({ key: `h${i}`, tone: 'held', d: barPath(x + 0.75, SEND_Y.base - h - hh - 2, cal.bw - 1.5, hh, 3) });
    }
  });
  return { bars };
}

/** The hover card for one week of sends. */
export function sendTip(row, cal, i) {
  if (i == null || i < 0 || i >= cal.n) return null;
  const lx = pctX(cal.center(i));
  const lines = [];
  if (row.v[i]) lines.push(`${fmt(row.made[i])} made something within 3 days`);
  if (row.held[i]) lines.push(`${fmt(row.held[i])} held back · ${fmt(row.heldMade[i])} made something`);
  if (row.young[i]) lines.push(`${fmt(row.young[i])} still inside their 3 days`);
  return {
    lx,
    side: tipSide(lx),
    title: `${weekName(cal, i)} · ${row.name}`,
    value: row.v[i] ? fmt(row.v[i]) : 'none',
    of: 'sent',
    lines,
  };
}

export function sendAria(row, cal) {
  return `${row.name}, sent each week from ${md(cal.weeks[0])}: ${row.v.join(', ')}; made something within 3 days: ${row.made.join(', ')}`
    + `${row.heldTotal ? `; held back: ${row.held.join(', ')}` : ''}.`;
}

// ── 03 · Welcomes per 100 new accounts ──────────────────────────────────────

/** How long after a sign-up its welcome can still go out (lifecycle_due_welcome_board's 72 hours). */
export const WELCOME_WAIT_DAYS = 3;

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const per100 = (r) => (r == null ? '—' : String(Math.round(r * 100)));

// The start of the read's own UTC day. A week settles at a UTC midnight, so on
// that day this says the same as the clock, and a page left open overnight
// keeps saying what its numbers say.
function readNow(raw) {
  const t = Date.parse(`${dayOf(raw?.today)}T00:00:00Z`);
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * New accounts by sign-up week and how many of them got the welcome. A week is
 * settled once everyone who signed up in it is past the welcome's wait, so the
 * last week or two still fill. `usual` is the median of the settled weeks since
 * the welcome's first; a stall is the lowest settled week under half of it.
 */
export function welcomeSeries(raw, now = readNow(raw)) {
  const cal = impactCalendar(raw);
  const n = cal.n;
  const signups = arr(raw?.signups, n);
  const welcomed = arr(raw?.welcomed, n);
  const wt = (Array.isArray(raw?.types) ? raw.types : []).find((t) => t?.type === 'welcome_board');
  const firstWeek = wt?.first_sent ? mondayOf(dayOf(wt.first_sent)) : null;
  let start = n;
  if (firstWeek) {
    const at = cal.weeks.findIndex((w) => w >= firstWeek);
    start = at < 0 ? n : at;
  }
  const weeks = cal.weeks.map((wk, i) => {
    const settledAt = Date.parse(`${addDays(wk, 7 + WELCOME_WAIT_DAYS)}T00:00:00Z`);
    return {
      i,
      wk,
      signups: signups[i],
      welcomed: welcomed[i],
      rate: signups[i] > 0 ? welcomed[i] / signups[i] : null,
      settled: Number.isFinite(settledAt) && settledAt <= now,
      before: i < start,
    };
  });
  const settled = weeks.filter((w) => !w.before && w.settled && w.rate != null);
  const usual = median(settled.map((w) => w.rate));
  let stall = null;
  if (usual != null) {
    for (const w of settled) if (w.rate < usual / 2 && (!stall || w.rate < stall.rate)) stall = w;
  }
  const shown = stall || settled[settled.length - 1] || null;
  return {
    weeks,
    start,
    usual,
    stall,
    reading: {
      value: shown ? per100(shown.rate) : '—',
      unit: shown ? `in the week of ${md(shown.wk)}` : '',
      when: usual != null ? `usually about ${per100(usual)} per 100` : 'not enough settled weeks yet',
    },
  };
}

const welcomeY = (r) => WELCOME_Y.base - Math.min(Math.max(r, 0), 1) * (WELCOME_Y.base - WELCOME_Y.top);

/**
 * The welcome chart: a bar per sign-up week, the usual as a dashed rule, the
 * stall marked. A settled week where nobody got the welcome is a dashed stub in
 * the alert's rose; a week still filling is hollow whatever it holds so far,
 * because none yet is what a week looks like before its welcomes go out.
 */
export function welcomeGeometry(series, cal) {
  const bars = [];
  for (const w of series.weeks) {
    if (w.before || !(w.signups > 0)) continue;
    const x = cal.left(w.i) + (cal.slot - cal.bw) / 2;
    if (w.rate > 0) {
      const y = welcomeY(w.rate);
      bars.push({ key: w.wk, tone: w.settled ? 'bar' : 'part', d: barPath(x, y, cal.bw, WELCOME_Y.base - y, 4) });
    } else {
      bars.push({ key: w.wk, tone: w.settled ? 'zero' : 'part', d: barPath(x + 0.75, WELCOME_Y.base - 6, cal.bw - 1.5, 6, 2) });
    }
  }
  const ref = series.usual == null ? null : {
    y: r1(welcomeY(series.usual)),
    ly: r1((welcomeY(series.usual) / WELCOME_H) * 100),
    label: `usual, ${per100(series.usual)}`,
  };
  const stall = series.stall ? {
    lx: pctX(cal.center(series.stall.i)),
    ly: r1(((welcomeY(series.stall.rate) - 6) / WELCOME_H) * 100),
    label: `${fmt(series.stall.welcomed)} of ${fmt(series.stall.signups)}`,
  } : null;
  return { bars, ref, stall };
}

export function welcomeTip(series, cal, i) {
  const w = series.weeks[i];
  if (!w || w.before) return null;
  const lx = pctX(cal.center(i));
  const lines = [];
  if (w.signups) lines.push(`${fmt(w.welcomed)} of ${fmt(w.signups)} got a welcome`);
  if (!w.settled) lines.push(`still filling: the welcome can go out up to ${WELCOME_WAIT_DAYS} days after sign-up`);
  return {
    lx,
    side: tipSide(lx),
    title: i === cal.n - 1 ? 'signed up this week so far' : `signed up the week of ${md(w.wk)}`,
    value: w.signups ? per100(w.rate) : 'no new accounts',
    of: w.signups ? 'per 100' : '',
    lines,
  };
}

export function welcomeAria(series, cal) {
  const from = series.weeks.find((w) => !w.before);
  if (!from) return 'No welcome emails in view.';
  const vals = series.weeks.filter((w) => !w.before).map((w) => (w.signups ? per100(w.rate) : 'none'));
  return `Welcomes per 100 new accounts by sign-up week from ${md(from.wk)}: ${vals.join(', ')}.`;
}

/** The span an entry covers, as 'Sep 6 to 16' or 'Aug 30 to Sep 2'. */
export function spanText(day, until) {
  if (!until) return md(day);
  const sameMonth = String(day).slice(0, 7) === String(until).slice(0, 7);
  return `${md(day)} to ${sameMonth ? Number(String(until).slice(8, 10)) : md(until)}`;
}

/** The line under the welcome chart. */
export function welcomeFoot(series, changes = EMAIL_CHANGES) {
  const s = series.stall;
  if (!s) {
    const from = series.weeks.find((w) => !w.before);
    return { strong: '', rest: from ? `No settled sign-up week since ${md(from.wk)} fell below half the usual.` : '' };
  }
  const strong = `The week of ${md(s.wk)}: ${fmt(s.welcomed)} of ${fmt(s.signups)} new accounts got a welcome`;
  const end = addDays(s.wk, 6);
  const gap = changes.find((c) => c.until && (c.types || []).includes('welcome_board') && c.day <= end && c.until >= s.wk);
  return {
    strong,
    rest: gap ? `. No welcome went out ${spanText(gap.day, gap.until)}; sending resumed ${md(addDays(gap.until, 1))}.` : '.',
  };
}

// ── What changed ────────────────────────────────────────────────────────────

/** The glyph each kind of change draws, as a viz/markerGlyphs kind. */
export const MARK_KIND = Object.freeze({ stop: 'event', alert: 'alert', first: 'ship', due: 'due' });

export const CHANGE_KINDS = Object.freeze([
  { kind: 'stop', label: 'stopped or paused' },
  { kind: 'alert', label: 'alert' },
  { kind: 'first', label: 'first time' },
  { kind: 'due', label: 'due' },
]);

const changeKey = (c) => `${c.day}:${c.kind}:${c.label}`;

/** An entry's figure, worked out from the read, or null when the read cannot say it. */
export function changeFigure(c, { opens, sends, welcome } = {}) {
  if (c.figure === 'welcome_gap') {
    const s = welcome?.stall;
    if (!s || !c.until) return null;
    const end = addDays(s.wk, 6);
    if (!(c.day <= end && c.until >= s.wk)) return null;
    return `${fmt(s.welcomed)} of ${fmt(s.signups)} new accounts in the week of ${md(s.wk)}`;
  }
  if (c.figure === 'split') {
    const each = opens?.each || [];
    if (!each.length) return null;
    const k = each.filter((r) => r.halved).length;
    return k ? `opens halved for ${k} of the ${each.length} emails that sent across it`
      : `none of the ${each.length} emails that sent across it halved its opens`;
  }
  if (c.figure === 'held') {
    const type = (c.types || [])[0];
    const row = (sends || []).flatMap((g) => g.rows).find((r) => r.type === type);
    return row?.heldTotal ? `${fmt(row.heldTotal)} held back so far` : null;
  }
  return null;
}

/**
 * What changed, for the list beside the opens. Everything dated inside the
 * weeks in view, oldest first, then anything due today or later. `meta` counts
 * both, as 'since Jun 22'. A reading stays due through its own day, so the day
 * it is due says 'today' rather than dropping into the past.
 */
export function changesList(raw, { changes = EMAIL_CHANGES, opens, sends, welcome } = {}) {
  const cal = impactCalendar(raw);
  if (!cal.n || !cal.today) return { items: [], meta: '', next: null };
  const from = cal.weeks[0];
  const isDue = (c) => c.kind === 'due' && c.day >= cal.today;
  const dated = changes
    .filter((c) => !isDue(c) && c.day >= from && c.day <= cal.today)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.day < b.c.day ? -1 : a.c.day > b.c.day ? 1 : a.i - b.i))
    .map(({ c }) => c);
  const due = changes.filter(isDue).sort((a, b) => (a.day < b.day ? -1 : 1));
  const item = (c, next) => ({
    key: changeKey(c),
    day: c.day,
    until: c.until || null,
    kind: c.kind,
    types: c.types || [],
    d: md(c.day),
    label: c.until ? `${c.label}, ${spanText(c.day, c.until)}` : c.label,
    sub: c.sub || changeFigure(c, { opens, sends, welcome }) || '',
    next,
  });
  const items = [...dated.map((c) => item(c, false)), ...due.map((c) => item(c, true))];
  const meta = `${fmt(dated.length)} since ${md(from)}${due.length ? `, and ${word(due.length)} due` : ''}`;
  const first = due[0];
  const days = first ? daysBetween(cal.today, first.day) : null;
  const next = first ? {
    d: md(first.day),
    text: `${first.short || first.label}, ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
  } : null;
  return { items, meta, next };
}

/**
 * The dated lines a row draws: the changes about every email, and the ones about
 * this row's own. The first row of a group carries the glyphs of all of them;
 * the rows under it carry glyphs only for their own, so a shared change is not
 * labelled once a row. `bands` are the entries that lasted (the welcome gap),
 * shaded across their days.
 */
export function rowMarks(items, cal, type, { first = false } = {}) {
  const marks = [];
  const bands = [];
  for (const it of items) {
    if (it.next) continue;
    const shared = !it.types.length;
    if (!shared && !(type && it.types.includes(type))) continue;
    const x = cal.xOfDay(it.day);
    if (x == null) continue;
    marks.push({ key: it.key, x: r1(x), lx: pctX(x), kind: it.kind, glyph: first || !shared });
    if (it.until && !shared) {
      const x2 = cal.xOfDay(addDays(it.until, 1));
      if (x2 != null && x2 > x) bands.push({ key: it.key, x: r1(x), w: r1(x2 - x), lx: pctX((x + x2) / 2) });
    }
  }
  return { marks, bands };
}

// ── 04 · Detail ─────────────────────────────────────────────────────────────

const REASON = Object.freeze({
  failed: 'failed on our side',
  bounced: 'bounced',
  no_report: 'no delivery report after 3 days',
});

/** Sends that never arrived, by email and reason, most first. */
export function lostRows(raw) {
  const cal = impactCalendar(raw);
  const rows = (Array.isArray(raw?.lost) ? raw.lost : []).map((l) => {
    const byWeek = arr(l.by_week, cal.n);
    let last = -1;
    byWeek.forEach((v, i) => { if (v > 0) last = i; });
    return {
      key: `${l.type}:${l.reason}`,
      name: emailName(l.type),
      reason: REASON[l.reason] || String(l.reason || ''),
      n: num(l.n),
      byWeek,
      max: Math.max(1, ...byWeek),
      last: last < 0 ? '—' : weekName(cal, last),
    };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name) || a.reason.localeCompare(b.reason));
  const total = sum(rows.map((r) => r.n));
  return { rows, total, count: cal.n ? `${total ? fmt(total) : 'none'} since ${md(cal.weeks[0])}` : null };
}

/** Every subject and body line under test, by email. */
export function armRows(raw) {
  const cal = impactCalendar(raw);
  const arms = Array.isArray(raw?.arms) ? raw.arms : [];
  const rows = arms.map((a) => {
    const sends = num(a.sends);
    const delivered = num(a.delivered);
    const lastDay = dayOf(a.last);
    const quiet = cal.today && lastDay ? daysBetween(lastDay, cal.today) : null;
    return {
      key: `${a.type}:${a.factor}:${a.arm}`,
      type: a.type,
      name: emailName(a.type),
      factor: a.factor === 'subject' ? 'subject' : a.factor === 'body' ? 'body' : String(a.factor || ''),
      arm: String(a.arm || ''),
      sends,
      opened: { r: rateOf(a.opened, delivered), n: num(a.opened) },
      clicked: { r: rateOf(a.clicked, delivered), n: num(a.clicked) },
      back: { r: sends ? num(a.returned) / sends : null, n: num(a.returned) },
      made: { r: sends ? num(a.made) / sends : null, n: num(a.made) },
      ran: quiet != null && quiet <= 14 ? `since ${md(a.first)}` : `${spanText(dayOf(a.first), lastDay)}`,
      live: quiet != null && quiet <= 14,
    };
  }).sort((x, y) => byOrder(x, y)
    || (x.factor === y.factor ? 0 : x.factor === 'subject' ? -1 : 1)
    || x.arm.localeCompare(y.arm, 'en', { numeric: true }));
  const emails = new Set(rows.map((r) => r.type)).size;
  return {
    rows,
    count: rows.length ? `${fmt(rows.length)} ${rows.length === 1 ? 'line' : 'lines'} across ${fmt(emails)} ${emails === 1 ? 'email' : 'emails'}` : 'none in view',
  };
}

const BOXES = Object.freeze({
  gmail: 'Gmail',
  outlook: 'Outlook and Hotmail',
  icloud: 'iCloud',
  yahoo: 'Yahoo and AOL',
  other: 'Everything else',
});

/** Opens by mailbox: Gmail, Outlook, iCloud, Yahoo and AOL, and the rest last. */
export function mailboxRows(raw) {
  const cal = impactCalendar(raw);
  const rows = (Array.isArray(raw?.mailbox) ? raw.mailbox : []).map((b) => {
    const delivered = arr(b.delivered, cal.n);
    const opened = arr(b.opened, cal.n);
    const d = sum(delivered);
    const o = sum(opened);
    const before = side(b.before);
    const after = side(b.after);
    return {
      key: b.box,
      name: BOXES[b.box] || String(b.box || ''),
      delivered: d,
      opened: o,
      rate: rateOf(o, d),
      before: before ? rateOf(before.opened, before.delivered) : null,
      after: after ? rateOf(after.opened, after.delivered) : null,
      beforeN: before?.delivered ?? null,
      afterN: after?.delivered ?? null,
      weeks: delivered.map((v, i) => ({ delivered: v, opened: opened[i] })),
    };
  }).sort((a, b) => (a.key === 'other') - (b.key === 'other') || b.delivered - a.delivered);
  return { rows, count: cal.n ? `from ${md(cal.weeks[0])}` : null };
}

/** A mailbox's weeks as a small line: one point per week that had a delivery. */
export function sparkPath(weeks, { w = 120, h = 22, top = 1 } = {}) {
  const n = weeks.length;
  if (!n) return { d: '', dots: [] };
  const step = w / n;
  const pts = [];
  const dots = [];
  weeks.forEach((x, i) => {
    if (!(x.delivered > 0)) return;
    const px = r1((i + 0.5) * step);
    const py = r1(h - 2 - (Math.min(x.opened / x.delivered, top) / top) * (h - 4));
    pts.push(`${px},${py}`);
    dots.push({ i, x: px, y: py, thin: x.delivered < THIN_WEEK });
  });
  return { d: pts.length > 1 ? `M${pts.join('L')}` : '', dots };
}

/** The status strip's window: '18 wk UTC, from Jun 22 · 3 of 7 days'. */
export function windowText(raw) {
  const cal = impactCalendar(raw);
  if (!cal.n) return '';
  return `${cal.n} wk UTC, from ${md(cal.weeks[0])}${cal.daysSoFar ? ` · ${cal.daysSoFar} of 7 days` : ''}`;
}
