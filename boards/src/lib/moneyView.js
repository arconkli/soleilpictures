// moneyView — what Analytics › Money says, worked out from what its reads return.
//
// The page is the owner's pick of 2026-10-20 ("The path to a payment"). Every
// sentence and every coordinate on it comes out of here, pure, so each one is
// tested against numbers instead of eyeballed:
//
//   moneySteps        the path in people (admin_money_path, 0492). Nested: each
//                     step counts people who reached it AND every step before
//                     it, so no step is ever larger than the one before.
//   pathGeometry      the SVG: bars, the ribs between them, the hatched wedge of
//                     who stopped, and where the callout over the biggest drop
//                     fits: above the wedge, beside it, or under the chart
//   leakText, routesLine, checkoutFoot   the words around the path
//   offerRows, trialOnButtonRows, reasonRows   what people did with the offer
//   placementRows, placementsFoot        every place the offer opens
//                                        (admin_conversion_funnel)
//   trialCard         one running trial: days left, how far in, what led to it
//   capRow, capNext   everyone who has hit the cap, and what happened next
//   moneyTiles        the six figures at the top
//
// The mockup drew a "Clicked to upgrade" step between seeing a price and
// pressing the button. It is not one: a press of Start trial can come through
// the cap wall from someone who never pressed an Upgrade button, and a step
// they skip is not nested. So the steps are nested and the routes to the plans
// are reported beside them, never as a step.
//
// Days are UTC days, as the reads store them.

import { CTA, CREATOR_TRIAL_DAYS, PLAN_NAME } from './billingCopy.js';
import { TRIAL_CAP_FRAC, TRIAL_MIN_CARDS } from './creatorTrial.js';
import { formatMoney } from './adminFormat.js';

const DAY = 86_400_000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
export const fmt = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US'));

