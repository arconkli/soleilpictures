import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEAM_START_KEY, TEAM_START_MAX_AGE_MS, teamStartHref, stashTeamStart, readTeamStart, clearTeamStart,
} from './teamStart.js';

const memory = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    has: (k) => m.has(k),
  };
};

test('the setup link carries the seats and the billing, and drops what is not a seat count', () => {
  assert.equal(teamStartHref({ seats: 12, billing: 'annual' }), '/team/new?seats=12&billing=annual');
  assert.equal(teamStartHref({ seats: 3, billing: 'monthly' }), '/team/new?seats=3&billing=monthly');
  assert.equal(teamStartHref({ seats: 2.5, billing: 'yearly' }), '/team/new?billing=monthly');
  assert.equal(teamStartHref({ seats: '<b>', billing: null }), '/team/new?billing=monthly');
  assert.equal(teamStartHref(), '/team/new?billing=monthly');
});

test('a press is kept for a day and read back as it was', () => {
  const s = memory();
  assert.equal(stashTeamStart({ seats: 14, billing: 'annual', now: 1000 }, s), true);
  assert.deepEqual(readTeamStart({ now: 1000 + 60_000 }, s), { seats: 14, billing: 'annual', ageMs: 60_000 });
  // Reading does not spend it: AuthGate clears it when it opens the setup.
  assert.ok(s.has(TEAM_START_KEY));
  clearTeamStart(s);
  assert.equal(readTeamStart({ now: 2000 }, s), null);
});

test('an expired, future-dated or unreadable press is removed on read', () => {
  const s = memory();
  stashTeamStart({ seats: 5, billing: 'monthly', now: 0 }, s);
  assert.equal(readTeamStart({ now: TEAM_START_MAX_AGE_MS + 1 }, s), null);
  assert.equal(s.has(TEAM_START_KEY), false);

  stashTeamStart({ seats: 5, billing: 'monthly', now: 5000 }, s);
  assert.equal(readTeamStart({ now: 1000 }, s), null);
  assert.equal(s.has(TEAM_START_KEY), false);

  for (const bad of ['{', '{"billing":"monthly"}', '{"billing":"monthly","at":null}', '{"billing":"weekly","at":1}']) {
    s.setItem(TEAM_START_KEY, bad);
    assert.equal(readTeamStart({ now: 2 }, s), null, bad);
    assert.equal(s.has(TEAM_START_KEY), false, bad);
  }
});

test('storage that refuses is survived', () => {
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.equal(stashTeamStart({ seats: 4, billing: 'monthly' }, broken), false);
  assert.equal(readTeamStart({}, broken), null);
  assert.doesNotThrow(() => clearTeamStart(broken));
});
