// setupEnded.test.mjs — the first-run setup test has ended: no re-ask for anyone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workspaceSetupOn } from './setupRule.js';
import { reaskDue, REASK_MIN_CARDS } from './workspaceSetup.js';
import { EXPERIMENTS, assignArm } from './experiments.js';

const due = {
  arm: 'B', welcome: { done: true, invite: 'skipped' }, reasked: false, ownCards: REASK_MIN_CARDS,
  uploading: false, overlayOpen: false, createdAt: '2026-11-01T00:00:00Z', now: '2026-11-02T00:00:00Z',
};

test('workspaceSetupOn follows the registry, and it is off', () => {
  assert.equal(workspaceSetupOn(), EXPERIMENTS.workspace_setup.enabled === true);
  assert.equal(workspaceSetupOn(), false);
  assert.equal(assignArm('workspace_setup', 'someone'), null);
});

test('the re-ask is still due when the test is on, and never when it is off', () => {
  assert.equal(reaskDue({ ...due, setupOn: true }), true);
  assert.equal(reaskDue({ ...due, setupOn: false }), false, 'even for an account that did the steps');
  assert.equal(reaskDue({ ...due, setupOn: undefined, arm: 'B' }), true, 'default keeps the pure rule');
});

test('the component hands the registry answer to reaskDue', () => {
  const src = readFileSync(new URL('../components/setup/SetupInWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(src, /setupOn: workspaceSetupOn\(\)/);
});
