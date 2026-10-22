// moneyView.test.mjs — what Analytics › Money says, against invented numbers.
//
//   node --test src/lib/moneyView.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PATH_BOX, biggestDrop, capNext, capRow, checkoutFoot, daysAfter, leakText, md, mdTime, moneySteps,
  moneyTiles, offerRows, pathGeometry, pathList, pathTip, placementRows, placementsFoot, reasonRows,
  routesLine, sinceDays, stepRate, trialCard, trialOnButtonRows,
} from './moneyView.js';
import { CREATOR_TRIAL_DAYS, CTA } from './billingCopy.js';
import { TRIAL_CAP_FRAC, TRIAL_MIN_CARDS } from './creatorTrial.js';

const NOW = Date.parse('2026-03-20T12:00:00Z');

// An admin_money_path payload. Every number here is invented.
const PATH = {
  since: '2026-01-05T10:00:00Z',
  steps: {
    saw: 240, pressed: 6, pressed_trial: 6, checkout: 5, finished: 3, started: 3, started_trial: 3, paid: 1,
    first_pressed: '2026-02-03T09:00:00Z', first_finished: '2026-02-04T09:00:00Z', first_paid: '2026-02-18T09:00:00Z',
    trial_running: 2, trial_cancelling: 0, trial_ends: '2026-03-28T08:30:00Z', trial_ended_unpaid: 0,
    checkout_error_people: 1,
  },
  routes: { wall: { people: 40, pressed: 6 }, button: { people: 90, pressed: 0 }, elsewhere: { people: 120, pressed: 0 }, both: 10 },
  offer: {
    since: '2026-01-20T00:00:00Z',
    times: 400,
    people: 120,
    outcomes: {
      dismiss: { times: 360, people: 100 },
      hidden: { times: 20, people: 15 },
      invite_alt: { times: 14, people: 12 },
      cta: { times: 6, people: 6 },
    },
    dismiss_methods: { x: 250, backdrop: 60, maybe_later: 30, nav: 12, esc: 8 },
    trial_on_button: {
      since: '2026-02-01T00:00:00Z', times: 70, people: 30, pressed: 6,
      pressed_first: '2026-02-03T09:00:00Z', pressed_last: '2026-02-26T09:00:00Z',
    },
    reasons: {
      since: '2026-02-10T00:00:00Z', shown: 20, answered: 8,
      choices: [
        { choice: 'price', label: 'The price', n: 5 },
        { choice: 'enough_room', label: 'The free plan is enough for me', n: 3 },
      ],
    },
  },
};

test('dates read in UTC', () => {
  assert.equal(md('2026-03-01T00:30:00Z'), 'Mar 1');
  assert.equal(md('2026-02-28T23:59:00-05:00'), 'Mar 1');
  assert.equal(md('2026-03-01'), 'Mar 1');
  assert.equal(md(null), '');
  assert.equal(mdTime('2026-03-28T08:30:00Z', { weekday: true }), 'Sat Mar 28, 08:30 UTC');
  assert.equal(daysAfter('2026-03-16T23:00:00Z', NOW), 4);
  assert.equal(sinceDays(PATH, NOW), 75);
  assert.equal(sinceDays({}, NOW), null);
});

test('the steps are the nested path, named by what happened', () => {
  const s = moneySteps(PATH);
  assert.deepEqual(s.map((x) => x.key), ['saw', 'pressed', 'checkout', 'finished', 'started', 'paid']);
  assert.deepEqual(s.map((x) => x.n), [240, 6, 5, 3, 3, 1]);
  for (let i = 1; i < s.length; i += 1) assert.ok(s[i].n <= s[i - 1].n, `${s[i].key} is never larger than ${s[i - 1].key}`);
  assert.equal(s[1].label, 'Pressed Start trial', 'every press offered the trial');
  assert.equal(s[1].note, 'first on Feb 3');
  assert.match(s[1].def, new RegExp(`${CREATOR_TRIAL_DAYS}-day trial`));
  assert.equal(s[3].note, 'first Feb 4');
  assert.equal(s[4].label, 'Started the trial');
  assert.equal(s[4].note, '2 running · first ends Mar 28');
  assert.equal(s[5].note, 'first Feb 18');
  assert.equal(s[5].pending, false);
  assert.deepEqual(moneySteps(null), []);
});

