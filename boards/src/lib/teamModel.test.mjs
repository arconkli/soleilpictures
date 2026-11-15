// teamModel.test.mjs — the Team page's rules: who may do what, what a seat
// is, what a seat costs today, and the test team's answers to clicks.
//
//   node --test src/lib/teamModel.test.mjs src/lib/teamSample.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  teamCan, holdsSeat, seatsUsed, seatsFree, roleChoices, peopleCounts, filterPeople, moveOutReceivers,
  money, proratedToday,
  storageQuota, sizeLabel, teamReducer, teamHeroLine, TEAM_SEAT_MIN,
} from './teamModel.js';
// The sentences moved to the app-only words module (teamModelWords.js).
import {
  whereLabel, lastHereLabel, adminNames, seatPriceLabel, seatAddLine, approveLine,
  teamHeroLine as teamHeroLineWords,
} from './teamModelWords.js';
import { sampleTeam } from './teamSample.js';
import { searchKey } from './textFold.js';

const NOW = new Date('2026-10-21T15:00:00').getTime();
const DAY = 864e5;

test('the owner does everything; admins never touch the card, the plan, storage or closing; members only look', () => {
  for (const a of ['changeCard', 'changePlan', 'addStorage', 'closeTeam', 'makeAdmins']) {
    assert.equal(teamCan('owner', a), true, a);
    assert.equal(teamCan('admin', a), false, a);
    assert.equal(teamCan('member', a), false, a);
  }
  for (const a of ['managePeople', 'addSeats', 'setWhenFull', 'seeBilling', 'seeJoining', 'seeEmails']) {
    assert.equal(teamCan('admin', a), true, a);
    assert.equal(teamCan('member', a), false, a);
  }
  assert.equal(teamCan('owner', 'leaveTeam'), false);
  assert.equal(teamCan('member', 'nonsense'), false);
});

test('a seat is anyone who can edit, guests and editor invites too; viewers are free', () => {
  assert.equal(holdsSeat({ role: 'guest', invited: null }), true);
  assert.equal(holdsSeat({ role: 'viewer', invited: null }), false);
  assert.equal(holdsSeat({ role: 'member', invited: { role: 'editor' } }), true);
  assert.equal(holdsSeat({ role: 'viewer', invited: { role: 'viewer' } }), false);
  const t = sampleTeam('owner', NOW);
  assert.equal(seatsUsed(t.people), 12);
  assert.equal(seatsFree(t), 3);
});

test('roles: the owner and yourself are fixed, admins can’t make admins, guests stay outside', () => {
  const owner = sampleTeam('owner', NOW);
  const admin = sampleTeam('admin', NOW);
  const by = (t, id) => t.people.find((p) => p.id === id);
  assert.equal(roleChoices(owner, by(owner, 'p-alex')), null);
  assert.deepEqual(roleChoices(owner, by(owner, 'p-ben')), ['admin', 'member', 'viewer']);
  assert.deepEqual(roleChoices(owner, by(owner, 'p-rosa')), ['guest', 'viewer']);
  assert.equal(roleChoices(owner, by(owner, 'p-chloe')), null);
  assert.equal(roleChoices(admin, by(admin, 'p-ben')), null);
  assert.equal(roleChoices(admin, by(admin, 'p-alex')), null);
  assert.deepEqual(roleChoices(admin, by(admin, 'p-maya')), ['member', 'viewer']);
  const member = sampleTeam('member', NOW);
  assert.equal(roleChoices(member, by(member, 'p-jon')), null);
});

test('People: All lists editors and invites with the viewers folded; a search finds viewers', () => {
  const t = sampleTeam('owner', NOW);
  assert.deepEqual(peopleCounts(t.people), { all: 19, edit: 11, view: 7, invited: 1 });
  const all = filterPeople(t.people);
  assert.equal(all.rows.length, 12);
  assert.equal(all.viewersFolded, 7);
  assert.equal(filterPeople(t.people, { show: 'view' }).rows.length, 7);
  assert.equal(filterPeople(t.people, { show: 'invited' }).rows[0].name, 'Chloe Dubois');
  const lena = filterPeople(t.people, { query: 'LENA' });
  assert.deepEqual(lena.rows.map((p) => p.id), ['p-lena']);
  assert.equal(lena.viewersFolded, 0);
  assert.equal(filterPeople(t.people, { query: 'vidal.studio' }).rows[0].id, 'p-rosa');
});

