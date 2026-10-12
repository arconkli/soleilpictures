// COMMS-21: WorkspaceParty pruned stale peers only when some socket connected
// or closed, so a laptop that slept (no clean close) stayed in everyone's
// topbar for as long as nobody else came or went. A storage alarm now sweeps
// while anyone is listed and lapses when the room empties. Backward
// compatible: clients just receive the `leave` delta they already handle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../party/workspace.ts', import.meta.url), 'utf8');

test('a heartbeat arms the sweep, and the alarm prunes then re-arms only while peers remain', () => {
  assert.match(src, /const PRUNE_MS = 20_000;/);
  assert.match(src, /this\.peers\.set\(tabId, rec\);\s*void this\.armPrune\(\);/);
  const alarm = src.slice(src.indexOf('async onAlarm()'), src.indexOf('onMessage('));
  assert.match(alarm, /this\.pruneStale\(\);/);
  assert.match(alarm, /await this\.armPrune\(\);/);
  const arm = src.slice(src.indexOf('async armPrune()'), src.indexOf('async onAlarm()'));
  assert.match(arm, /if \(this\.pruneArmed \|\| this\.peers\.size === 0\) return;/);
  assert.match(arm, /setAlarm\(Date\.now\(\) \+ PRUNE_MS\)/);
});

test('the wire protocol is unchanged: stale tabs leave as `leave` deltas', () => {
  const prune = src.slice(src.indexOf('private pruneStale()'));
  assert.match(prune, /type: "leave", from: tabId/);
  assert.doesNotMatch(src, /type: "roster", peers: roster, /);
});