test('a press that was not always the trial is named for the button, and an unpaid trial is pending', () => {
  const s = moneySteps({ steps: { ...PATH.steps, pressed_trial: 4, started_trial: 2, paid: 0, first_paid: null, trial_running: 1 } });
  assert.equal(s[1].label, 'Pressed the Creator button');
  assert.equal(s[4].label, 'Started Creator');
  assert.equal(s[4].note, 'running · ends Mar 28');
  assert.equal(s[5].pending, true);
  assert.equal(s[5].note, 'first charge Mar 28');
  assert.match(s[5].def, /the first charge is due Mar 28, 08:30 UTC\.$/);
  // Every running trial cancelling: nothing is due.
  const c = moneySteps({ steps: { ...PATH.steps, paid: 0, trial_running: 1, trial_cancelling: 1 } });
  assert.equal(c[5].pending, false);
  assert.equal(c[5].note, 'nobody yet');
  // Nobody past the price.
  const z = moneySteps({ steps: { saw: 12 } });
  assert.equal(z[1].label, 'Pressed the Creator button');
  assert.equal(z[1].note, 'nobody yet');
  assert.equal(z[4].note, 'nobody yet');
});

test('the chips between steps', () => {
  const s = moneySteps(PATH);
  assert.equal(stepRate(s[0], s[1]), '2.5%');
  assert.equal(stepRate(s[1], s[2]), '83%');
  assert.equal(stepRate(s[3], s[4]), '100%');
  assert.equal(stepRate({ n: 0 }, { n: 0 }), '—');
  assert.equal(stepRate({ n: 2 }, { n: 0, pending: true }), 'not yet');
  assert.equal(stepRate({ n: 2 }, { n: 0 }), '0%');
});

test('the biggest drop, and none when nobody is lost', () => {
  assert.deepEqual(biggestDrop(moneySteps(PATH)), { at: 0, lost: 234 });
  assert.equal(biggestDrop([{ n: 3 }, { n: 3 }]), null);
  assert.equal(biggestDrop([]), null);
});

test('the geometry: one bar per step, heights never rising, everything inside the box', () => {
  const s = moneySteps(PATH);
  const g = pathGeometry(s);
  assert.equal(g.bars.length, 6);
  assert.equal(g.ribs.length, 5);
  assert.equal(g.convs.length, 5);
  assert.equal(g.hits.length, 6);
  assert.equal(g.zeros.length, 0);
  assert.equal(g.labWidth, 15.8);
  const tops = g.bars.map((b) => Number(/V([\d.]+)Q/.exec(b.d)[1]));
  for (let i = 1; i < tops.length; i += 1) assert.ok(tops[i] >= tops[i - 1], 'a later bar never stands taller');
  for (const t of [...g.nums, ...g.labs, ...g.convs]) {
    assert.ok(t.lx >= 0 && t.lx <= 100 && t.ly >= 0 && t.ly <= 100, `${t.label} sits inside the box`);
  }
  assert.ok(g.ribs[0].lost, 'the big drop has a hatched wedge');
  assert.equal(g.ribs[3].lost, '', 'no wedge where nobody is lost');
  assert.equal(pathGeometry([]), null);
  // A zero gets a dashed outline instead of a bar.
  const z = pathGeometry(moneySteps({ steps: { ...PATH.steps, paid: 0 } }));
  assert.equal(z.bars[5].d, '');
  assert.equal(z.zeros.length, 1);
  assert.equal(z.nums[5].zero, true);
});

test('the callout sits beside a drop from the tallest bar, above a drop from a short one, under the chart otherwise', () => {
  const beside = pathGeometry(moneySteps(PATH)).leak;
  assert.equal(beside.mode, 'beside');
  assert.equal(beside.at, 0);
  const { W, bw } = PATH_BOX;
  const cw = W / 6;
  const xl = cw + (cw - bw) / 2;
  assert.ok(beside.lx * 10 > xl, 'beside starts right of the wedge');
  assert.match(beside.leader, /^M[\d.]+,[\d.]+H[\d.]+$/, 'a level leader back into the hatch');

  // The mockup's shape: a first drop, then a bigger one from a shorter bar.
  const steps = [240, 130, 6, 5, 3, 1].map((n, i) => ({ key: `s${i}`, label: `S${i}`, n }));
  const above = pathGeometry(steps).leak;
  assert.equal(above.mode, 'above');
  assert.equal(above.at, 1);
  assert.match(above.leader, /^M[\d.]+,[\d.]+V[\d.]+$/, 'a leader dropping into the hatch');

  // A drop between two tall bars leaves no room on either side.
  const tight = [240, 200, 190, 185, 180, 179].map((n, i) => ({ key: `s${i}`, label: `S${i}`, n }));
  assert.equal(pathGeometry(tight).leak.mode, 'under');
  assert.equal(pathGeometry([3, 3].map((n, i) => ({ key: `s${i}`, n }))).leak, null);
});

