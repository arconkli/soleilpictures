import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sourcesWindow, sourceReturn, moneyTiles, moneyLadder, moneyReasons, trialModel, capModel,
  shareTiles, shareChart, shareRouteRows, inviteLine, problemsModel, emailName, emailsModel, CROWD_MAX,
} from './phonePageModels.js';

const NOW = Date.UTC(2026, 10, 4, 15, 0, 0); // Wed Nov 4 2026
const label = (t) => ({ google: 'Google', direct: 'Direct' }[t] || t);
const BAD = /NaN|undefined|Infinity/;
const flat = (o) => JSON.stringify(o);

// ── Sources ──
test('sourcesWindow: top seven plus a rest row, total from the same window', () => {
  const acq = Array.from({ length: 9 }, (_, i) => ({ source: `s${i}`, signups: 20 - i }));
  const m = sourcesWindow(acq, 30, label);
  assert.equal(m.items.length, 8);
  assert.equal(m.items.at(-1).label, '2 smaller sources');
  assert.equal(m.total, acq.reduce((s, r) => s + r.signups, 0));
  assert.equal(m.pctTotal, m.total);
  assert.match(m.readout.label, /in 30 days/);
});
test('sourcesWindow: under 15 signups has no percentage total', () => {
  const m = sourcesWindow([{ source: 'google', signups: 9 }, { source: 'direct', signups: 3 }], 7, label);
  assert.equal(m.total, 12);
  assert.equal(m.pctTotal, null);
  assert.match(m.dek, /Too few/);
  assert.match(m.readout.label, /7 days/);
});
test('sourcesWindow: null, empty and junk rows', () => {
  assert.equal(sourcesWindow(null, 7), null);
  assert.equal(sourcesWindow(undefined, 7), null);
  const e = sourcesWindow([], 7);
  assert.equal(e.total, 0);
  assert.deepEqual(e.items, []);
  assert.equal(e.label, '');
  assert.equal(sourcesWindow([{ source: 'x', signups: null }, null], 7).total, 0);
});

test('sourceReturn: only source rows; counts under 15, rates with size from 15', () => {
  const m = sourceReturn([
    { dim: 'all', n: 500, returned: 200 },
    { dim: 'source:google', n: 66, returned: 17 },
    { dim: 'source:share', n: 12, returned: 9 },
    { dim: 'source:direct', n: 0, returned: 0 },
    { dim: 'band:0', n: 58, returned: 5 },
  ]);
  assert.deepEqual(m.items.map((i) => i.key), ['google', 'share', 'direct']);
  const g = m.items[0];
  assert.equal(g.label, 'Google');
  assert.equal(g.text, '26%');
  assert.equal(g.sub, 'of 66');
  const s = m.items[1];
  assert.equal(s.label, 'Shared link');
  assert.equal(s.text, '9 of 12');
  assert.equal(s.sub, '');
  assert.equal(m.items[2].text, '–'); // nobody in the group: a dash, never 0%
  assert.equal(g.frac, 1); // the only group big enough for a rate sets the scale
  assert.equal(s.frac, 0); // under 15: a count and no bar
  assert.match(m.caption, /different group from Figure 1/);
  assert.match(m.caption, /Aug 17, 2026/);
  assert.doesNotMatch(flat(m), BAD);
});
test('sourceReturn: a small group draws no bar and does not set the scale', () => {
  const m = sourceReturn([
    { dim: 'source:share', n: 10, returned: 4 },
    { dim: 'source:google', n: 31, returned: 12 },
  ]);
  const share = m.items.find((i) => i.key === 'share');
  const google = m.items.find((i) => i.key === 'google');
  assert.equal(share.text, '4 of 10'); // 40% is the higher rate, but only 10 people
  assert.equal(share.frac, 0);
  assert.equal(google.frac, 1);
});
test('sourceReturn: a real zero return stays 0, junk and null are safe', () => {
  const m = sourceReturn([{ dim: 'source:reddit', n: 40, returned: 0 }, { dim: 'source:other', n: 20, returned: null }]);
  assert.equal(m.items[0].text, '0%');
  assert.equal(m.items[1].text, '–');
  assert.equal(sourceReturn(null), null);
  assert.deepEqual(sourceReturn([{ dim: 'all', n: 3, returned: 1 }]).items, []);
  assert.equal(sourceReturn([{ dim: 'source:seo', n: 20, returned: 5 }]).items[0].label, 'SEO pages');
});

