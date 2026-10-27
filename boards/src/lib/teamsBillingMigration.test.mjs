// 0538: a team pays for itself (Team S3), pinned at the source. The edge
// functions (team-billing, team-billing-cron, stripe-webhook's team branch)
// talk to Stripe; this file decides what Stripe's answers mean, so the rules
// that move money or decide who edits are pinned here. teamBillingCore.test.mjs
// pins the Stripe half. Probe F (rolled back, on live) runs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';

const F = '0538_teams_billing.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, F), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const def = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return d;
};
const body = (fn) => code(def(fn).body);

const HELPERS = ['_tg_org_subscriptions_guard', '_team_grace_days', '_team_entitled', '_org_billing_apply',
  '_team_mirror_upsert', '_create_team_for', '_team_checkout_complete', '_team_mark_seats_billed',
  '_team_trim_seats', '_team_billing_poke', '_tg_org_seat_changes_sync', '_tg_organizations_closed_sync',
  '_team_billing_tick'];
const CLIENT = ['create_team', 'start_team_checkout', 'get_team_billing', 'set_team_seats'];
const SERVICE = ['_team_checkout_complete', '_team_mirror_upsert', '_org_billing_apply', '_team_mark_seats_billed',
  '_team_trim_seats'];

test('0538 is written, not applied: one transaction that proves its grants and changes nothing while no team exists', () => {
  assert.match(sql, /STATUS: APPLIED 2026-10-25 on the owner's go/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /set local lock_timeout = '3s';/);
  assert.match(sql, /Rebased on[\s\S]*create_team\s+[0-9a-f]{32}/, 'names the live create_team it replaces');
  assert.match(sql, /if exists \(select 1 from public\.organizations\) then\s+raise exception '0538: an organization exists';/);
  assert.doesNotMatch(code(sql), /\bdrop\s+(function|table|trigger|policy)\b/i, 'no DROP');
  assert.doesNotMatch(code(sql), /\b100\b/, 'no literal 100: the ceiling is organizations.seat_ceiling (amendment B)');
});

test('every function lives in 0538, once, and the helpers are server-only', () => {
  assert.deepEqual([...code(sql).matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort(),
    [...HELPERS, ...CLIENT].sort(), '0538 defines exactly its share');
  for (const fn of [...HELPERS, ...CLIENT]) assert.equal(def(fn).file, F, `${fn}'s latest definition must be ${F}`);
  const c = code(sql);
  for (const fn of HELPERS) {
    assert.match(c, new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`),
      `${fn} is revoked from clients`);
    assert.ok(sql.includes(`'public.${fn}(`), `the proof block checks ${fn}`);
  }
  for (const fn of SERVICE)
    assert.match(c, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`), `${fn}: service_role`);
  for (const fn of ['start_team_checkout', 'get_team_billing', 'set_team_seats']) {
    assert.match(c, new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon;`), `${fn}: not signed out`);
    assert.match(c, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`), `${fn}: signed in`);
  }
  for (const t of ['org_subscriptions', 'team_checkouts']) {
    assert.match(c, new RegExp(`alter table public\\.${t} enable row level security;`), `${t}: RLS on`);
    assert.match(c, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated;`), `${t}: server-only`);
    assert.match(c, new RegExp(`grant select, insert, update, delete on public\\.${t} to service_role;`), `${t}: the functions reach it`);
  }
  assert.match(sql, /group by p\.proname having count\(\*\) > 1\) then\s+raise exception '0538: an overload exists/);
});

test('a team starts at checkout: create_team refuses, and its body is the paid path\'s', () => {
  const ct = body('create_team');
  assert.match(ct, /raise exception 'a team starts at checkout' using errcode = '42501', hint = 'team_checkout';/);
  assert.doesNotMatch(ct, /insert into/, 'create_team writes nothing');
  // 0532's pins, now on _create_team_for.
  const c = body('_create_team_for');
  assert.ok(c.includes('public._user_banned(p_owner)'), 'a banned account owns no team');
  assert.match(c, /returning id, seat_ceiling into v_org, v_ceiling;/);
  assert.match(c, /if p_seats > v_ceiling then/);
  assert.equal((c.match(/insert into public\.org_seat_changes/g) || []).length, 1, 'the one create row');
  assert.ok(c.includes("'create', p_owner)"));
  assert.doesNotMatch(c, /update public\.organizations/, 'no other seat write');
  assert.ok(c.includes("hint = 'team_exists'"));
  assert.ok(c.includes("pg_advisory_xact_lock(hashtext('team_create:' || p_owner::text))"), 'one open team per owner');
  assert.doesNotMatch(c, /auth\.uid\(\)/, 'the webhook has no caller: the owner is passed');
});

