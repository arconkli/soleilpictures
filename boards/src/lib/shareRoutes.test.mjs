// shareRoutes.test.mjs — the admin's sharing words. Invented titles and people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeLabel, shortDay, dayRange, objectSub, objectLadder, broughtInWords, withThemSub, titleOf,
  SHARING_FILTERS, REACH_SORT, ROUTES, ROUTE_ORDER,
} from './shareRoutes.js';

const NOW = new Date('2026-10-28T12:00:00Z');

test('every route has a label and a place in the order', () => {
  for (const r of ROUTE_ORDER) assert.ok(ROUTES[r], r);
  assert.equal(routeLabel('view_link'), 'View link');
  assert.equal(routeLabel('mystery_route'), 'mystery route');
});

test('days are UTC, short, and ranges say the month once', () => {
  assert.equal(shortDay('2026-10-20T23:30:00Z', NOW), 'Oct 20');
  assert.equal(shortDay('2025-12-31T10:00:00Z', NOW), 'Dec 31, 2025');
  assert.equal(dayRange('2026-10-16T01:00:00Z', '2026-10-19T01:00:00Z', NOW), 'Oct 16 – 19');
  assert.equal(dayRange('2026-09-30T01:00:00Z', '2026-10-02T01:00:00Z', NOW), 'Sep 30 – Oct 2');
  assert.equal(dayRange('2026-10-20T01:00:00Z', '2026-10-20T20:00:00Z', NOW), 'Oct 20');
  assert.equal(shortDay(null), '');
});

test('titles: untitled, deleted and long ones read as words', () => {
  assert.equal(titleOf({ kind: 'cluster', title: '' }), 'an untitled cluster');
  assert.equal(titleOf({ kind: 'workspace', title: null, deleted: true }), 'a deleted workspace');
  assert.equal(titleOf({ kind: 'cluster', title: 'x'.repeat(50) }).length, 40);
});

test("a shared cluster's line names its routes, copies and days", () => {
  const o = {
    kind: 'cluster', title: 'Pitch deck', copies: 5, first_at: '2026-10-16T09:00:00Z', last_at: '2026-10-19T09:00:00Z',
    routes: { edit_link: { shares: 1 }, view_link: { shares: 1 } },
  };
  assert.equal(objectSub(o, NOW), 'View link + edit link · copied 5× · Oct 16 – 19');
  assert.equal(objectSub({ routes: { email_invite: { shares: 3 } }, first_at: '2026-10-20T00:00:00Z', last_at: '2026-10-20T00:00:00Z' }, NOW),
    '3 × emailed invitation · Oct 20');
});

test("the ladder: Seen is a dash where nothing was a link, and only outcomes light up", () => {
  const invited = objectLadder({ routes: { email_invite: { shares: 2 } }, got_in: 1 });
  assert.deepEqual(invited.map((s) => s.n), ['—', 0, 0, 1, 0]);
  assert.deepEqual(invited.map((s) => s.on), [false, false, false, true, false]);
  const linked = objectLadder({ routes: { view_link: { shares: 1 } }, seen: 4 });
  assert.equal(linked[0].n, 4);
  assert.equal(linked[0].on, false, 'devices are reach, not an outcome');
});

test('brought in: a deleted link is still the credit, never organic, and an unrecorded add says so', () => {
  const link = broughtInWords({ route: 'view_link', state: 'deleted', by: { email: 's@example.com' },
    via: { kind: 'cluster', title: 'Lookbook' }, same_share_brought: 3, other_routes: [] });
  assert.equal(link.how, 'through the view link to “Lookbook”');
  assert.equal(link.note, 'that link no longer exists · it brought in 2 others');
  const add = broughtInWords({ route: 'workspace_add', evidence: 'not_recorded', by: null,
    via: { kind: 'workspace', title: 'Studio' }, same_share_brought: 1, other_routes: ['email_invite'] });
  assert.equal(add.how, 'added to “Studio”');
  assert.equal(add.note, 'who added them isn’t recorded · also emailed invitation');
  assert.equal(broughtInWords(null), null);
});

test('shared with them: the route, who, the day and where it stands', () => {
  assert.equal(withThemSub({ route: 'email_invite', by: { name: 'Sam' }, at: '2026-10-20T00:00:00Z', state: 'pending' }, NOW),
    'Emailed invitation from Sam · Oct 20 · invited, not yet in');
  assert.equal(withThemSub({ route: 'workspace_add', by: null, recorded: false, at: '2026-10-09T00:00:00Z', state: 'member' }, NOW),
    'Added to a workspace · who added them isn’t recorded · Oct 9 · in it');
});

test("the filter's values are 0746's, and the sort is 'reach'", () => {
  assert.deepEqual(SHARING_FILTERS.map((f) => f.value), ['all', 'shared', 'brought', 'came', 'works_with']);
  assert.equal(REACH_SORT.value, 'reach');
});
