// setupRule.test.mjs — whether the first-run setup may open before the app,
// asked at sign-in (AuthGate) before the tier has answered.
//
//   node --test src/lib/setupRule.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupMayOpenFirst, SETUP_EPOCH } from './setupRule.js';
import { assignArm } from './experiments.js';
import * as gate from './setupGate.js';
import * as setup from './workspaceSetup.js';
import * as rule from './setupRule.js';

// Accounts dated from the epoch, so the test holds wherever it moves.
const AFTER = new Date(Date.parse(SETUP_EPOCH) + 3_600_000).toISOString();
const BEFORE = new Date(Date.parse(SETUP_EPOCH) - 86_400_000).toISOString();

test('the setup may open first only for an account new enough for it, in arm B', () => {
  const fresh = { id: 'new', created_at: AFTER };
  assert.equal(setupMayOpenFirst({ user: fresh, allowed: true, override: 'B' }), true);
  assert.equal(setupMayOpenFirst({ user: fresh, allowed: true, override: 'A' }), false);
  assert.equal(setupMayOpenFirst({ user: fresh, allowed: false, override: 'B' }), false, 'not while the setup is held');
  assert.equal(setupMayOpenFirst({ user: { id: 'old', created_at: BEFORE }, allowed: true, override: 'B' }), false,
    'an account older than the setup never sees it');
  assert.equal(setupMayOpenFirst({ user: { id: 'x' }, allowed: true, override: 'B' }), false, 'no creation time: not a candidate');
  assert.equal(setupMayOpenFirst({ user: null, allowed: true, override: 'B' }), false);
});

test('with no override, the arm the setup gate itself opens on', () => {
  const seen = new Set();
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const arm = assignArm('workspace_setup', id);
    seen.add(arm);
    assert.equal(setupMayOpenFirst({ user: { id, created_at: AFTER }, allowed: true }), arm === 'B', id);
  }
  assert.deepEqual([...seen].sort(), ['A', 'B'], 'both arms occur, so the loop tests something');
});

test('the setup modules hand on the same rule, not a copy', () => {
  assert.equal(gate.readSetupOverride, rule.readSetupOverride);
  assert.equal(gate.SETUP_OVERRIDE_KEY, rule.SETUP_OVERRIDE_KEY);
  assert.equal(setup.isSetupCandidate, rule.isSetupCandidate);
  assert.equal(setup.SETUP_EPOCH, rule.SETUP_EPOCH);
});