// ── Money ──
test('moneyTiles: dollars, counts, first paid date, comped line, dashes while loading', () => {
  const m = moneyTiles({
    stats: { mrr_cents: 312450 },
    moneyPeople: { paying: 136, trial_count: 4, past_due: 0, comped: 5 },
    moneyPath: { steps: { first_paid: '2026-06-24T10:00:00Z' } },
  });
  assert.deepEqual(m.tiles.map((t) => t.value), ['$3,125', '136', '4', '0']);
  assert.equal(m.tiles[1].sub, 'first paid Jun 24');
  assert.equal(m.comped, '5 more accounts have paid features for free.');
  assert.match(m.mrrNote, /team/);
  const none = moneyTiles({});
  assert.deepEqual(none.tiles.map((t) => t.value), ['–', '–', '–', '–']);
  assert.equal(none.comped, '');
  assert.doesNotMatch(flat(none), BAD);
});
test('moneyTiles: nobody has paid -> no first paid text; one comped account', () => {
  const m = moneyTiles({ stats: { mrr_cents: 0 }, moneyPeople: { paying: 0, trial_count: 1, past_due: 0, comped: 1 }, moneyPath: { steps: { first_paid: null } } });
  assert.equal(m.tiles[0].value, '$0');
  assert.equal(m.tiles[1].value, '0');
  assert.equal(m.tiles[1].sub, '');
  assert.equal(m.comped, '1 more account has paid features for free.');
  assert.equal(moneyTiles({ moneyPeople: { comped: 0 } }).comped, '');
});
test('moneyLadder: five steps in order with a since date; null and empty', () => {
  const m = moneyLadder({ since: '2026-06-01T18:00:00Z', steps: { saw: 100, pressed: 20, checkout: 12, finished: 9, started: 8, paid: 0 } });
  assert.deepEqual(m.steps.map((s) => s.n), [100, 20, 12, 8, 0]);
  assert.equal(m.steps.at(-1).n, 0); // a real zero stays
  assert.match(m.caption, /since Jun 1/);
  assert.match(m.caption, /Under 15/);
  assert.equal(moneyLadder(null), null);
  assert.equal(moneyLadder({ steps: {} }), null);
  assert.equal(moneyLadder({ steps: { saw: 5 } }).caption.startsWith('Under 15'), true);
});
test('moneyReasons: short labels, sorted, no percentages under 15 answers', () => {
  const path = {
    offer: {
      people: 80, times: 210, outcomes: { dismiss: { people: 60 } },
      reasons: { since: '2026-10-21T00:00:00Z', answered: 12, choices: [{ choice: 'price', label: 'The price', n: 3 }, { choice: 'enough_room', label: 'The free plan is enough for me', n: 9 }, { choice: 'weird', label: 'Weird one', n: 0 }] },
    },
  };
  const m = moneyReasons(path);
  assert.deepEqual(m.items.map((i) => i.label), ['Enough room', 'The price', 'Weird one']);
  assert.equal(m.total, null);
  assert.match(m.dek, /12 answers, too few for percentages/);
  assert.match(m.caption, /80 people saw an offer 210 times; 60 closed it/);
  assert.match(m.caption, /since Oct 21/);
  path.offer.reasons.answered = 61;
  assert.equal(moneyReasons(path).total, 61);
});
test('moneyReasons: the offer sentence names its window when offer.since parses', () => {
  const reasons = { since: '2026-10-21T00:00:00Z', answered: 3, choices: [{ choice: 'price', n: 3 }] };
  const m = moneyReasons({ offer: { since: '2026-10-22T05:00:00Z', people: 880, times: 2930, outcomes: { dismiss: { people: 760 } }, reasons } });
  assert.match(m.caption, /^Since Oct 22, 880 people saw an offer 2,930 times; 760 closed it\./);
  const bad = moneyReasons({ offer: { since: 'nope', people: 880, times: 2930, reasons } });
  assert.match(bad.caption, /^880 people saw an offer 2,930 times\./);
});
test('moneyReasons: no dismiss key, no reasons, null', () => {
  const m = moneyReasons({ offer: { people: 1, times: 1, reasons: { since: null, answered: 1, choices: [{ choice: 'other', n: 1 }] } } });
  assert.equal(m.caption.includes('closed it'), false);
  assert.match(m.caption, /1 person saw an offer 1 time\./);
  assert.equal(moneyReasons({ offer: { reasons: { choices: [] } } }), null);
  assert.equal(moneyReasons(null), null);
});
test('trialModel: stages 1, 2, 3, 5 renamed; counts only; real zero kept; missing stage left out', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((o, i) => ({ stage: `Stage ${o}`, sort_order: o, people: [410, 260, 166, 4, 0, 18][i] }));
  const m = trialModel(rows);
  assert.deepEqual(m.items.map((i) => [i.label, i.n]), [['Could try it today', 410], ['Asked for a trial', 260], ['Started one', 166], ['Went on to pay', 0]]);
  assert.match(m.caption, /not steps/);
  const part = trialModel([{ sort_order: 1, people: 5 }, { sort_order: 5, people: null }]);
  assert.equal(part.items.length, 1);
  assert.equal(trialModel([]), null);
  assert.equal(trialModel(null), null);
});
test('capModel: split of active and not, since date, invalid input', () => {
  const m = capModel({ near_cap: { people: 212, active_7d: 61 }, cap_hits: { since: '2026-08-12T00:00:00Z', people: 15 } });
  assert.deepEqual(m.parts.map((p) => p.n), [61, 151]);
  assert.match(m.caption, /15 people have hit the limit since Aug 12/);
  assert.match(m.dek, /61 of 212/);
  assert.equal(m.dek, '61 of 212 people near it were here in the last 7 days.');
  assert.equal(capModel({ near_cap: { people: 9, active_7d: 2 } }).dek, '2 of 9 people near it were here in the last 7 days.');
  const none = capModel({ near_cap: { people: 9, active_7d: 0 }, cap_hits: { since: null, people: 0 } });
  assert.deepEqual(none.parts.map((p) => p.n), [0, 9]);
  assert.match(none.caption, /0 people have hit the limit\./);
  assert.equal(capModel({ near_cap: { people: 3, active_7d: 5 } }), null);
  assert.equal(capModel({}), null);
  assert.equal(capModel(null), null);
});