test('People: a fold option lets "nunez" find "Jos\u{E9} N\u{FA}\u{F1}ez"', () => {
  const people = [{ id: 'p-jose', name: 'Jos\u{E9} N\u{FA}\u{F1}ez', email: 'jose@example.com', role: 'edit' }];
  assert.deepEqual(filterPeople(people, { query: 'nunez', fold: searchKey }).rows.map((p) => p.id), ['p-jose']);
  assert.equal(filterPeople(people, { query: 'nunez' }).rows.length, 0);
});

test('labels: where, last here, and the names a member is pointed to', () => {
  const t = sampleTeam('owner', NOW);
  const by = (id) => t.people.find((p) => p.id === id);
  assert.equal(whereLabel(by('p-alex')), 'Everywhere');
  assert.equal(whereLabel(by('p-maya')), 'Studio, Commercials');
  assert.equal(lastHereLabel(by('p-maya'), NOW), 'Here now');
  assert.equal(lastHereLabel(by('p-ben'), NOW), '2 hours ago');
  assert.equal(lastHereLabel(by('p-chloe'), NOW), 'Sent 2 days ago');
  assert.equal(lastHereLabel(by('p-theo'), NOW), 'Last week');
  assert.equal(lastHereLabel({ online: false, lastSeenAt: NOW - 30 * 60e3, invited: null }, NOW), '30 min ago');
  assert.equal(lastHereLabel({ online: false, lastSeenAt: null, invited: null }, NOW), '');
  assert.equal(adminNames(t), 'Alex and Ben');
  assert.equal(adminNames({ admins: [{ name: 'Alex R' }, { name: 'Ben O' }, { name: 'Mia K' }] }), 'Alex, Ben and Mia');
});

test('money: whole dollars stay whole, a seat is prorated to the day', () => {
  assert.equal(money(2160), '$2,160');
  assert.equal(money(9.5), '$9.50');
  assert.equal(money(0), '$0');
  assert.equal(teamHeroLine(10), 'Teams with more than 10 people who edit pay $25 a seat.');
  assert.equal(teamHeroLineWords(10), teamHeroLine(10));
  const plan = { interval: 'year', renewsAt: NOW + 73 * DAY };
  assert.equal(seatPriceLabel(plan), '$240 a year');
  assert.equal(proratedToday(plan, NOW), 48);
  assert.equal(seatAddLine(plan, 1, NOW), '$240 a year, $48 today');
  assert.equal(seatAddLine(plan, 2, NOW), '$240 a year each, $96 today');
  const monthly = { interval: 'month', renewsAt: NOW + 15 * DAY };
  assert.equal(seatAddLine(monthly, 1, NOW), '$25 a month, $12.50 today');
  assert.equal(proratedToday({ interval: 'month', renewsAt: NOW - DAY }, NOW), 0);
});

test('a request uses a free seat first and buys one only when none is left', () => {
  const t = sampleTeam('owner', NOW);
  assert.equal(approveLine(t, NOW), 'Approving uses one of the 3 free seats.');
  const full = { ...t, plan: { ...t.plan, seats: 12 } };
  assert.match(approveLine(full, NOW), /^Approving adds a seat: \$240 a year, \$\d+(\.\d\d)? today\.$/);
});

test('storage: 1 TB a seat, as Creator', () => {
  assert.equal(storageQuota(3), 3e12);
  assert.equal(storageQuota(15), 15e12);
  assert.equal(sizeLabel(3.75e12), '3.75 TB');
  assert.equal(sizeLabel(1.2e12), '1.2 TB');
  assert.equal(sizeLabel(100e9), '100 GB');
});

test('the reducer: roles recount seats and buy one when none is free', () => {
  let t = sampleTeam('owner', NOW);
  t = teamReducer(t, { type: 'role', personId: 'p-theo', role: 'viewer' });
  assert.equal(seatsUsed(t.people), 11);
  assert.equal(t.plan.seats, 15);
  t = { ...t, plan: { ...t.plan, seats: 11 } };
  t = teamReducer(t, { type: 'role', personId: 'p-owen', role: 'member' });
  assert.equal(seatsUsed(t.people), 12);
  assert.equal(t.plan.seats, 12);
  assert.equal(t.storage.quotaBytes, 12e12);
});

