// COMMS-21: WorkspaceParty pruned stale peers only when some socket connected
// or closed, so a laptop that slept (no clean close) stayed in everyone's
// topbar for as long as nobody else came or went. A storage alarm now sweeps
// while anyone is present and lapses when nobody is. Backward compatible:
// clients just receive the `leave` delta they already handle.
//
// 2026-10-18: the room hibernates, so presence lives on each socket
// (conn.setState) and nothing in the room's memory may carry the roster. The
// sweep's rules are lib/workspaceRoster.js (workspaceRoster.test.mjs); this
// file pins the room's wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../party/workspace.ts', import.meta.url), 'utf8');

test('a heartbeat arms the sweep, and the alarm prunes then re-arms only while anyone is present', () => {
  assert.match(src, /const PRUNE_MS = 20_000;/);
  assert.match(src, /sender\.setState\(next\);\s*void this\.armPrune\(\);/);
  const alarm = src.slice(src.indexOf('async onAlarm()'), src.indexOf('onMessage('));
  assert.match(alarm, /if \(isFresh\(p, now\)\) \{ anyonePresent = true; return; \}/);
  assert.match(alarm, /if \(anyonePresent\) await this\.armPrune\(\);/);
  const arm = src.slice(src.indexOf('async armPrune()'), src.indexOf('async onAlarm()'));
  assert.match(arm, /if \(this\.pruneArmed\) return;/);
  assert.match(arm, /setAlarm\(Date\.now\(\) \+ PRUNE_MS\)/);
});

test('the wire protocol is unchanged: stale and closed tabs leave as `leave` deltas', () => {
  const alarm = src.slice(src.indexOf('async onAlarm()'), src.indexOf('onMessage('));
  assert.match(alarm, /type: "leave", from: p\.tabId/);
  const depart = src.slice(src.indexOf('private depart('));
  assert.match(depart, /type: "leave", from: p\.tabId/);
  assert.match(src, /type: "roster", peers: rosterFrom\(this\.presences\(\), Date\.now\(\)\)/);
});

test('a swept tab is told so, and answers with a fresh here', () => {
  const alarm = src.slice(src.indexOf('async onAlarm()'), src.indexOf('onMessage('));
  assert.match(alarm, /conn\.send\(JSON\.stringify\(\{ type: "stale" \}\)\)/);
  const client = readFileSync(new URL('./workspacePartyKit.js', import.meta.url), 'utf8');
  assert.match(client, /msg\?\.type === 'stale'\) \{[\s\S]*?sendLocation\(\);/);
});

test('the room hibernates and keeps no roster in memory', () => {
  assert.match(src, /static options = \{ hibernate: true \};/);
  assert.doesNotMatch(src, /new Map\(|new WeakMap\(/, 'presence must ride on the sockets, which survive hibernation');
  // The identity check survives: a `here` claiming another member is dropped.
  assert.match(src, /if \(mine\.userId && String\(msg\.user\.id\) !== mine\.userId\)/);
  assert.match(src, /userId: ctx\.request\.headers\.get\("x-user-id"\) \|\| undefined/);
});

test('the edge answers the tab ping, the room says so on connect, and pings count as presence', () => {
  assert.match(src, /setWebSocketAutoResponse\(new WebSocketRequestResponsePair\(PING, PONG\)\)/);
  const connect = src.slice(src.indexOf('onConnect('), src.indexOf('private pruneArmed'));
  assert.match(connect, /conn\.send\(WORKSPACE_PINGS_HELLO\);/);
  assert.match(src, /getWebSocketAutoResponseTimestamp\(/);
  assert.match(src, /heardBy\(this\.presenceOf\(conn\), this\.autoResponseAt\(conn\)\)/);
});

test('a woken room reads its last access check from storage and stores each new one', () => {
  const alarm = src.slice(src.indexOf('async onAlarm()'), src.indexOf('onMessage('));
  assert.match(alarm, /storage\.get\(ACCESS_CHECKED_KEY\)/);
  assert.match(alarm, /storage\.put\(ACCESS_CHECKED_KEY, now\)/);
  assert.match(src, /const ACCESS_CHECKED_KEY = "accessCheckedAt";/);
});