// ── Sharing ──
const sharing = () => ({
  totals: { shares: 220, sharers: 74, seen: 830, signed_up: 41, made_something: 0 },
  weekly: [
    { week: '2026-10-05', signed_up: 3 }, { week: '2026-10-12', signed_up: 4 }, { week: '2026-10-19', signed_up: 2 },
    { week: '2026-10-26', signed_up: 5 }, { week: '2026-11-02', signed_up: 9 },
  ],
  routes: [
    { route: 'edit_link', shared: 52, seen: 96, signed_up: 12 },
    { route: 'email_invite', shared: 66, seen: 0, signed_up: 21 },
    { route: 'view_link', shared: 84, seen: 0, signed_up: 0 },
    { route: 'mystery_route', shared: 4, seen: 3, signed_up: null },
  ],
});
test('shareTiles: four tiles, a real 0 stays 0, missing is a dash', () => {
  const t = shareTiles(sharing());
  assert.deepEqual(t.map((x) => x.value), ['220', '830', '41', '0']);
  assert.equal(t[0].sub, 'by 74 people');
  assert.match(t[1].label, /devices/);
  assert.deepEqual(shareTiles({}), []);
  assert.equal(shareTiles({ totals: { shares: null } })[0].value, '–');
});
test('shareChart: open week hollow with a readout; x labels are short dates', () => {
  const c = shareChart(sharing(), NOW);
  assert.equal(c.bars.at(-1).open, true);
  assert.equal(c.bars.filter((b) => b.open).length, 1);
  assert.equal(c.readout.value, '9');
  assert.equal(c.readout.label, 'this week so far');
  assert.equal(c.xl.length, c.bars.length);
  assert.equal(c.xl.at(-1).text, 'Nov 2');
  assert.equal(shareChart({ weekly: [] }, NOW), null);
  assert.equal(shareChart(null, NOW), null);
});
test('shareRouteRows: dash for a route with no opened step, real zero kept, sorted by shared', () => {
  const rows = shareRouteRows(sharing());
  assert.deepEqual(rows.map((r) => r.key), ['view_link', 'email_invite', 'edit_link', 'mystery_route']);
  const view = rows[0];
  assert.equal(view.opened, '0'); // a viewer can open it: 0 is a real zero
  assert.equal(view.signedUp, '0');
  assert.equal(rows[1].opened, '—'); // an emailed invitation is not "opened" by a viewer
  assert.equal(rows[1].label, 'Emailed invitation');
  assert.equal(rows[3].opened, '—');
  assert.equal(rows[3].signedUp, '—');
  assert.equal(rows[3].label, 'mystery route');
  assert.deepEqual(shareRouteRows(null), []);
  assert.doesNotMatch(flat(rows), BAD);
});
test('inviteLine: sent, who sent, how many of the emailed ones led to a signup, and why the table differs', () => {
  assert.equal(
    inviteLine({ invites: { sent_total: 52, pending_signup: 21, signed_up: 12, direct_grants: 31, inviting_users: 16 } }),
    'Invitations sent in the last 30 days: 52, by 16 people. Of the 21 sent to someone without an account, 12 led to one. The table counts signups by the share they came through, whenever it was sent.',
  );
  assert.equal(
    inviteLine({ invites: { sent_total: 1, pending_signup: 1, signed_up: 0, inviting_users: 1 } }),
    'Invitations sent in the last 30 days: 1, by 1 person. Of the 1 sent to someone without an account, 0 led to one. The table counts signups by the share they came through, whenever it was sent.',
  );
  // without pending_signup or signed_up there is no second or third sentence
  assert.equal(inviteLine({ invites: { sent_total: 52, inviting_users: 16, signed_up: 12 } }), 'Invitations sent in the last 30 days: 52, by 16 people.');
  assert.equal(inviteLine({ invites: { sent_total: 52, pending_signup: 21, inviting_users: 16 } }), 'Invitations sent in the last 30 days: 52, by 16 people.');
  // without inviting_users the first sentence has no "by"
  assert.equal(
    inviteLine({ invites: { sent_total: 52, pending_signup: 21, signed_up: 12 } }),
    'Invitations sent in the last 30 days: 52. Of the 21 sent to someone without an account, 12 led to one. The table counts signups by the share they came through, whenever it was sent.',
  );
  assert.equal(inviteLine({ invites: { inviting_users: 16, pending_signup: 21, signed_up: 12 } }), '');
  assert.equal(inviteLine({}), '');
  assert.equal(inviteLine(null), '');
});