test('hovering a step: the card never leaves the box', () => {
  const s = moneySteps(PATH);
  assert.equal(pathTip(s, null), null);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((i) => pathTip(s, i).side),
    ['start', 'start', 'mid', 'mid', 'end', 'end'],
  );
  const t = pathTip(s, 2);
  assert.equal(t.of, 'of 6 at the step before');
  assert.equal(pathTip(s, 0).of, 'people');
  assert.equal(pathGeometry(s, { hov: 2 }).bars.filter((b) => b.dim).length, 5);
  assert.deepEqual(pathGeometry(s, { hov: 2 }).hl, { x: 337.3, w: 158.7 });
});

test('the narrow list says the same thing', () => {
  const l = pathList(moneySteps(PATH));
  assert.equal(l[0].conv, 'everyone counted here · any plan picker');
  assert.equal(l[1].conv, '2.5% of the step before · first on Feb 3');
  assert.equal(l[1].pct, 2.5);
  const pending = pathList(moneySteps({ steps: { ...PATH.steps, paid: 0 } }));
  assert.equal(pending[5].conv, 'not yet: the trial is still running · first charge Mar 28');
});

test('the callout over the biggest drop', () => {
  const s = moneySteps(PATH);
  assert.deepEqual(leakText(s, PATH), {
    title: '234 of the 240 stop here.',
    body: 'They opened the plans and closed them. The first press was Feb 3, and all 6 came through the cap wall.',
  });
  const one = { ...PATH, steps: { ...PATH.steps, pressed: 1, pressed_trial: 1, checkout: 1, finished: 1, started: 1, started_trial: 1, paid: 0 }, routes: { ...PATH.routes, wall: { people: 40, pressed: 1 } } };
  assert.match(leakText(moneySteps(one), one).body, /The first press was Feb 3, through the cap wall\.$/);
  const mixed = { ...PATH, routes: { ...PATH.routes, wall: { people: 40, pressed: 4 }, button: { people: 90, pressed: 2 } } };
  assert.match(leakText(moneySteps(mixed), mixed).body, /The first press was Feb 3\.$/);
  const none = { steps: { saw: 30 } };
  assert.equal(leakText(moneySteps(none), none).body, 'They opened the plans and closed them. Nobody has pressed the button yet.');
  assert.equal(leakText([{ n: 2 }, { n: 2 }], PATH), null);
  // Only the unpaid trials left: they are waiting, not lost.
  const waiting = [{ key: 'a', n: 2 }, { key: 'paid', n: 0, pending: true }];
  assert.equal(leakText(waiting, PATH).title, '2 of the 2 have not paid yet.');
});

test('routes and the checkout foot', () => {
  const r = routesLine(PATH);
  assert.deepEqual(r.parts.map((p) => [p.key, p.people, p.pressed]), [['wall', 40, 6], ['button', 90, 0], ['elsewhere', 120, 0]]);
  assert.equal(r.both, 10);
  assert.equal(routesLine({}), null);
  const s = moneySteps(PATH);
  assert.deepEqual(checkoutFoot(s, PATH, { stalled: 2 }), {
    lead: 'The hatched wedge after each step is the people who stopped there.',
    claim: 'Checkout is not where they are lost:',
    facts: '5 opened it, 3 finished, 1 error, 2 stalled.',
  });
  assert.equal(checkoutFoot(s, PATH, null).facts, '5 opened it, 3 finished, 1 error.', 'a failed reliability read says nothing about stalls');
  const lostAtStripe = [10, 9, 8, 2, 2, 1].map((n, i) => ({ key: ['saw', 'pressed', 'checkout', 'finished', 'started', 'paid'][i], n }));
  assert.equal(checkoutFoot(lostAtStripe, PATH, null).claim, 'Checkout is where they are lost:');
  assert.equal(checkoutFoot([], { steps: { checkout: 0 } }, null).claim, 'Nobody has opened checkout yet.');
});

