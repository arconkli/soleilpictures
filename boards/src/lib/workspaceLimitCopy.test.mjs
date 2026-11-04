import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitBoxCopy, justMeLimitLine } from './workspaceLimitCopy.js';
import { refusalLine } from './teamCopy.js';
import { teamRefusal } from './teamHints.js';

test('full box with teams', () => {
  const c = limitBoxCopy(10);
  assert.equal(c.title, 'You have 10 workspaces');
  assert.match(c.body, /^That’s the most you can have outside Team\./);
  assert.match(c.body, /Or delete one you no longer need to make room\.$/);
  assert.equal(c.primary, 'Start a team');
  assert.equal(c.secondary, 'Not now');
});

test('over box with teams', () => {
  const c = limitBoxCopy(12);
  assert.equal(c.title, 'You have 12 workspaces');
  assert.match(c.body, /^You keep all of them\. New ones open up once you have fewer than 10 — or start a team/);
});

test('teams closed: no Team sentences, one OK', () => {
  for (const n of [10, 12]) {
    const c = limitBoxCopy(n, { teams: false });
    assert.equal(c.primary, null);
    assert.equal(c.secondary, 'OK');
    assert.doesNotMatch(c.body, /Team|team/);
  }
  assert.equal(limitBoxCopy(10, { teams: false }).body, 'That’s the most you can have. Delete one you no longer need to make room.');
  assert.equal(limitBoxCopy(11, { teams: false }).body, 'You keep all of them. New ones open up once you have fewer than 10.');
});

test('on a team without a seat: ask the admin, one OK, no Start a team', () => {
  const full = limitBoxCopy(10, { onTeam: true });
  assert.equal(full.title, 'You have 10 workspaces');
  assert.equal(full.body, 'That’s the most you can have outside a team. Workspaces on your team don’t count and have no limit: ask its admin for a seat to make them. Or delete one you no longer need to make room.');
  assert.equal(full.primary, null);
  assert.equal(full.secondary, 'OK');
  const over = limitBoxCopy(12, { onTeam: true });
  assert.equal(over.title, 'You have 12 workspaces');
  assert.equal(over.body, 'You keep all of them. New ones open up once you have fewer than 10 — or ask your team’s admin for a seat; team workspaces have no limit.');
  assert.equal(over.primary, null);
  assert.equal(over.secondary, 'OK');
  // Teams closed wins: no Team sentences at all.
  assert.equal(limitBoxCopy(10, { teams: false, onTeam: true }).body, limitBoxCopy(10, { teams: false }).body);
});

test('seat holder lines', () => {
  assert.equal(justMeLimitLine(10), 'You have 10 of your own, the most outside a team.');
  assert.equal(justMeLimitLine(13), 'You have 13 of your own; the most outside a team is 10.');
});

test('a server refusal reads as that line', () => {
  const r = teamRefusal({ hint: 'workspace_limit', message: 'workspace limit reached: you have 10 workspaces of your own, the most outside Team' });
  assert.equal(r.kind, 'workspace_limit');
  assert.equal(refusalLine({ code: r.kind }), '10 workspaces of your own is the most outside a team.');
});