// ── Problems ──
test('problemsModel: browsers, never people; dots with crash ones first', () => {
  const m = problemsModel({ days: 7, totals: { problems: 9, occurrences: 64, people: 17, crash_people: 3, new: 3 } });
  assert.deepEqual(m.tiles.map((t) => t.value), ['3', '9', '64', '17']);
  assert.equal(m.tiles[0].tone, 'bad');
  assert.equal(m.crowd.mode, 'dots');
  assert.equal(m.crowd.dots.length, 17);
  assert.equal(m.crowd.dots.filter(Boolean).length, 3);
  assert.equal(m.crowd.dots.indexOf(false), 3);
  assert.equal(m.dek, '3 of 17 browsers hit a crash.');
  assert.doesNotMatch(flat([m.tiles, m.dek, m.label]), /\bpeople\b|\bperson\b/);
  assert.match(m.caption, /not a person/);
});
test('problemsModel: the crowd is capped at 100 dots, above that a split bar', () => {
  const at = problemsModel({ totals: { people: CROWD_MAX, crash_people: 10 } });
  assert.equal(at.crowd.mode, 'dots');
  assert.equal(at.crowd.dots.length, CROWD_MAX);
  const over = problemsModel({ totals: { people: 101, crash_people: 10 } });
  assert.equal(over.crowd.mode, 'split');
  assert.deepEqual(over.crowd.parts.map((p) => p.n), [10, 91]);
  assert.equal(over.crowd.dots, undefined);
});
test('problemsModel: nobody affected, zero stays 0, nothing new is not red, missing is a dash, null', () => {
  const z = problemsModel({ totals: { problems: 0, occurrences: 0, people: 0, crash_people: 0, new: 0 } });
  assert.deepEqual(z.tiles.map((t) => t.value), ['0', '0', '0', '0']);
  assert.equal(z.tiles[0].tone, undefined);
  assert.deepEqual(z.crowd.dots, []);
  const miss = problemsModel({ totals: {} });
  assert.deepEqual(miss.tiles.map((t) => t.value), ['–', '–', '–', '–']);
  assert.equal(miss.crowd, null);
  assert.equal(problemsModel({ totals: { people: 4, crash_people: 9 } }).crowd, null); // inconsistent: no dots
  assert.equal(problemsModel(null), null);
  assert.equal(problemsModel({}), null);
  assert.doesNotMatch(flat([z, miss]), BAD);
});

