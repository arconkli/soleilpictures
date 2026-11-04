// The board room's half of working live together, pinned by text (the party
// .ts files can't be imported by node), like partyAccessRecheck.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const board = read('../../party/board.ts');
const together = read('../../party/together.ts');

test('board.ts builds the watch after the base start and feeds it edits and presence', () => {
  assert.match(board, /import \{ TogetherWatch \} from "\.\/together";/);
  assert.ok(board.indexOf('new TogetherWatch(') > board.indexOf('await super.onStart()'));
  assert.match(board, /this\.document\.on\("update", \(_update: Uint8Array, origin: unknown\) => this\.together\?\.onDocUpdate\(origin\)\)/);
  assert.match(board, /awareness\.on\("change",[\s\S]*?this\.together\?\.onAwarenessChange\(/);
});

test('the minute alarm ticks the watch with the sockets that stay', () => {
  const alarm = board.slice(board.indexOf('async onAlarm()'));
  const silent = alarm.indexOf('"silent"');
  const tick = alarm.indexOf('this.together?.tick(stays)');
  const retry = alarm.indexOf('this.remote.retryIfDirty()');
  assert.ok(silent > -1 && tick > silent && retry > tick);
  assert.equal(alarm.split('stays.push(c)').length - 1, 2, 'only the non-closing paths keep a socket');
});

test('together.ts asks the database as the service role, about verified accounts', () => {
  assert.match(together, /\/rest\/v1\/rpc\/live_together_tick/);
  assert.match(together, /p_board[\s\S]*p_people[\s\S]*p_ended/);
  assert.match(together, /AbortSignal\.timeout\(/);
  assert.match(together, /res\.status === 404\) \{ this\.offUntil =/);
  assert.match(together, /state\?\.userId/);
  assert.doesNotMatch(together, /\.user\b/, 'never a browser-announced name or id');
  assert.match(together, /from "\.\.\/src\/lib\/togetherClock\.js"/);
});

test('together.ts never asks about a crowd and remembers who the database turned away', () => {
  assert.doesNotMatch(together, /\.slice\(0, MAX_PEOPLE\)/);
  assert.match(together, /active\.length <= MAX_PEOPLE/);
  assert.match(together, /togetherSeconds\(active, now, this\.lastTickAt, new Set\(this\.turnedAway\.keys\(\)\)\)/);
  assert.match(together, /this\.turnedAway\.set\(r\.id, now \+ TURNED_AWAY_MS\)/);
});