test('what they did with the offer: shares of every exposure, the button last', () => {
  const rows = offerRows(PATH.offer);
  assert.deepEqual(rows.map((r) => r.key), ['dismiss', 'hidden', 'invite_alt', 'cta']);
  assert.equal(rows[0].note, 'by 100 people, 3.6 times each on average');
  assert.deepEqual(rows[0].segs.map((g) => g.pct), [62.5, 15, 7.5, 3, 2]);
  assert.equal(rows[0].segs.reduce((a, g) => a + g.pct, 0), 90, 'the closes fill their share of every exposure');
  assert.equal(rows[1].unit, 'times · 15 people');
  assert.equal(rows[3].on, true);
  assert.equal(rows[3].segs[0].pct, 1.5);
  assert.deepEqual(offerRows({ times: 0 }), []);
  const odd = offerRows({ times: 10, outcomes: { dismiss: { times: 8, people: 8 }, mystery: { times: 2, people: 1 } }, dismiss_methods: { x: 6, swipe: 2 } });
  assert.deepEqual(odd.map((r) => r.key), ['dismiss', 'other']);
  assert.equal(odd[0].note, 'by 8 people');
  assert.equal(odd[0].segs.at(-1).title, 'some other way: 2');
});

test('the trial on the button, and the answers to why not', () => {
  const t = trialOnButtonRows(PATH.offer.trial_on_button);
  assert.equal(t[0].label, `Saw “${CTA.tryCreatorShort}” on the button`);
  assert.equal(t[0].note, '70 times in all');
  assert.equal(t[1].note, 'all in February');
  assert.equal(t[1].pct, 20);
  const two = trialOnButtonRows({ people: 10, times: 12, pressed: 2, pressed_first: '2026-02-03T00:00:00Z', pressed_last: '2026-02-20T00:00:00Z' });
  assert.equal(two[1].note, 'both in February');
  const span = trialOnButtonRows({ people: 10, times: 12, pressed: 3, pressed_first: '2026-01-30T00:00:00Z', pressed_last: '2026-02-20T00:00:00Z' });
  assert.equal(span[1].note, 'Jan 30 to Feb 20');
  assert.equal(trialOnButtonRows({ people: 10, times: 12, pressed: 0 })[1].note, 'nobody yet');
  assert.deepEqual(trialOnButtonRows({ people: 0 }), []);
  const why = reasonRows(PATH.offer.reasons);
  assert.deepEqual(why.map((r) => [r.label, r.value, r.pct]), [['The price', '5', 62.5], ['The free plan is enough for me', '3', 37.5]]);
});

test('every place the offer opens', () => {
  const rows = [
    { surface: 'Settings', sort_order: 6, exposures: 30, people: 20, median_dwell_ms: 9000, read_feature: 9, toggled_plan: 5, cta: 0, checkouts: 0, trials: 0 },
    { surface: 'Cap wall', sort_order: 1, exposures: 200, people: 30, median_dwell_ms: 2100, read_feature: 12, toggled_plan: 2, cta: 5, checkouts: 5, trials: 3 },
    { surface: 'Public pricing page', sort_order: 8, exposures: 120, people: 0, median_dwell_ms: 7000, read_feature: 14, toggled_plan: 9, cta: 0, checkouts: 0, trials: 0 },
    { surface: 'Something new', sort_order: 9, exposures: 4, people: 3, median_dwell_ms: null, read_feature: 0, toggled_plan: 0, cta: 0, checkouts: 0, trials: 0 },
  ];
  const p = placementRows(rows);
  assert.deepEqual(p.map((r) => r.name), ['Cap wall', 'Settings', 'Pricing page, signed out', 'Something new']);
  assert.equal(p[0].pct, 100);
  assert.equal(p[0].on, true);
  assert.equal(p[0].look, '2.1 s');
  assert.equal(p[2].people, null, 'visitors are not people yet');
  assert.equal(p[2].cta, null);
  assert.equal(p[3].look, '—');
  assert.deepEqual(placementsFoot(rows), {
    lead: 'All 5 checkouts started at the cap wall, where people look for a median of ',
    strong: '2.1 seconds',
    tail: '. A look is how long the offer stayed open.',
    alarm: '',
  });
  // A failure that was our checkout's configuration is named, never folded in.
  assert.equal(placementsFoot([{ ...rows[1], config_errors: 2 }, { ...rows[0], config_errors: 1 }]).alarm,
    ' 3 checkout failures were our configuration, not the person.');
  assert.equal(placementsFoot([{ ...rows[0], config_errors: 1 }]).alarm,
    ' 1 checkout failure was our configuration, not the person.');
  assert.equal(placementsFoot([{ ...rows[1], checkouts: 2 }]).lead.startsWith('Both checkouts'), true);
  assert.equal(placementsFoot([{ ...rows[1], checkouts: 1 }]).lead.startsWith('The one checkout'), true);
  assert.equal(placementsFoot([{ ...rows[1], checkouts: 2 }, { ...rows[0], checkouts: 1 }]).lead, 'Checkouts started at: cap wall 2, settings 1.');
  assert.equal(placementsFoot([]).lead, 'No checkout has opened from any of these yet.');
});