// ── Emails ──
test('emailName: known ids are named, unknown fall back to the id with spaces', () => {
  assert.equal(emailName('product_update'), 'Product update');
  assert.equal(emailName('board_waiting'), 'Cluster waiting');
  assert.equal(emailName('pending_invite'), 'Pending invite');
  assert.equal(emailName('brand_new_template'), 'Brand new template');
  assert.equal(emailName('day3_nudge'), 'Day3 nudge');
  assert.equal(emailName('welcome'), 'Welcome');
  assert.equal(emailName('trial_ending'), 'Trial ending');
  assert.equal(emailName('unknown'), 'Sign-in codes and other untagged mail');
  assert.equal(emailName(''), 'Unknown');
  assert.equal(emailName(null), 'Unknown');
});
test('emailsModel: totals, sorted rows, open rules (rate at 15, counts under, none recorded at 0)', () => {
  const m = emailsModel([
    { category: 'lifecycle', template: 'product_update', sent: 600, delivered: 590, opened: 0, bounced: 4 },
    { category: 'lifecycle', template: 'board_waiting', sent: 100, delivered: 98, opened: 49, bounced: 2 },
    { category: 'transact', template: 'pending_invite', sent: 10, delivered: 9, opened: 5, bounced: 1 },
    { category: 'transact', template: 'mystery_one', sent: 3, delivered: 0, opened: 0, bounced: 3 },
  ]);
  assert.deepEqual(m.tiles.map((t) => t.value), ['713', '10']);
  assert.deepEqual(m.rows.map((r) => r.name), ['Product update', 'Cluster waiting', 'Pending invite', 'Mystery one']);
  assert.equal(m.rows[0].frac, 1);
  assert.equal(m.rows[0].line, '590 delivered · no opens recorded · 4 bounced');
  assert.equal(m.rows[1].line, '98 delivered · 50% opened · 2 bounced');
  assert.equal(m.rows[2].line, '9 delivered · 5 of 9 opened · 1 bounced');
  assert.equal(m.rows[3].line, '0 delivered · 3 bounced'); // nothing delivered: no open claim
  assert.doesNotMatch(flat(m), BAD);
});
test('emailsModel: one template in two categories is added together; empty and null', () => {
  const m = emailsModel([{ category: 'a', template: 'whats_new', sent: 20, delivered: 20, opened: 10, bounced: 0 }, { category: 'b', template: 'whats_new', sent: 10, delivered: 10, opened: 10, bounced: 1 }]);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].sentText, '30');
  assert.equal(m.rows[0].line, '30 delivered · 67% opened · 1 bounced');
  const e = emailsModel([]);
  assert.deepEqual(e.tiles.map((t) => t.value), ['–', '–']);
  assert.equal(e.rows.length, 0);
  assert.equal(emailsModel(null), null);
  const z = emailsModel([{ template: 'ops_alert', sent: 0, delivered: 0, opened: 0, bounced: 0 }]);
  assert.deepEqual(z.tiles.map((t) => t.value), ['0', '0']);
});