function at(iso) {
  if (iso == null || iso === '') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** 'Oct 14' for a timestamp or a day, read in UTC. '' for anything else. */
export function md(iso) {
  const t = at(iso);
  if (t == null) return '';
  const d = new Date(t);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** 'Thu Oct 30, 08:37 UTC'. */
export function mdTime(iso, { weekday = false } = {}) {
  const t = at(iso);
  if (t == null) return '';
  const d = new Date(t);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${weekday ? `${WEEKDAY[d.getUTCDay()]} ` : ''}${md(iso)}, ${hm} UTC`;
}

const dayIndex = (t) => Math.floor(t / DAY);

/** Whole UTC days from the day of `iso` to the day of `now`. null when `iso` is not a time. */
export function daysAfter(iso, now) {
  const t = at(iso);
  return t == null ? null : dayIndex(now) - dayIndex(t);
}

// ── The path ────────────────────────────────────────────────────────────────

/**
 * The six steps, from admin_money_path's `steps`. [] until it has answered.
 * The last step is `pending` while a running trial's first charge is due: a
 * zero there is "not yet", not a loss.
 */
export function moneySteps(path) {
  const s = path?.steps;
  if (!s) return [];
  const v = (k) => num(s[k]);
  const pressed = v('pressed');
  const allTrial = pressed > 0 && v('pressed_trial') === pressed;
  const started = v('started');
  const allTrialStarts = started > 0 && v('started_trial') === started;
  const running = v('trial_running');
  const ends = s.trial_ends;
  const due = running > v('trial_cancelling') && at(ends) != null;
  const paid = v('paid');
  const endedUnpaid = v('trial_ended_unpaid');

  let startedNote = 'nobody yet';
  if (running === 1) startedNote = `running · ends ${md(ends)}`;
  else if (running > 1) startedNote = `${running} running · first ends ${md(ends)}`;
  else if (started) startedNote = 'none running now';

  return [
    {
      key: 'saw',
      label: 'Saw a price',
      n: v('saw'),
      note: 'any plan picker',
      def: 'A plan picker or a price opened for them at least once, anywhere in the app.',
    },
    {
      key: 'pressed',
      label: allTrial ? 'Pressed Start trial' : `Pressed the ${PLAN_NAME} button`,
      n: pressed,
      note: s.first_pressed ? `first on ${md(s.first_pressed)}` : 'nobody yet',
      def: `Pressed the ${PLAN_NAME} button inside the plans, after seeing a price.`
        + (allTrial ? ` Every press offered the ${CREATOR_TRIAL_DAYS}-day trial.` : '')
        + (s.first_pressed ? ` Nobody had pressed it before ${md(s.first_pressed)}.` : ' Nobody has pressed it yet.'),
    },
    {
      key: 'checkout',
      label: 'Opened checkout',
      n: v('checkout'),
      note: 'reached Stripe',
      def: 'Stripe checkout opened for them after they pressed the button.',
    },
    {
      key: 'finished',
      label: 'Finished checkout',
      n: v('finished'),
      note: s.first_finished ? (v('finished') === 1 ? md(s.first_finished) : `first ${md(s.first_finished)}`) : 'nobody yet',
      def: 'Came back from Stripe with a subscription.',
    },
    {
      key: 'started',
      label: allTrialStarts ? 'Started the trial' : `Started ${PLAN_NAME}`,
      n: started,
      note: startedNote,
      def: `A ${PLAN_NAME} trial or subscription began for them.`
        + (running ? ` ${running === 1 ? 'One is' : `${running} are`} running, ${running === 1 ? 'ending' : 'the first ending'} ${mdTime(ends)}.` : '')
        + (endedUnpaid ? ` ${endedUnpaid} ended without a payment.` : ''),
    },
    {
      key: 'paid',
      label: 'Paid',
      n: paid,
      pending: !paid && due,
      note: paid ? (s.first_paid ? `first ${md(s.first_paid)}` : '') : due ? `first charge ${md(ends)}` : 'nobody yet',
      def: 'People whose first charge has cleared.'
        + (paid ? '' : ` Nobody has paid yet${due ? `; the first charge is due ${mdTime(ends)}` : ''}.`),
    },
  ];
}

/** The chip between two steps: '52%', '1.3%', '100%', 'not yet' or '—'. */
export function stepRate(from, to) {
  if (!from?.n) return '—';
  if (to.pending && !to.n) return 'not yet';
  const c = to.n / from.n;
  if (c >= 0.995) return '100%';
  if (c > 0 && c < 0.05) return `${r1(c * 100)}%`;
  return `${Math.round(c * 100)}%`;
}

/** The biggest fall between two neighbouring steps, or null when nobody is lost anywhere. */
export function biggestDrop(steps) {
  let idx = -1;
  let lost = 0;
  for (let i = 0; i < steps.length - 1; i += 1) {
    const d = steps[i].n - steps[i + 1].n;
    if (d > lost) { lost = d; idx = i; }
  }
  return idx < 0 ? null : { at: idx, lost };
}

// The drawing box, in SVG units. The mockup's, so the build lines up with it.
export const PATH_BOX = { W: 1000, H: 340, base: 262, top: 66, bw: 62 };
// The callout's room in box units: a title and three lines at the CSS width
// cap of min(330px, 40%).
const CALLOUT = { w: 400, h: 96 };

/** A bar with 4px rounded data-end, anchored to the baseline. '' when it has no height. */
export function barPath(x, y, w, h, r = 4) {
  if (!(h > 0.2)) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${r1(x)},${r1(y + h)}V${r1(y + rr)}Q${r1(x)},${r1(y)} ${r1(x + rr)},${r1(y)}`
    + `H${r1(x + w - rr)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + rr)}V${r1(y + h)}Z`;
}

/**
 * Everything the path's SVG and its overlay labels need. Positions of the HTML
 * overlays are percentages of the box, so they scale with it.
 *
 * The callout over the biggest drop goes where it fits. ABOVE the wedge when
 * the step before the drop is short enough to leave room over it (the mockup's
 * case), with a leader dropping into the hatch. BESIDE it, right of the wedge,
 * when the drop starts from the tallest bar (the nested path's usual case: the
 * wedge then fills the plot's height), with a short leader pointing back into
 * the hatch. Otherwise under the chart, as a line.
 */
export function pathGeometry(steps, { hov = null } = {}) {
  const n = steps.length;
  if (!n) return null;
  const { W, H, base, top, bw } = PATH_BOX;
  const cw = W / n;
  const max = Math.max(1, ...steps.map((s) => s.n));
  const hOf = (v) => (v > 0 ? Math.max(2.5, (v / max) * (base - top)) : 0);
  const xs = steps.map((_, i) => i * cw + (cw - bw) / 2);
  const hs = steps.map((s) => hOf(s.n));
  const pct = (v, of = W) => r1((v / of) * 100);

  const bars = steps.map((s, i) => ({
    key: s.key,
    d: barPath(xs[i], base - hs[i], bw, hs[i]),
    dim: hov != null && hov !== i,
  }));
  const zeros = steps
    .map((s, i) => (s.n ? null : `M${r1(xs[i])},${base}V${base - 12}H${r1(xs[i] + bw)}V${base}`))
    .filter(Boolean);
  const ribs = [];
  const convs = [];
  for (let i = 0; i < n - 1; i += 1) {
    const xr = xs[i] + bw;
    const xl = xs[i + 1];
    const ya = base - hs[i];
    const yb = base - hs[i + 1];
    ribs.push({
      d: `M${r1(xr)},${base}V${r1(ya)}L${r1(xl)},${r1(yb)}V${base}Z`,
      lost: hs[i] - hs[i + 1] > 1 ? `M${r1(xr)},${r1(ya)}H${r1(xl)}V${r1(yb)}Z` : '',
    });
    convs.push({ lx: pct((xr + xl) / 2), ly: pct(Math.min(base - 16, (ya + yb) / 2 - 14), H), label: stepRate(steps[i], steps[i + 1]) });
  }
  const nums = steps.map((s, i) => ({ lx: pct(xs[i] + bw / 2), ly: pct(base - hs[i] - 10, H), label: fmt(s.n), zero: !s.n }));
  const labs = steps.map((s, i) => ({ lx: pct(xs[i] + bw / 2), ly: pct(base + 14, H), label: s.label, note: s.note }));
  const hits = steps.map((_, i) => ({ x: r1(i * cw), w: r1(cw) }));

  let leak = null;
  const drop = biggestDrop(steps);
  if (drop) {
    const i = drop.at;
    const xr = xs[i] + bw;
    const xl = xs[i + 1];
    const ya = base - hs[i];
    const yb = base - hs[i + 1];
    if (ya - 40 >= CALLOUT.h && xl - 18 + CALLOUT.w <= W) {
      const lx = xl - 18;
      const by = Math.min(128, ya - 40);
      leak = { mode: 'above', at: i, lx: pct(lx), ly: pct(by, H), leader: `M${r1(lx - 8)},${r1(by + 6)}V${r1(ya + 14)}` };
    } else if (ya + 10 + CALLOUT.h <= yb - 40 && xl + 4 + CALLOUT.w <= W) {
      const lx = xl + 4;
      const ty = ya + 10;
      leak = { mode: 'beside', at: i, lx: pct(lx), ly: pct(ty, H), leader: `M${r1(lx - 6)},${r1(ty + 10)}H${r1(Math.max(xr + 10, xl - 40))}` };
    } else {
      leak = { mode: 'under', at: i };
    }
  }

  return {
    W, H, base, bars, zeros, ribs, convs, nums, labs, hits, leak,
    labWidth: r1(100 / n - 0.9),
    hl: hov != null && steps[hov] ? { x: r1(hov * cw + 4), w: r1(cw - 8) } : null,
  };
}

/** The hover card for step `hov`, anchored so it never leaves the box. */
export function pathTip(steps, hov) {
  if (hov == null || !steps[hov]) return null;
  const n = steps.length;
  const s = steps[hov];
  const prev = hov ? steps[hov - 1] : null;
  const side = hov <= 1 ? 'start' : hov >= n - 2 ? 'end' : 'mid';
  const lx = side === 'start' ? (hov * 100) / n + 1 : side === 'end' ? ((hov + 1) * 100) / n - 1 : ((hov + 0.5) * 100) / n;
  return { title: s.label, value: fmt(s.n), of: prev ? `of ${fmt(prev.n)} at the step before` : 'people', def: s.def, side, lx: r1(lx) };
}

/** The same steps as a list, for a box too narrow to draw them. */
export function pathList(steps) {
  const first = steps[0]?.n || 0;
  return steps.map((s, i) => {
    const prev = i ? steps[i - 1] : null;
    let conv = '';
    if (!i) conv = 'everyone counted here';
    else if (s.pending && !s.n) conv = 'not yet: the trial is still running';
    else if (prev.n) conv = `${r1((s.n / prev.n) * 100)}% of the step before`;
    return {
      key: s.key,
      label: s.label,
      n: fmt(s.n),
      pct: first ? Math.max(s.n ? 1.5 : 0, r1((s.n / first) * 100)) : 0,
      conv: [conv, s.note].filter(Boolean).join(' · '),
    };
  });
}

function firstPress(path) {
  const s = path?.steps || {};
  const r = path?.routes || {};
  const pressed = num(s.pressed);
  if (!pressed || !s.first_pressed) return ' Nobody has pressed the button yet.';
  const all = pressed === 2 ? 'both' : `all ${pressed}`;
  let how = '';
  if (num(r.wall?.pressed) === pressed) how = pressed === 1 ? ', through the cap wall' : `, and ${all} came through the cap wall`;
  else if (num(r.button?.pressed) === pressed) how = pressed === 1 ? ', from an Upgrade button' : `, and ${all} came from an Upgrade button`;
  return ` The first press was ${md(s.first_pressed)}${how}.`;
}

/** The callout over the biggest drop: { title, body }, or null when nobody is lost. */
export function leakText(steps, path) {
  const drop = biggestDrop(steps);
  if (!drop) return null;
  const from = steps[drop.at];
  const to = steps[drop.at + 1];
  if (to.pending) {
    return {
      title: `${fmt(drop.lost)} of the ${fmt(from.n)} ${plural(drop.lost, 'has', 'have')} not paid yet.`,
      body: `${drop.lost === 1 ? 'The trial is' : 'Their trials are'} still running; the first charge is due ${md(path?.steps?.trial_ends)}.`,
    };
  }
  const body = {
    pressed: `They opened the plans and closed them.${firstPress(path)}`,
    checkout: 'They pressed the button and Stripe never opened for them.',
    finished: 'They reached Stripe and left without finishing.',
    started: 'They finished checkout and no trial or subscription started.',
    paid: `${drop.lost === 1 ? 'The trial' : 'Their trials'} ended without a payment.`,
  }[to.key] || '';
  return { title: `${fmt(drop.lost)} of the ${fmt(from.n)} stop here.`, body };
}

/** How people first reached the plans. Routes overlap: `both` came by the wall and a button. */
export function routesLine(path) {
  const r = path?.routes;
  if (!r) return null;
  const part = (key, label, x) => ({ key, label, people: num(x?.people), pressed: num(x?.pressed) });
  return {
    parts: [
      part('wall', 'the cap wall', r.wall),
      part('button', 'an Upgrade button', r.button),
      part('elsewhere', 'anywhere else', r.elsewhere),
    ],
    both: num(r.both),
  };
}

/** The path's foot: is checkout where people are lost? `stalled` is null when that read failed. */
export function checkoutFoot(steps, path, reliability) {
  const s = path?.steps || {};
  const opened = num(s.checkout);
  const lead = 'The hatched wedge after each step is the people who stopped there.';
  if (!opened) return { lead, claim: 'Nobody has opened checkout yet.', facts: '' };
  const drop = biggestDrop(steps);
  const here = !!drop && steps[drop.at + 1]?.key === 'finished';
  const errors = num(s.checkout_error_people);
  const stalled = reliability ? num(reliability.stalled) : null;
  return {
    lead,
    claim: `Checkout is ${here ? '' : 'not '}where they are lost:`,
    facts: `${fmt(opened)} opened it, ${fmt(num(s.finished))} finished, ${fmt(errors)} ${plural(errors, 'error')}`
      + `${stalled == null ? '' : `, ${fmt(stalled)} stalled`}.`,
  };
}

// ── What they did with the offer ────────────────────────────────────────────

// How a closed offer was closed, in the key's order and opacity.
export const CLOSE_METHODS = [
  { key: 'x', label: 'the X' },
  { key: 'backdrop', label: 'clicked outside' },
  { key: 'maybe_later', label: 'Maybe later' },
  { key: 'nav', label: 'left the page' },
  { key: 'esc', label: 'Esc' },
];

const OUTCOMES = [
  { key: 'dismiss', label: 'Closed it' },
  { key: 'hidden', label: 'Left it open and went away' },
  { key: 'invite_alt', label: 'Invited a friend instead' },
  { key: 'demo_cta', label: 'Stayed on the free plan' },
  { key: 'cta', label: 'Pressed the button', on: true },
];

/** One row per outcome, each bar a share of every exposure; "Closed it" split by how. */
export function offerRows(offer) {
  const total = num(offer?.times);
  if (!total) return [];
  const o = offer.outcomes || {};
  const share = (v) => r1((num(v) / total) * 100);
  const dm = offer.dismiss_methods || {};
  const segs = CLOSE_METHODS
    .map((m, i) => ({ cls: `s${i + 1}`, pct: share(dm[m.key]), title: `${m.label}: ${fmt(num(dm[m.key]))}` }))
    .filter((g) => g.pct > 0);
  const otherWays = Object.keys(dm).filter((k) => !CLOSE_METHODS.some((m) => m.key === k)).reduce((a, k) => a + num(dm[k]), 0);
  if (otherWays) segs.push({ cls: 's5', pct: share(otherWays), title: `some other way: ${fmt(otherWays)}` });

  const known = OUTCOMES.filter((x) => o[x.key]);
  const rest = Object.keys(o).filter((k) => !OUTCOMES.some((x) => x.key === k));
  const restTimes = rest.reduce((a, k) => a + num(o[k]?.times), 0);
  const rows = known.map((x) => {
    const times = num(o[x.key].times);
    const people = num(o[x.key].people);
    if (x.key === 'dismiss') {
      const each = people && times > people ? `, ${r1(times / people)} times each on average` : '';
      return { key: x.key, label: x.label, note: `by ${fmt(people)} ${plural(people, 'person', 'people')}${each}`, times: fmt(times), unit: plural(times, 'time'), on: false, segs };
    }
    return { key: x.key, label: x.label, note: null, times: fmt(times), unit: `${plural(times, 'time')} · ${fmt(people)} ${plural(people, 'person', 'people')}`, on: !!x.on, segs: [{ cls: '', pct: share(times), title: fmt(times) }] };
  });
  if (restTimes) rows.push({ key: 'other', label: 'Something else', note: null, times: fmt(restTimes), unit: plural(restTimes, 'time'), on: false, segs: [{ cls: '', pct: share(restTimes), title: fmt(restTimes) }] });
  // The button last, as the mockup has it: the one outcome that leads anywhere.
  return rows.sort((a, b) => Number(a.on) - Number(b.on));
}

function whenPressed(first, last, count) {
  if (!count || !first) return 'nobody yet';
  if (count === 1) return `on ${md(first)}`;
  const a = new Date(at(first));
  const b = new Date(at(last) ?? at(first));
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return `${count === 2 ? 'both' : 'all'} in ${MONTH[a.getUTCMonth()]}`;
  }
  return `${md(first)} to ${md(last)}`;
}

/** The trial on the button: who saw it offered, and who pressed it. */
export function trialOnButtonRows(t) {
  const people = num(t?.people);
  if (!people) return [];
  const pressed = num(t.pressed);
  return [
    { key: 'shown', label: `Saw “${CTA.tryCreatorShort}” on the button`, note: `${fmt(num(t.times))} ${plural(num(t.times), 'time')} in all`, value: fmt(people), unit: plural(people, 'person', 'people'), pct: 100 },
    { key: 'pressed', label: 'Pressed it', note: whenPressed(t.pressed_first, t.pressed_last, pressed), value: fmt(pressed), unit: plural(pressed, 'person', 'people'), pct: r1((pressed / people) * 100) },
  ];
}

/** The answers to "why not", worded the way the ask words them. */
export function reasonRows(reasons) {
  const answered = num(reasons?.answered);
  return (reasons?.choices || []).map((c) => ({
    key: c.choice,
    label: c.label || c.choice,
    value: fmt(num(c.n)),
    pct: answered ? r1((num(c.n) / answered) * 100) : 0,
  }));
}

// ── Every place the offer opens ─────────────────────────────────────────────

// admin_conversion_funnel's surface names, as this page names them.
const PLACES = {
  'Cap wall': { name: 'Cap wall', note: 'a card was refused at the cap' },
  'Near-cap toast': { name: 'Near-cap toast', note: 'close to the cap' },
  'Upgrade pill': { name: 'Upgrade pill', note: 'the pill in the top bar' },
  'First-value banner': { name: 'First-value banner', note: 'after the first real work' },
  'File/size gate': { name: 'File or size gate', note: 'a file over the free limit' },
  Settings: { name: 'Settings', note: 'the plan tab' },
  'Pricing page (signed in)': { name: 'Pricing page, signed in', note: '/pricing' },
  'Public pricing page': { name: 'Pricing page, signed out', note: 'visitors, not people yet', visitors: true },
};

const seconds = (ms) => (ms == null || !Number.isFinite(Number(ms)) ? '—' : `${(Number(ms) / 1000).toFixed(1)} s`);

/** admin_conversion_funnel's rows, in its order, with the bar scaled to the most-shown place. */
export function placementRows(rows) {
  const list = [...(rows || [])].sort((a, b) => num(a.sort_order) - num(b.sort_order));
  const most = Math.max(1, ...list.map((r) => num(r.exposures)));
  return list.map((r) => {
    const place = PLACES[r.surface] || { name: r.surface, note: '' };
    const cta = num(r.cta);
    const trials = num(r.trials);
    return {
      key: r.surface,
      name: place.name,
      note: place.note,
      shown: fmt(num(r.exposures)),
      pct: r1((num(r.exposures) / most) * 100),
      on: cta > 0,
      people: place.visitors ? null : fmt(num(r.people)),
      look: seconds(r.median_dwell_ms),
      read: num(r.read_feature),
      compared: num(r.toggled_plan),
      cta: place.visitors && !cta ? null : cta,
      trials: place.visitors && !trials ? null : trials,
    };
  });
}

/**
 * Where the checkouts started, said once under the table. `alarm` names the
 * checkout failures that were our configuration rather than the person, which
 * need the opposite fix, and is '' while there are none.
 */
export function placementsFoot(rows) {
  const tail = 'A look is how long the offer stayed open.';
  const config = (rows || []).reduce((a, r) => a + num(r.config_errors), 0);
  const alarm = config
    ? ` ${fmt(config)} checkout ${config === 1 ? 'failure was' : 'failures were'} our configuration, not the person.`
    : '';
  const withCheckouts = (rows || []).filter((r) => num(r.checkouts) > 0);
  const total = withCheckouts.reduce((a, r) => a + num(r.checkouts), 0);
  if (!total) return { lead: 'No checkout has opened from any of these yet.', strong: '', tail, alarm };
  if (withCheckouts.length === 1) {
    const r = withCheckouts[0];
    const name = (PLACES[r.surface]?.name || r.surface).toLowerCase();
    const which = total === 1 ? 'The one checkout' : total === 2 ? 'Both checkouts' : `All ${total} checkouts`;
    const ms = Number(r.median_dwell_ms);
    return {
      lead: `${which} started at the ${name}${Number.isFinite(ms) ? ', where people look for a median of ' : '.'}`,
      strong: Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} seconds` : '',
      tail: `${Number.isFinite(ms) ? '. ' : ' '}${tail}`,
      alarm,
    };
  }
  const list = withCheckouts.map((r) => `${(PLACES[r.surface]?.name || r.surface).toLowerCase()} ${num(r.checkouts)}`).join(', ');
  return { lead: `Checkouts started at: ${list}.`, strong: '', tail: ` ${tail}`, alarm };
}

// ── The trial ───────────────────────────────────────────────────────────────

/** One running trial from admin_money_people's `trials`, as its card says it. */
export function trialCard(t, now = Date.now()) {
  const start = at(t?.started_at);
  const end = at(t?.ends_at);
  if (start == null || end == null || end <= start) return null;
  const length = Math.max(1, Math.round((end - start) / DAY));
  const f = Math.max(0, Math.min(1, (now - start) / (end - start)));
  const left = Math.max(0, Math.ceil((end - now) / DAY));
  const day = Math.max(1, Math.min(length, Math.floor((now - start) / DAY) + 1));
  const since = Math.max(0, daysAfter(t.started_at, now));
  const yearly = t.plan === 'annual' || t.plan === 'yearly';
  const back = num(t.days_back);
  return {
    who: t.email,
    plan: `${PLAN_NAME}, ${t.plan || 'monthly'} · ${formatMoney(t.amount_cents)} a month after the trial${yearly ? ', billed yearly' : ''}`,
    left: String(left),
    ends: `${plural(left, 'day')} left`,
    endsAt: `ends ${mdTime(t.ends_at, { weekday: true })}`,
    pct: r1(f * 100),
    day: `day ${day} of ${length}`,
    aria: `Trial day ${day} of ${length}, ${left} ${plural(left, 'day')} left`,
    startLabel: `${md(t.started_at)} · started`,
    endLabel: t.cancelling ? `${md(t.ends_at)} · ends, cancelling` : `${md(t.ends_at)} · first charge`,
    facts: [
      ['Cancelling', t.cancelling ? 'yes' : 'no'],
      ['Reminder email', t.reminder_at ? `sent ${md(t.reminder_at)}` : 'not sent yet'],
      ['Cards', `${fmt(num(t.cards))} · the free cap was ${fmt(num(t.cap))}`],
      ['Back since starting', since ? `${back} of ${since} ${plural(since, 'day')}${t.last_seen ? ` · last ${md(t.last_seen)}` : ''}` : 'started today'],
    ],
    trail: [
      t.hit_cap_at ? `${md(t.hit_cap_at)} hit the cap` : null,
      t.pressed_at ? 'Start trial' : null,
      t.checkout_at ? 'checkout' : null,
      'trialing',
    ].filter(Boolean),
  };
}

// ── Everyone who has hit the cap ────────────────────────────────────────────

const LIVE = ['active', 'trialing', 'past_due'];
// The answer to "why not", short enough for a badge.
const WHY_SHORT = {
  enough_room: 'enough room',
  price: 'the price',
  no_card: 'no card',
  unsure_value: 'unsure it is worth it',
  just_trying: 'just trying',
  other: 'other',
};

/** What happened after someone first hit the cap: the tag and its kind (pay, stay, early, gone). */
export function capNext(r, now = Date.now()) {
  if (r.checkout && r.sub_status === 'trialing') return { tag: 'In trial', kind: 'pay' };
  if (r.checkout && r.sub_status === 'active') return { tag: 'Paying', kind: 'pay' };
  if (r.checkout) return { tag: 'Stopped at checkout', kind: 'pay' };
  if (r.pressed) return { tag: 'Pressed, no checkout', kind: 'pay' };
  const back = num(r.days_back);
  const deleted = num(r.deleted_after);
  if (back > 0 && deleted > 0) return { tag: 'Made room, kept going', kind: 'stay' };
  if (back > 0) return { tag: 'Came back without deleting', kind: 'stay' };
  const since = daysAfter(r.first_hit, now);
  if (since != null && since <= 3) return { tag: 'Too early to tell', kind: 'early' };
  if (deleted > 0) return { tag: 'Deleted cards, not back', kind: 'gone' };
  return { tag: 'Not back since', kind: 'gone' };
}

/** One row of the cap table. */
export function capRow(r, now = Date.now()) {
  const cards = num(r.cards);
  const cap = num(r.cap);
  const refused = num(r.refused_most);
  const badges = [
    r.tier === 'paid' && !LIVE.includes(r.sub_status) ? 'comped' : null,
    r.why ? `said: ${WHY_SHORT[r.why] || r.why_label || r.why}` : null,
    refused > 1 ? `${fmt(refused)} refused at once` : null,
  ].filter(Boolean);
  const next = capNext(r, now);
  const dash = (v) => (num(v) ? fmt(num(v)) : '—');
  return {
    key: r.user_id || `${r.email}:${r.first_hit}`,
    email: r.email,
    badges,
    joined: md(r.joined_at),
    hit: md(r.first_hit),
    cards: `${fmt(cards)} · ${fmt(cap)}`,
    fill: cap ? Math.min(100, Math.round((cards / cap) * 100)) : 0,
    over: cap > 0 && cards > cap,
    closed: dash(r.closed_offer),
    pressed: !!r.pressed,
    checkout: !!r.checkout,
    deleted: dash(r.deleted_after),
    back: dash(r.days_back),
    last: md(r.last_seen),
    tag: next.tag,
    kind: next.kind,
  };
}

// ── The six figures ─────────────────────────────────────────────────────────

/**
 * The tiles. Money (mrr_cents) is admin_stats', what Stripe charges everyone;
 * every count of people follows the toggles (admin_money_people, the trial
 * funnel). A read that failed leaves its tiles at '—', never at zero.
 *
 * @param {object} stats        admin_stats (the shell's)
 * @param {object} people       admin_money_people
 * @param {object[]} trialRows  admin_trial_funnel
 * @param {number} now
 */
export function moneyTiles({ stats, people, trialRows, now = Date.now() } = {}) {
  const mrr = stats ? num(stats.mrr_cents) : null;
  const trials = people ? (people.trials || []) : null;
  const firstDue = (trials || []).filter((t) => !t.cancelling).map((t) => t.ends_at).filter((x) => at(x) != null).sort()[0];
  const paying = people ? num(people.paying) : null;
  const pastDue = people ? num(people.past_due) : 0;
  const eligible = trialRows ? (trialRows.find((r) => num(r.sort_order) === 1) || null) : null;
  const started = trialRows ? num(trialRows.find((r) => num(r.sort_order) === 3)?.people) : null;
  const near = people?.near_cap;

  const revenue = {
    key: 'mrr',
    label: 'Monthly revenue',
    value: mrr == null ? '—' : formatMoney(mrr),
    zero: !mrr,
    total: mrr == null ? '' : mrr ? 'a month' : 'nothing collected',
    sub: paying == null ? '' : paying ? `${fmt(paying)} paying ${plural(paying, 'subscription')}.` : 'No paying subscription yet.',
    verdict: mrr === 0 && firstDue ? `First charge due ${md(firstDue)}` : null,
    ratio: null,
  };

  let trial = { key: 'trial', label: 'In trial', value: '—', zero: false, total: '', sub: '', verdict: null, ratio: null };
  if (trials) {
    if (trials.length === 1) {
      const t = trials[0];
      const c = trialCard(t, now);
      trial = {
        ...trial,
        value: '1',
        total: `${PLAN_NAME} · ${t.plan || 'monthly'}`,
        sub: `${t.cancelling ? 'Cancelling.' : 'Not cancelling.'} ${formatMoney(t.amount_cents)} a month if it converts.`,
        ratio: c ? { pct: c.pct, label: c.day } : null,
      };
    } else if (trials.length > 1) {
      const cancelling = trials.filter((t) => t.cancelling).length;
      const sum = trials.filter((t) => !t.cancelling).reduce((a, t) => a + num(t.amount_cents), 0);
      trial = { ...trial, value: fmt(trials.length), total: PLAN_NAME, sub: `${cancelling} cancelling. ${formatMoney(sum)} a month if the rest convert.` };
    } else {
      trial = { ...trial, value: '0', zero: true, total: started == null ? '' : `ever: ${fmt(started)}`, sub: 'Nobody is on a trial right now.' };
    }
  }

  const payingTile = {
    key: 'paying',
    label: 'Paying',
    value: paying == null ? '—' : fmt(paying),
    zero: !paying,
    total: people ? `ever: ${fmt(num(people.paid_ever))}` : '',
    sub: paying == null ? ''
      : pastDue ? `${fmt(pastDue)} past due, a card failing.`
        : paying ? `${PLAN_NAME}, from Stripe.`
          : num(people.paid_ever) ? 'Nobody is paying right now.' : 'Nobody has been charged yet.',
    verdict: null,
    ratio: null,
  };

  const comped = {
    key: 'comped',
    label: 'Comped',
    value: people ? fmt(num(people.comped)) : '—',
    zero: people ? !num(people.comped) : false,
    total: people ? `${fmt(num(people.paid_plan))} on paid plans` : '',
    sub: 'On a paid plan without paying.',
    verdict: null,
    ratio: null,
  };

  const nearPeople = near ? num(near.people) : null;
  const nearActive = near ? num(near.active_7d) : 0;
  const nearTile = {
    key: 'near',
    label: 'At or near the cap',
    value: nearPeople == null ? '—' : fmt(nearPeople),
    zero: nearPeople === 0,
    total: near ? `${fmt(nearActive)} active in 7 days` : '',
    sub: `Free plan, holding ${Math.round(TRIAL_CAP_FRAC * 100)}% or more of their cap.`,
    verdict: null,
    ratio: nearPeople ? { pct: r1((nearActive / nearPeople) * 100), label: `${fmt(nearActive)} of ${fmt(nearPeople)} active in 7 days` } : null,
  };

  const couldTrial = {
    key: 'eligible',
    label: 'Could start a trial',
    value: eligible ? fmt(num(eligible.people)) : '—',
    zero: eligible ? !num(eligible.people) : false,
    total: 'never trialed',
    sub: `Free, with ${TRIAL_MIN_CARDS}+ cards or ${Math.round(TRIAL_CAP_FRAC * 100)}% of their cap.`,
    verdict: null,
    ratio: null,
  };

  return [revenue, trial, payingTile, comped, nearTile, couldTrial];
}

/** Days from the first price to today, inclusive: the window the Detail reads are asked for. */
export function sinceDays(path, now = Date.now()) {
  const d = daysAfter(path?.since, now);
  return d == null ? null : d + 1;
}
