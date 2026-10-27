// teamCopy: a line for every refusal the page can meet, and the seat price
// line built only from the preview's numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_HINT } from './teamHints.js';
import { refusalLine, successLine, seatPriceLine, addSeatInviteLine, domainCheckLine, teamJoinLine, teamDomainJoinLine, teamInviteRefusalLine, teamInvitesClaimedLine } from './teamCopy.js';

const DEFAULT = refusalLine({ code: 'nonsense' });

test('every TEAM_HINT has its own line', () => {
  for (const h of Object.values(TEAM_HINT)) {
    const line = refusalLine({ code: h });
    assert.notEqual(line, DEFAULT, `${h} falls to the default`);
    assert.ok(line.length > 8 && !line.includes('!'));
  }
});

test('the team-billing and domain-check codes have lines', () => {
  for (const c of ['not_available', 'price_mismatch', 'stale_preview', 'stripe_error', 'no_plan', 'no_seat_item',
    'retry', 'network', 'auth required', 'not_yet', 'unsupported', 'too_many', 'team_domain_missing',
    'resend_too_soon', 'invite_closed']) {
    assert.notEqual(refusalLine({ code: c }), DEFAULT, c);
  }
});

test('the default, and a missing refusal', () => {
  assert.equal(DEFAULT, 'That didn’t work. Try again.');
  assert.equal(refusalLine(null), DEFAULT);
  assert.equal(refusalLine({ code: 'toString' }), DEFAULT);
});

test('team_seats_needed names the shortfall when it has one', () => {
  assert.equal(refusalLine({ code: 'team_seats_needed', needed: 1 }), 'That needs 1 more seat.');
  assert.equal(refusalLine({ code: 'team_seats_needed', needed: 3 }), 'That needs 3 more seats.');
  assert.equal(refusalLine({ code: 'team_seats_needed', needed: null }), 'That needs more seats than the team has.');
});

test('a paying preview names the unit and today, from the preview', () => {
  const line = seatPriceLine({ ok: true, seats: 6, from_seats: 5, unit_amount: 2500, interval: 'month', amount_today: 825, proration_date: 1 });
  assert.equal(line, '1 seat at $25 a month, $8.25 today.');
  const two = seatPriceLine({ ok: true, seats: 7, from_seats: 5, unit_amount: 24000, interval: 'year', amount_today: 20000, proration_date: 1 });
  assert.equal(two, '2 seats at $240 a year each, $200 today.');
});

test('a trialing preview charges nothing and names the trial end', () => {
  const end = Date.UTC(2026, 10, 12, 12) / 1000;
  const line = seatPriceLine({ ok: true, seats: 4, from_seats: 3, unit_amount: 2500, interval: 'month', trialing: true, amount_today: 0, trial_end: end });
  assert.equal(line, '1 seat at $25 a month. Nothing today: your trial ends November 12, 2026.');
  assert.ok(!/today\./.test(line.replace('Nothing today', '')));
});

test('success lines are short and plain', () => {
  for (const t of ['rename', 'close', 'leave', 'addSeats', 'newLink', 'nonsense']) {
    const s = successLine(t);
    assert.ok(s.length > 3 && !s.includes('!'), t);
  }
  assert.match(domainCheckLine({ verified: true }, 'a.com'), /verified/);
  assert.match(domainCheckLine({ verified: false }, 'a.com'), /isn’t verified/);
});

test('teamJoinLine: every status', () => {
  assert.equal(teamJoinLine('joined', 'Northlight', 'viewer'), 'You joined Northlight as a viewer. Its workspaces are in your workspace menu.');
  assert.equal(teamJoinLine('joined', 'Northlight', 'member'), 'You’re in Northlight. Its workspaces are in your workspace menu.');
  assert.equal(teamJoinLine('joined', '', 'member'), 'You’re in the team. Its workspaces are in your workspace menu.');
  assert.equal(teamJoinLine('requested', 'Northlight'), 'You’re in Northlight as a viewer for now. We asked its admins for a seat for you.');
  assert.equal(teamJoinLine('already', 'Northlight'), 'You’re already in Northlight.');
  const dead = 'That team link no longer works. Ask the team for a new one.';
  assert.equal(teamJoinLine('off', 'Northlight'), dead);
  assert.equal(teamJoinLine('not_found'), dead);
  assert.equal(teamJoinLine('removed', 'Northlight'), 'This link can’t add you back to Northlight. Ask one of its admins to invite you.');
  assert.equal(teamJoinLine('revoked'), 'That team invite was withdrawn. Ask the team for a new one.');
  assert.equal(teamJoinLine('expired'), 'That team invite has expired. Ask the team for a new one.');
  assert.equal(teamJoinLine('declined'), null);
  assert.equal(teamJoinLine(undefined), null);
});

test('teamDomainJoinLine: with and without a domain', () => {
  assert.equal(teamDomainJoinLine('Northlight', 'northlight.studio'), 'You joined Northlight, your company’s team, because you signed up with a northlight.studio email. Its workspaces are in your workspace menu.');
  assert.equal(teamDomainJoinLine('Northlight', ''), 'You joined Northlight, your company’s team. Its workspaces are in your workspace menu.');
});

test('teamInviteRefusalLine: each refusal and the default', () => {
  assert.equal(teamInviteRefusalLine({ hint: 'team_inbox_unproven' }), 'To join that team, sign in again with a code sent to the address the invite went to.');
  assert.equal(teamInviteRefusalLine({ code: '42501', message: 'This invite is for a Different Email' }), 'That team invite went to a different email address. Sign out, then sign in with that address to join.');
  assert.equal(teamInviteRefusalLine({ code: '42501', message: 'permission denied' }), DEFAULT);
  assert.equal(teamInviteRefusalLine({ code: 'P0002' }), 'That team invite no longer works. Ask the team for a new one.');
  assert.equal(teamInviteRefusalLine(null), DEFAULT);
  assert.equal(teamInviteRefusalLine(new Error('x')), DEFAULT);
});

test('teamInvitesClaimedLine: none, one, many', () => {
  assert.equal(teamInvitesClaimedLine(0), null);
  assert.equal(teamInvitesClaimedLine(undefined), null);
  assert.equal(teamInvitesClaimedLine(1), 'You joined a team you were invited to. Its workspaces are in your workspace menu.');
  assert.equal(teamInvitesClaimedLine(3), 'You joined 3 teams you were invited to. Their workspaces are in your workspace menu.');
});

test('the share panel prices the seats an invite to edit adds', () => {
  const one = { ok: true, seats: 6, from_seats: 5, unit_amount: 2500, interval: 'month', amount_today: 950, proration_date: 1 };
  assert.equal(addSeatInviteLine(one, 'lena@example.com'),
    'Inviting lena@example.com to edit adds a seat: $25 a month, $9.50 today.');
  const three = { ok: true, seats: 8, from_seats: 5, unit_amount: 24000, interval: 'year', amount_today: 30000, proration_date: 1 };
  assert.equal(addSeatInviteLine(three, '3 people'),
    'Inviting 3 people to edit adds 3 seats: $240 a year each, $300 today.');
  const end = Date.UTC(2026, 10, 12, 12) / 1000;
  const trial = { ok: true, seats: 4, from_seats: 3, unit_amount: 2500, interval: 'month', trialing: true, amount_today: 0, trial_end: end };
  assert.equal(addSeatInviteLine(trial, 'lena@example.com'),
    'Inviting lena@example.com to edit adds a seat: $25 a month, nothing until your trial ends November 12, 2026.');
});
