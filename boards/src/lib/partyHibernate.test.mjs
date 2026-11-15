// The board room hibernates between events (party/board.ts), pinned by text
// since node cannot load the party .ts files. What it keeps across a nap is
// pure and tested in roomWake.test.mjs, togetherClock.test.mjs and
// boardRoomState.test.mjs; this pins that the room actually uses it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const board = readFileSync(new URL('../../party/board.ts', import.meta.url), 'utf8');
const between = (from, to) => {
  const a = board.indexOf(from);
  assert.ok(a > -1, `${from} is in board.ts`);
  const b = board.indexOf(to, a + from.length);
  return board.slice(a, b > -1 ? b : undefined);
};

test('the room hibernates, and the edge answers the keepalive', () => {
  assert.match(board, /static options = \{ hibernate: true \};/);
  assert.match(board, /this\.ctx\.setWebSocketAutoResponse\(new WebSocketRequestResponsePair\(PING, PONG\)\)/);
  assert.match(board, /import \{ PING, PONG, PINGS_HELLO, WAKE \} from "\.\.\/src\/lib\/partyPing\.js";/);
});

test('a woke room marks a clean rebuilt doc as stored, and WAKE gets no answer', () => {
  const woke = between('if (this.woke && applied > 0) {', 'this.woke = false;');
  assert.match(woke, /if \(!this\.remote\.dirty\) this\.remote\.noteStored\(/);
  const custom = between('onCustomMessage(', 'answerAck(');
  assert.match(custom, /if \(message === WAKE\) return;/);
});

test('a connecting tab is told the edge answers its PING', () => {
  const connect = between('async onConnect(', 'private wireOpLog(');
  assert.match(connect, /this\.sendCustomMessage\(conn, PINGS_HELLO\)/);
  assert.ok(connect.indexOf('ROOM_ANSWERS') < connect.indexOf('PINGS_HELLO'));
  assert.match(connect, /await this\.armSoon\(\)/, 'a room with sockets always has an alarm');
});

test('a woken room gets its save baseline back and does not reload', () => {
  const start = between('async onStart()', 'async onLoad()');
  assert.match(start, /this\.remote\.restoreBaseline\(/);
  assert.match(start, /onBaseline: \(b: unknown\) => \{ this\.put\(BASELINE_KEY, b\);/);
  assert.match(start, /if \(!this\.woke && this\.localHeldContent\) void this\.remote\.flush\(\{ force: true \}\)/);
  const load = between('async onLoad()', 'async onSave()');
  assert.match(load, /if \(this\.woke && applied > 0\) \{[\s\S]*?return doc;\n    \}/);
  assert.match(load, /this\.woke = false;/, 'a wake with nothing local is a cold start');
  assert.equal(load.split('return doc').length - 1, 2, 'only the nap returns early');
});

test('presence is put back after the base start and before anything listens', () => {
  const sup = board.indexOf('await super.onStart()');
  const restore = board.indexOf('restorePresence(');
  const watch = board.indexOf('new TogetherWatch(');
  assert.ok(sup > -1 && restore > sup && watch > restore);
});

test('a socket\'s presence is kept in its attachment when it sends awareness', () => {
  const message = between('onMessage(conn', 'private savePresence(');
  assert.match(message, /this\.savePresence\(conn\)/);
  assert.match(message, /first === 1/, 'y-protocols messageAwareness');
  assert.match(board, /private savePresence\(conn: Connection\)/);
  assert.match(board, /\[PRESENCE_KEY\]: entries/);
});

test('the idle watch for a host that is gone no longer exists', () => {
  assert.doesNotMatch(board, /IDLE_WATCH/);
});

test('the last close saves and drops the alarm, and the next alarm comes from nextAlarmIn', () => {
  const close = between('async onClose(', 'private async roomEmptied()');
  assert.match(close, /await this\.roomEmptied\(\)/);
  assert.match(between('private alarmDelay()', 'private retryWanted()'), /nextAlarmIn\(\{/);
  const next = between('private async armNext()', 'resetRoom');
  assert.match(next, /this\.alarmDelay\(\)/);
  assert.match(next, /deleteAlarm\(\)/);
});

test('the room imports nothing from node built-ins', () => {
  assert.doesNotMatch(board, /from "node:/);
  assert.doesNotMatch(board, /from "(fs|path|os|crypto|buffer|events|stream|util)"/);
});

test('heldStates walks every socket the room holds and decides the wake', () => {
  assert.match(board, /private heldStates\(\)/);
  const held = between('private heldStates()', 'async onStart()');
  assert.match(held, /this\.ctx\.getWebSockets\(\)/);
  assert.match(held, /__pk/);
  const start = between('async onStart()', 'async onLoad()');
  assert.match(start, /const held = this\.heldStates\(\)/);
  assert.match(start, /this\.woke = held\.length > 0/);
  assert.doesNotMatch(start, /const sockets = \[\.\.\.this\.getConnections\(\)\]/);
});

test('a close puts the closing socket\'s presence back before YServer removes it', () => {
  const close = between('async onClose(', 'private async roomEmptied()');
  assert.match(close, /restorePresence\(this\.document\.awareness, stateOf\(conn\)\[PRESENCE_KEY\]/);
  assert.ok(close.indexOf('restorePresence(') < close.indexOf('super.onClose('));
});

test('a close wakes the room with its socket still counted', () => {
  assert.match(board, /private closing = new Set<WebSocket>\(\);/);
  const close = between('async webSocketClose(', 'async onClose(');
  assert.match(close, /this\.closing\.add\(ws\);\s*try \{ await super\.webSocketClose\(ws, code, reason, wasClean\); \} finally \{ this\.closing\.delete\(ws\); \}/);
  assert.match(close, /this\.closing\.add\(ws\);\s*try \{ await super\.webSocketError\(ws, error\); \} finally \{ this\.closing\.delete\(ws\); \}/);
  // The room emptying starts a failed save's retry window, and is stored for the alarm's cold start.
  const emptied = between('private async roomEmptied()', 'private noteActivity()');
  assert.match(emptied, /this\.lastActivityAt = this\.activitySavedAt = Date\.now\(\);\s*this\.put\(ACTIVE_KEY, this\.lastActivityAt\);\s*await this\.remote\.flush\(\);/);
  const held = between('private heldStates()', 'async onStart()');
  assert.match(held, /\[\.\.\.this\.ctx\.getWebSockets\(\), \.\.\.this\.closing\]/);
  assert.match(held, /ws\.readyState !== WebSocket\.READY_STATE_OPEN && !this\.closing\.has\(ws\)/);
});

test('a doc-room edit in a board nobody has open runs no check', () => {
  assert.match(board, /private hasSockets\(\): boolean \{\s*for \(const _ of this\.getConnections\(\)\) return true;/);
  assert.match(between('private noteActivity()', 'private async armSoon()'),
    /checkDue\(now, this\.lastCheckAt\) && !this\.checking && !this\.resetting && this\.hasSockets\(\)/);
});

test('an edit from a shared doc\'s guests counts as activity', () => {
  assert.match(board, /import \{ BoardBridge, isDocRoomOrigin \} from "\.\/bridge";/);
  assert.match(board, /if \(isSocket\(origin\) \|\| isDocRoomOrigin\(origin\)\) this\.noteActivity\(\)/);
});

test('a failed save always has a retry alarm', () => {
  assert.match(board, /onBaseline: \(b: unknown\) => \{ this\.put\(BASELINE_KEY, b\); if \(\(b as any\)\?\.dirty && this\.retryWanted\(\)\) void this\.armSoon\(\); \}/);
  assert.match(board, /private retryWanted\(\): boolean \{\s*try \{ return this\.alarmDelay\(\) != null; \} catch/);
  assert.match(between('private alarmDelay()', 'private retryWanted()'), /dirtySince: this\.remote\.dirtySince/);
  const next = between('private alarmDelay()', 'private retryWanted()');
  assert.match(next, /busy: this\.remote\.pendingForeign \|\| this\.remote\.inFlight != null/);
});

test('a failed local append survives a nap', () => {
  assert.match(board, /const UNLOGGED_KEY = "unlogged"/);
  const start = between('async onStart()', 'async onLoad()');
  assert.match(start, /UNLOGGED_KEY\]\)/, 'read in the batched get');
  assert.match(start, /if \(saved\.get\(UNLOGGED_KEY\)\) this\.unlogged = true/);
  assert.match(between('private markUnlogged()', 'private compactLocal()'), /this\.put\(UNLOGGED_KEY, true\)/);
  assert.match(board, /this\.markUnlogged\(\);\n\s+console\.error\(`\[board \$\{this\.name\}\] local log append failed`/);
  assert.match(between('private compactLocal()', 'isReadOnly('), /storage\.delete\(UNLOGGED_KEY\)/);
  assert.match(between('async onSave()', 'private markUnlogged()'), /this\.local\.pending > 0 \|\| this\.unlogged/);
  assert.match(between('private async roomEmptied()', 'private noteActivity()'), /this\.local\.pending > 0 \|\| this\.unlogged/);
});

test('the pings hello goes out only when the edge answers PING', () => {
  assert.match(board, /this\.pingsAnswered = true;/);
  assert.match(board, /if \(this\.pingsAnswered\) this\.sendCustomMessage\(conn, PINGS_HELLO\)/);
});
