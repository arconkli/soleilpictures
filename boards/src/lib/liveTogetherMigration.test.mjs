// 0862: working live together pays cards. The numbers and the guards are
// pinned at the source (the latest migration definition). Text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';
import { EV } from './analyticsEvents.js';
import { TOGETHER_CARD_SECONDS, TOGETHER_MONTH_CAP, TOGETHER_MAX_BOOST } from './liveTogether.js';
import { MAX_TICK_SECONDS } from './togetherClock.js';

const tick = latestDefinition('live_together_tick');
assert.ok(tick, 'no definition of live_together_tick');
const body = tick.body;
const file = readFileSync(join(MIGRATIONS_DIR, tick.file), 'utf8');
const num = (name) => Number(body.match(new RegExp(`${name}\\s+constant\\s+integer\\s*:=\\s*(\\d+)`))?.[1]);

test('the latest live_together_tick is 0862\'s, definer, empty search path', () => {
  assert.match(tick.file, /_live_together\.sql$/);
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = ''/);
});

test('the constants match the code that tells people about them', () => {
  assert.equal(num('c_card_seconds'), TOGETHER_CARD_SECONDS);
  assert.equal(num('c_month_cap'), TOGETHER_MONTH_CAP);
  assert.equal(num('c_max_boost'), TOGETHER_MAX_BOOST);
  assert.equal(num('c_max_tick'), MAX_TICK_SECONDS);
});

test('only real people earn', () => {
  for (const clause of [
    'email_confirmed_at is not null', 'u.deleted_at is null', 'not u.is_anonymous',
    '_synthetic_address(u.email)', 'not p.is_service', '_user_banned(u.id)',
  ]) assert.ok(body.includes(clause), clause);
});

test('never pays twice: credited under a row lock', () => {
  assert.ok(body.includes('least(r.s, v_wall)'));
  assert.ok(body.includes('for update'));
  assert.ok(body.includes('bonus_card_credits'));
});

test('every event it writes is in the catalog, and all three are written', () => {
  const names = new Set([...body.matchAll(/'(together_[a-z_]+)'/g)].map((m) => m[1]));
  const catalog = new Set([EV.TOGETHER_STARTED, EV.TOGETHER_CARD_EARNED, EV.TOGETHER_ENDED]);
  assert.deepEqual([...names].sort(), [...catalog].sort());
});

test('grants are proved in the file, and the table is closed', () => {
  const must = [
    'revoke execute on function public.live_together_tick(uuid, jsonb, boolean) from public, anon, authenticated',
    'grant execute on function public.live_together_tick(uuid, jsonb, boolean) to service_role',
    'revoke execute on function public.get_my_together_stats() from public, anon',
    'grant execute on function public.get_my_together_stats() to authenticated',
    'alter table public.live_together_months enable row level security',
    'revoke all on public.live_together_months from public, anon, authenticated',
  ];
  for (const s of must) assert.ok(file.includes(s), s);
  assert.ok((file.match(/has_function_privilege/g) || []).length >= 4);
  assert.ok(!file.includes('function public._pay_referral_rewards'));
  assert.ok(!file.includes('function public.get_my_referral_stats'));
});

test('get_my_together_stats is this file\'s and reads the caller', () => {
  const s = latestDefinition('get_my_together_stats');
  assert.equal(s.file, tick.file);
  assert.match(s.body, /auth\.uid\(\)/);
  assert.ok(s.body.includes("'bonus_card_credits'"));
  assert.ok(s.body.includes('p.user_id = auth.uid()'));
});

test('a person is paid by one call at a time, across months', () => {
  assert.match(body, /perform pg_advisory_xact_lock\(hashtextextended\('live_together:' \|\| r\.id::text, 0\)\);/);
  assert.ok(body.indexOf('pg_advisory_xact_lock') < body.indexOf('select max(m.last_credited_at)'));
});