const TRIAL = {
  user_id: 't1', email: 'someone@example.com', plan: 'monthly', amount_cents: 2500, cancelling: false,
  started_at: '2026-03-16T08:30:00Z', ends_at: '2026-03-30T08:30:00Z', reminder_at: null,
  cards: 180, cap: 75, days_back: 3, last_seen: '2026-03-20',
  hit_cap_at: '2026-03-16T08:00:00Z', pressed_at: '2026-03-16T08:20:00Z', checkout_at: '2026-03-16T08:21:00Z',
};

test('a running trial, as its card says it', () => {
  const c = trialCard(TRIAL, NOW);
  assert.equal(c.left, '10');
  assert.equal(c.ends, 'days left');
  assert.equal(c.endsAt, 'ends Mon Mar 30, 08:30 UTC');
  assert.equal(c.day, 'day 5 of 14');
  assert.equal(c.pct, 29.6);
  assert.equal(c.plan, 'Creator, monthly · $25 a month after the trial');
  assert.deepEqual(c.facts, [
    ['Cancelling', 'no'],
    ['Reminder email', 'not sent yet'],
    ['Cards', '180 · the free cap was 75'],
    ['Back since starting', '3 of 4 days · last Mar 20'],
  ]);
  assert.deepEqual(c.trail, ['Mar 16 hit the cap', 'Start trial', 'checkout', 'trialing']);
  assert.equal(trialCard({ ...TRIAL, cancelling: true }, NOW).endLabel, 'Mar 30 · ends, cancelling');
  assert.equal(trialCard({ ...TRIAL, hit_cap_at: null, pressed_at: null }, NOW).trail.join(' > '), 'checkout > trialing');
  assert.equal(trialCard({ ...TRIAL, ends_at: null }, NOW), null);
  assert.equal(trialCard({ ...TRIAL, plan: 'annual', amount_cents: 2000 }, NOW).plan, 'Creator, annual · $20 a month after the trial, billed yearly');
});

const HIT = {
  user_id: 'u1', email: 'a@example.com', joined_at: '2026-03-01T00:00:00Z', first_hit: '2026-03-02T00:00:00Z',
  cap: 50, cards: 50, tier: 'demo', sub_status: null, closed_offer: 2, pressed: false, checkout: false,
  why: null, why_label: null, deleted_after: 0, refused_most: 1, days_back: 0, last_seen: '2026-03-02',
};

test('what happened after the cap', () => {
  const tag = (o) => capNext({ ...HIT, ...o }, NOW).tag;
  assert.equal(tag({ checkout: true, pressed: true, sub_status: 'trialing', tier: 'paid' }), 'In trial');
  assert.equal(tag({ checkout: true, pressed: true, sub_status: 'active', tier: 'paid' }), 'Paying');
  assert.equal(tag({ checkout: true, pressed: true }), 'Stopped at checkout');
  assert.equal(tag({ pressed: true }), 'Pressed, no checkout');
  assert.equal(tag({ deleted_after: 4, days_back: 2 }), 'Made room, kept going');
  assert.equal(tag({ days_back: 2 }), 'Came back without deleting');
  assert.equal(tag({ first_hit: '2026-03-17T23:00:00Z' }), 'Too early to tell');
  assert.equal(tag({ first_hit: '2026-03-16T23:00:00Z' }), 'Not back since');
  assert.equal(tag({ deleted_after: 4 }), 'Deleted cards, not back');
  assert.equal(capNext({ ...HIT, days_back: 2 }, NOW).kind, 'stay');
});

