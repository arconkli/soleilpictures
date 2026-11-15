// 0897: finishing Team, pinned at the source. It re-creates get_team_billing
// (0538's body plus seat_perk) and adds the two trigger functions that tell
// admins who joined (team.joined) and tell someone kept as a viewer
// (team.kept_viewer). teamsBillingMigration.test.mjs pins the rest of
// get_team_billing's body; this file pins what 0897 itself must keep true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';

const F = '0897_team_finish.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, F), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const c = code(sql);
const def = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return d;
};
const body = (fn) => code(def(fn).body);

const TRIGGER_FNS = ['_tg_team_note_joined', '_tg_team_note_kept'];

test('0897 defines exactly get_team_billing and the two trigger functions, and each is the latest', () => {
  assert.deepEqual([...c.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort(),
    ['_tg_team_note_joined', '_tg_team_note_kept', 'get_team_billing'], '0897 defines exactly its share');
  for (const fn of ['get_team_billing', ...TRIGGER_FNS]) assert.equal(def(fn).file, F, `${fn}'s latest definition must be ${F}`);
});

test('0897 is three transactions that drop nothing but its own two triggers', () => {
  const begins = c.match(/^begin;$/gm) || [];
  const commits = c.match(/^commit;$/gm) || [];
  assert.equal(begins.length, 3, 'three begin blocks');
  assert.equal(commits.length, begins.length, 'every begin has its commit');
  assert.doesNotMatch(c, /\bdrop\s+(function|table|policy)\b/i, 'no DROP function, table or policy');
  assert.deepEqual([...c.matchAll(/\bdrop\s+trigger\s+if exists\s+(\w+)\s+on\s+public\.(\w+)/gi)].map((m) => `${m[1]} on ${m[2]}`).sort(),
    ['org_join_requests_note_kept_trg on org_join_requests', 'org_members_note_joined_trg on org_members'],
    'the only drops are its own two triggers, re-created straight after');
});

test('get_team_billing stays for signed-in people, for owners and admins, and gains seat_perk', () => {
  assert.match(c, /revoke execute on function public\.get_team_billing\(uuid\) from public, anon;/);
  assert.match(c, /grant execute on function public\.get_team_billing\(uuid\) to authenticated;/);
  const g = body('get_team_billing');
  assert.ok(g.includes("'seat_perk'"), 'returns seat_perk');
  assert.ok(g.includes('public._org_is_admin(p_org_id, v_uid)'), 'the owner/admin gate');
  assert.doesNotMatch(g, /'stripe_/, 'no Stripe ids');
});

test('both trigger functions are server-only and catch their own errors', () => {
  for (const fn of TRIGGER_FNS) {
    assert.match(c, new RegExp(`revoke execute on function public\\.${fn}\\(\\) from public, anon, authenticated;`),
      `${fn} is revoked from clients`);
    assert.match(body(fn), /exception when others then\s+raise warning/,
      `${fn}: a notice never undoes a join or a decision`);
  }
});

test('the join notice fires once the joining function is done; the kept notice fires on pending to kept', () => {
  assert.match(c, /create constraint trigger org_members_note_joined_trg\s+after insert on public\.org_members\s+deferrable initially deferred\s+for each row\s+execute function public\._tg_team_note_joined\(\);/);
  assert.match(c, /create trigger org_join_requests_note_kept_trg\s+after update of status on public\.org_join_requests\s+for each row\s+when \(old\.status = 'pending' and new\.status = 'kept'\)\s+execute function public\._tg_team_note_kept\(\);/);
});

test('the notice kinds are team.joined and team.kept_viewer', () => {
  assert.ok(body('_tg_team_note_joined').includes("'team.joined'"));
  assert.ok(body('_tg_team_note_kept').includes("'team.kept_viewer'"));
  assert.match(body('_tg_team_note_joined'), /if new\.joined_via = 'create' then return null; end if;/, 'the team\'s own creation never counts');
});

test('the proof block checks every grant and both triggers', () => {
  const proof = sql.slice(sql.lastIndexOf('do $$'));
  assert.match(proof, /has_function_privilege\('anon', 'public\.get_team_billing\(uuid\)', 'execute'\)/, 'anon cannot run get_team_billing');
  assert.match(proof, /not has_function_privilege\('authenticated', 'public\.get_team_billing\(uuid\)', 'execute'\)/, 'signed-in people can');
  for (const fn of TRIGGER_FNS) assert.ok(proof.includes(`'public.${fn}()'`), `the proof block names ${fn}`);
  assert.match(proof, /has_function_privilege\('anon', v_fn, 'execute'\)\s+or has_function_privilege\('authenticated', v_fn, 'execute'\)/,
    'neither anon nor authenticated can run the trigger functions');
  assert.match(proof, /t\.tgname = 'org_members_note_joined_trg'[\s\S]*?t\.tgdeferrable and t\.tginitdeferred/, 'the deferred trigger is checked');
  assert.match(proof, /t\.tgname = 'org_join_requests_note_kept_trg'/, 'the kept trigger is checked');
});
