// messagesAreWork.test.mjs — a day spent sending messages is a working day
// (owner, 2026-10-20; 0473).
//
//   node --test src/lib/messagesAreWork.test.mjs
//
// The rule lives in three places and each can lose it alone: the server stamp
// (a trigger on messages, here), the client's WORK_EVENTS, which stamps the
// heartbeat's did_work and the session summary's `wrote` (here and in
// sessionSummary.test.mjs), and the engaged-visit read
// (engagedVisitsMigration.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';
import { EV, WORK_EVENTS } from './analyticsEvents.js';

const FILE = '0473_messages_are_work.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');

test("a stored message stamps its sender's day as work, from the server", () => {
  const def = latestDefinition('_stamp_active_day_message');
  assert.ok(def && def.file === FILE, '0473 owns the trigger body');
  assert.match(def.body, /new\.kind is distinct from 'user' or new\.sender_id is null/,
    "only a person's own message counts, never a system line");
  assert.match(def.body, /insert into public\.user_active_day \(user_id, day, did_work, work_ops\)\s+values \(new\.sender_id, current_date, true, 1\)/);
  assert.match(def.body, /exception when others then\s+raise warning/,
    'a failed stamp must never cost anyone their message');
  assert.match(src, /create or replace trigger messages_active_day\s+after insert on public\.messages\s+for each row execute function public\._stamp_active_day_message\(\)/);
});

test('the trigger function is closed to every client role, and that is proven', () => {
  assert.match(src, /revoke all on function public\._stamp_active_day_message\(\) from public, anon, authenticated/);
  assert.ok(src.includes("has_function_privilege(v_role, 'public._stamp_active_day_message()', 'execute')"),
    'a REVOKE that reports success proves nothing');
});

test('the backfill keeps the did_work floor and runs before the trigger exists', () => {
  const backfill = src.indexOf('do $backfill$');
  const trigger = src.indexOf('create or replace trigger messages_active_day');
  assert.ok(backfill > 0 && backfill < trigger, 'so no message is counted twice');
  assert.match(src, /\(m\.created_at at time zone 'UTC'\)::date >= v_floor/, 'days before the floor stay unmeasured');
  assert.match(src, /raise exception '0473: the did_work floor moved/);
});

test('the client counts a sent message as work too', () => {
  assert.ok(WORK_EVENTS.has(EV.MSG_SEND), 'a messages-only visit would read as presence on the client');
});