test('a row of the cap table', () => {
  const r = capRow(HIT, NOW);
  assert.equal(r.cards, '50 · 50');
  assert.equal(r.fill, 100);
  assert.equal(r.over, false);
  assert.equal(r.closed, '2');
  assert.equal(r.deleted, '—');
  assert.equal(r.back, '—');
  assert.deepEqual(r.badges, []);
  const comped = capRow({ ...HIT, tier: 'paid', cards: 90, cap: 75, why: 'enough_room', refused_most: 40 }, NOW);
  assert.deepEqual(comped.badges, ['comped', 'said: enough room', '40 refused at once']);
  assert.equal(comped.over, true);
  assert.equal(comped.fill, 100);
  assert.deepEqual(capRow({ ...HIT, tier: 'paid', sub_status: 'trialing' }, NOW).badges, [], 'a trial is not a comp');
  assert.equal(capRow({ ...HIT, cards: 0 }, NOW).fill, 0);
});

const PEOPLE = {
  near_cap: { people: 40, active_7d: 10 }, paid_plan: 7, paying: 0, past_due: 0, comped: 5, paid_ever: 0, trials: [TRIAL],
};
const TRIAL_ROWS = [
  { stage: 'Eligible for the trial today', sort_order: 1, people: 150 },
  { stage: 'Asked for it', sort_order: 2, people: 6 },
  { stage: 'Started one', sort_order: 3, people: 3 },
];

test('the six figures', () => {
  const t = moneyTiles({ stats: { mrr_cents: 0 }, people: PEOPLE, trialRows: TRIAL_ROWS, now: NOW });
  assert.deepEqual(t.map((x) => x.key), ['mrr', 'trial', 'paying', 'comped', 'near', 'eligible']);
  assert.deepEqual([t[0].value, t[0].total, t[0].sub, t[0].verdict], ['$0', 'nothing collected', 'No paying subscription yet.', 'First charge due Mar 30']);
  assert.deepEqual([t[1].value, t[1].total, t[1].sub], ['1', 'Creator · monthly', 'Not cancelling. $25 a month if it converts.']);
  assert.deepEqual(t[1].ratio, { pct: 29.6, label: 'day 5 of 14' });
  assert.deepEqual([t[2].value, t[2].total, t[2].sub], ['0', 'ever: 0', 'Nobody has been charged yet.']);
  assert.deepEqual([t[3].value, t[3].total], ['5', '7 on paid plans']);
  assert.deepEqual([t[4].value, t[4].total, t[4].ratio], ['40', '10 active in 7 days', { pct: 25, label: '10 of 40 active in 7 days' }]);
  assert.equal(t[4].sub, `Free plan, holding ${TRIAL_CAP_FRAC * 100}% or more of their cap.`);
  assert.deepEqual([t[5].value, t[5].sub], ['150', `Free, with ${TRIAL_MIN_CARDS}+ cards or ${TRIAL_CAP_FRAC * 100}% of their cap.`]);
});

test('a failed read leaves its tiles blank, never zero', () => {
  const t = moneyTiles({ stats: null, people: null, trialRows: null, now: NOW });
  assert.deepEqual(t.map((x) => x.value), ['—', '—', '—', '—', '—', '—']);
  assert.ok(t.every((x) => !x.verdict && !x.ratio));
  const paying = moneyTiles({ stats: { mrr_cents: 5000 }, people: { ...PEOPLE, paying: 2, paid_ever: 3, trials: [] }, trialRows: TRIAL_ROWS, now: NOW });
  assert.deepEqual([paying[0].value, paying[0].total, paying[0].sub, paying[0].verdict], ['$50', 'a month', '2 paying subscriptions.', null]);
  assert.deepEqual([paying[1].value, paying[1].total, paying[1].sub], ['0', 'ever: 3', 'Nobody is on a trial right now.']);
  const pastDue = moneyTiles({ stats: { mrr_cents: 0 }, people: { ...PEOPLE, past_due: 1, paid_ever: 1 }, trialRows: TRIAL_ROWS, now: NOW });
  assert.equal(pastDue[2].sub, '1 past due, a card failing.');
});

test('the thresholds come from the code that enforces them, never typed here', () => {
  const src = readFileSync(new URL('./moneyView.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\b13\+|\b80%|\b14-day|\$25|\b50 cards/, 'no limit or price is a literal');
  assert.match(src, /import \{ TRIAL_CAP_FRAC, TRIAL_MIN_CARDS \} from '\.\/creatorTrial\.js';/);
  assert.match(src, /import \{ CTA, CREATOR_TRIAL_DAYS, PLAN_NAME \} from '\.\/billingCopy\.js';/);
});