test('start_team_checkout checks everything before Stripe is asked', () => {
  const s = body('start_team_checkout');
  for (const want of [
    'public._actor_active()',
    "public._teams_open_for(v_uid) then\n    raise exception 'teams are not open yet' using errcode = '42501', hint = 'teams_closed';",
    "pg_advisory_xact_lock(hashtext('team_checkout:' || v_uid::text))",
    "hint = 'team_checkout_rate'", "hint = 'team_not_owner'", "hint = 'team_has_plan'", "hint = 'team_exists'",
    "hint = 'team_workspace'", "hint = 'team_seats_needed', detail = v_need::text",
    'w.created_by = v_uid and w.org_id is null',
  ]) assert.ok(s.includes(want), `start_team_checkout: ${want}`);
  // Seats needed: the team made and the workspaces moved in, then undone.
  const preview = s.slice(s.indexOf('v_org := public._create_team_for('), s.indexOf("exception when sqlstate 'SLPV0'"));
  assert.ok(preview.includes('public._org_move_in(v_w, v_org, v_uid, true)'));
  assert.ok(preview.includes("raise exception 'preview only' using errcode = 'SLPV0';"));
  assert.ok(s.includes('greatest(3, public._team_seats_used(v_org))'));
  // One trial per owner (decision 1): one that made a team counts.
  assert.ok(s.includes('c.owner_id = v_uid and c.trial and c.org_id is not null'));
  // A renewal never trials, and drops unused seats.
  const renew = s.slice(s.indexOf('if p_org_id is not null then'), s.indexOf("'kind', 'renew'"));
  assert.ok(renew.includes('greatest(3, public._team_seats_used(p_org_id))'));
  assert.doesNotMatch(renew, /\btrial\b(?!'?,\s*false)/, 'no trial on a renewal');
});

test('_team_checkout_complete is idempotent, makes a team only once it is paid, and refunds only a refusal', () => {
  const c = body('_team_checkout_complete');
  assert.ok(c.includes('from public.team_checkouts where id = p_checkout for update'), 'one completion at a time');
  assert.ok(c.includes("raise exception 'a team checkout completes with its subscription'"));
  assert.ok(c.includes("'session_mismatch'"));
  assert.match(c, /if coalesce\(p_mirror ->> 'status', ''\) not in \('active', 'trialing'\) then\s+return jsonb_build_object\('ok', false, 'error', 'not_paid'\);/);
  assert.ok(c.indexOf("'not_paid'") < c.indexOf('public._create_team_for('), 'paid before made');
  // Refusals (42501, 22023) are recorded for the caller to cancel and refund;
  // anything else raises so the webhook retries.
  assert.match(c, /if v_state not in \('42501', '22023'\) then\s+raise;/);
  assert.match(c, /if v_state not in \('42501', '22023', 'P0002'\) then\s+raise;/);
  assert.ok(c.includes("where org_id = v_org and reason = 'create' and billed_at is null"), 'the checkout bills its seats');
  assert.ok(c.includes("_org_add_seats(v_org, c.seats - v_seats, 'checkout', c.owner_id)"));
  assert.ok(c.includes('public._team_mirror_upsert(v_org, p_mirror)'));
  assert.ok(c.includes("'subscription', v_sub"), 'tells the caller which subscription the team follows');
});

test('who edits: active and trialing, past_due for the grace days, nothing else', () => {
  assert.match(body('_team_grace_days'), /select 14;/, 'the design: 14 days of grace');
  const e = body('_team_entitled');
  assert.ok(e.includes("when p_status in ('active', 'trialing') then true"));
  assert.ok(e.includes("p_past_due_since > now() - make_interval(days => public._team_grace_days())"));
  assert.ok(e.includes('else false end'));
  const a = body('_org_billing_apply');
  assert.ok(a.includes('v_ok := public._team_entitled(s.status, s.past_due_since);'));
  assert.ok(a.includes("first_paid_at   = case when o.first_paid_at is null and s.status = 'active' then now()"),
    'the first payment ends the trial drive');
  assert.ok(a.includes('storage_blocks  = s.storage_blocks'));
  for (const k of ['team.view_only', 'team.active_again', 'team.payment_failed']) assert.ok(a.includes(`'${k}'`), k);
  // Grace runs out on the clock: the tick applies it.
  const t = body('_team_billing_tick');
  assert.ok(t.includes("(o.status = 'active') <> public._team_entitled(s.status, s.past_due_since)"));
  assert.ok(t.includes('perform public._org_billing_apply(r.org_id);'));
  assert.match(code(sql), /select cron\.schedule\('team-billing-every-10-min', '\*\/10 \* \* \* \*', 'select public\._team_billing_tick\(\)'\);/);
});

test('the mirror keeps the newest observation of the subscription that bills', () => {
  const g = body('_tg_org_subscriptions_guard');
  assert.match(g, /new\.observed_at < old\.observed_at then\s+return null;/, 'an older observation is dropped');
  assert.match(g, /old\.status in \('active', 'trialing', 'past_due'\) then\s+return null;/,
    'another subscription waits until the stored one stops billing');
  assert.ok(g.includes('coalesce(old.past_due_since, now())'), 'the grace clock starts once');
  assert.match(code(sql), /before insert or update on public\.org_subscriptions\s+for each row execute function public\._tg_org_subscriptions_guard\(\);/);
  assert.match(code(sql), /create unique index if not exists org_subscriptions_subscription_key\s+on public\.org_subscriptions \(stripe_subscription_id\) where stripe_subscription_id is not null;/);
});

test('seats follow the database: every change pokes the sync except the ones their own path bills', () => {
  assert.match(body('_tg_org_seat_changes_sync'), /if new\.reason not in \('create', 'checkout', 'admin_add'\) then\s+perform public\._team_billing_poke\(new\.org_id\);/);
  assert.match(code(sql), /after update of closed_at on public\.organizations\s+for each row when \(old\.closed_at is null and new\.closed_at is not null\)/);
  assert.match(body('_team_billing_poke'), /exception when others then\s+raise warning/, 'a poke never breaks the change');
  const trim = body('_team_trim_seats');
  assert.ok(trim.includes("pg_advisory_xact_lock(hashtext('team_seats:' || p_org::text))"), 'the team seat lock');
  assert.ok(trim.includes('greatest(3, public._team_seats_used(p_org))'), 'never below 3 or what is used');
  assert.ok(trim.includes("'renewal', null)"));
  // An admin's purchase is a total: a retry can't buy twice, and it never lowers the count.
  const set = body('set_team_seats');
  assert.ok(set.includes('public._org_is_admin(p_org_id, v_uid)'));
  assert.ok(set.indexOf("pg_advisory_xact_lock(hashtext('team_seats:'") < set.indexOf('select o.seats'), 'lock before the read');
  assert.match(set, /if p_seats <= v_seats then\s+return v_seats;/);
  assert.ok(set.includes("hint = 'team_view_only'") && set.includes("hint = 'team_seats_ceiling'"));
  assert.ok(set.includes("_org_add_seats(p_org_id, p_seats - v_seats, 'admin_add', v_uid)"));
  assert.match(code(sql), /check \(reason in \('create', 'admin_add', 'admin_remove', 'auto', 'approve', 'move_in', 'renewal', 'checkout'\)\)/);
});

test('get_team_billing is for the owner and admins, and never hands out a Stripe id', () => {
  const g = body('get_team_billing');
  assert.ok(g.includes('public._org_is_admin(p_org_id, v_uid)'));
  assert.doesNotMatch(g, /'stripe_/, 'no Stripe ids');
});