test('the reducer: approve makes the viewer an editor where they asked; keep leaves them viewing', () => {
  const t0 = sampleTeam('owner', NOW);
  const t = teamReducer(t0, { type: 'approve', requestId: 'r-lena' });
  const lena = t.people.find((p) => p.id === 'p-lena');
  assert.equal(lena.role, 'member');
  assert.deepEqual(lena.where, ['Commercials']);
  assert.equal(t.requests.length, 0);
  const kept = teamReducer(t0, { type: 'keepViewer', requestId: 'r-lena' });
  assert.equal(kept.people.find((p) => p.id === 'p-lena').role, 'viewer');
  assert.equal(kept.requests.length, 0);
});

test('the reducer: seats never drop under 3 or under the seats in use', () => {
  let t = sampleTeam('owner', NOW);
  t = teamReducer(t, { type: 'addSeats', n: 2 });
  assert.equal(t.plan.seats, 17);
  for (let i = 0; i < 10; i++) t = teamReducer(t, { type: 'removeSeat' });
  assert.equal(t.plan.seats, 12);
  const tiny = { ...t, people: t.people.filter((p) => p.role === 'owner'), plan: { ...t.plan, seats: 4 } };
  const a = teamReducer(tiny, { type: 'removeSeat' });
  assert.equal(a.plan.seats, TEAM_SEAT_MIN);
  assert.equal(teamReducer(a, { type: 'removeSeat' }).plan.seats, TEAM_SEAT_MIN);
});

test('the reducer: the monthly limit is the admins’ own number, or none', () => {
  let t = sampleTeam('owner', NOW);
  t = teamReducer(t, { type: 'whenFull', mode: 'auto' });
  assert.equal(t.whenFull.mode, 'auto');
  assert.equal(teamReducer(t, { type: 'monthlyLimit', value: '12' }).whenFull.monthlyLimit, 12);
  assert.equal(teamReducer(t, { type: 'monthlyLimit', value: '' }).whenFull.monthlyLimit, null);
  assert.equal(teamReducer(t, { type: 'monthlyLimit', value: '0' }).whenFull.monthlyLimit, null);
  assert.equal(teamReducer(t, { type: 'monthlyLimit', value: 2.7 }).whenFull.monthlyLimit, 2);
});

test('the reducer: invites hold seats, skip people already there, and resend/revoke', () => {
  let t = sampleTeam('owner', NOW);
  t = teamReducer(t, { type: 'invite', emails: ['new@a.co', 'NEW@a.co', 'maya@northlight.studio', ''], role: 'editor', now: NOW });
  const fresh = t.people.filter((p) => p.invited && p.email === 'new@a.co');
  assert.equal(fresh.length, 1);
  assert.equal(seatsUsed(t.people), 13);
  t = teamReducer(t, { type: 'invite', emails: ['v@a.co'], role: 'viewer', now: NOW });
  assert.equal(seatsUsed(t.people), 13);
  t = teamReducer(t, { type: 'resend', personId: 'p-chloe', now: NOW });
  assert.equal(t.people.find((p) => p.id === 'p-chloe').invited.sentAt, NOW);
  t = teamReducer(t, { type: 'revoke', personId: 'p-chloe' });
  assert.equal(t.people.some((p) => p.id === 'p-chloe'), false);
});

test('the reducer: joining and the name', () => {
  let t = sampleTeam('owner', NOW);
  t = teamReducer(t, { type: 'link', on: false });
  assert.equal(t.joining.link.on, false);
  t = teamReducer(t, { type: 'linkRole', role: 'viewer' });
  assert.equal(t.joining.link.role, 'viewer');
  t = teamReducer(t, { type: 'newLink', token: 'nl-abc123' });
  assert.equal(t.joining.link.token, 'nl-abc123');
  t = teamReducer(t, { type: 'addDomain', domain: '@Northlight.TV' });
  assert.deepEqual(t.joining.domains[1], { domain: 'northlight.tv', verified: false, on: true });
  assert.equal(teamReducer(t, { type: 'addDomain', domain: 'northlight.tv' }).joining.domains.length, 2);
  const gone = teamReducer(t, { type: 'removeDomain', domain: '@Northlight.TV' });
  assert.deepEqual(gone.joining.domains.map((d) => d.domain), [t.joining.domains[0].domain]);
  assert.equal(teamReducer(t, { type: 'removeDomain', domain: 'nowhere.co' }).joining.domains.length, 2);
  t = teamReducer(t, { type: 'rename', name: '  lumen pictures ' });
  assert.equal(t.name, 'lumen pictures');
  assert.equal(t.letter, 'L');
  assert.equal(teamReducer(t, { type: 'rename', name: '   ' }).name, 'lumen pictures');
});

test('workspaces: admins make one private or move it out, anyone with a seat moves one in', () => {
  for (const r of ['owner', 'admin']) {
    assert.equal(teamCan(r, 'manageWorkspaces'), true, r);
    assert.equal(teamCan(r, 'moveWorkspaceIn'), true, r);
  }
  assert.equal(teamCan('member', 'manageWorkspaces'), false);
  assert.equal(teamCan('member', 'moveWorkspaceIn'), true);
  assert.equal(teamCan('viewer', 'manageWorkspaces'), false);
  assert.equal(teamCan('viewer', 'moveWorkspaceIn'), false);
  // A workspace leaving the team goes to someone in it with a seat: never a
  // guest, a viewer or an invite that hasn't been answered.
  const got = moveOutReceivers(sampleTeam('owner', NOW));
  assert.deepEqual(got.map((p) => p.id), ['p-alex', 'p-ben', 'p-maya', 'p-jon', 'p-priya', 'p-omar', 'p-june', 'p-theo', 'p-sam']);
});

test('the reducer: a workspace goes private and back, moves out, and one of yours moves in once', () => {
  let t = sampleTeam('owner', NOW);
  t = teamReducer(t, { type: 'workspacePrivate', workspaceId: 'sample-ws-studio', private: true });
  assert.deepEqual(t.workspaces.map((w) => w.private), [true, false, true]);
  t = teamReducer(t, { type: 'workspacePrivate', workspaceId: 'sample-ws-music', private: false });
  assert.deepEqual(t.workspaces.map((w) => w.private), [true, false, false]);
  t = teamReducer(t, { type: 'moveOut', workspaceId: 'sample-ws-commercials' });
  assert.deepEqual(t.workspaces.map((w) => w.name), ['Studio', 'Music videos']);
  const pitch = t.ownWorkspaces[0];
  t = teamReducer(t, { type: 'moveIn', workspaceId: pitch.id, workspace: pitch });
  assert.deepEqual(t.workspaces.map((w) => w.name), ['Studio', 'Music videos', 'Pitch decks']);
  assert.deepEqual(t.workspaces[2], { id: 'sample-ws-pitch', name: 'Pitch decks', letter: 'P', color: '#b88958', private: false });
  assert.deepEqual(t.ownWorkspaces.map((w) => w.name), ['Scratch']);
  // Twice is once, and a move with no workspace changes nothing.
  assert.equal(teamReducer(t, { type: 'moveIn', workspaceId: pitch.id, workspace: pitch }), t);
  assert.equal(teamReducer(t, { type: 'moveIn', workspaceId: 'x' }), t);
});

// ── Money and sizes in the reader's language (16b) ──
import { setUiLocale } from './uiLocale.js';
import { money as moneyIn, sizeLabel as sizeLabelIn } from './teamModelWords.js';

const nb = (s) => s.replace(/[\u00a0\u202f]/g, ' ');
const inLocale = (l, fn) => { setUiLocale(l); try { return fn(); } finally { setUiLocale('en'); } };
test('money and sizeLabel: English as ever; fr and ru write the same amount their way', () => {
  assert.equal(moneyIn(25), '$25');
  assert.equal(moneyIn(12.5), '$12.50');
  assert.equal(sizeLabelIn(1e12), '1 TB');
  assert.equal(sizeLabelIn(1.5e9), '1.5 GB');
  assert.equal(nb(inLocale('fr', () => moneyIn(12.5))), '12,50 $US');
  assert.equal(nb(inLocale('fr', () => moneyIn(25))), '25 $US');
  assert.equal(nb(inLocale('fr', () => sizeLabelIn(1.5e9))), '1,5 Go');
  assert.equal(nb(inLocale('ru', () => sizeLabelIn(1e12))), '1 ТБ');
});
