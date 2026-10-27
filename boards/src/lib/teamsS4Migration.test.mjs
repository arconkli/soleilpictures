// 0540: what Team setup and the domain check read (Team S4), pinned at the
// source. preview_team_seats must count exactly as start_team_checkout (0538)
// does, or setup would show one number and checkout ask for another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';

const F = '0540_teams_setup_and_domains.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, F), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const body = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return code(d.body);
};
const CLIENT = ['preview_team_seats', 'team_domain_challenge'];

test('0540 is one transaction that proves its own grants, with no DROP', () => {
  assert.match(sql, /STATUS: written 2026-10-25\. Applied 2026-10-26 \(owner's go\)/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /set local lock_timeout = '3s';/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /has_function_privilege\('authenticated'/);
  assert.match(sql, /an overload exists \(PGRST203\)/);
  assert.doesNotMatch(code(sql), /\bdrop\s+(function|table|trigger|policy)\b/i);
});

test('0540 defines exactly its two client reads, callable signed in and never signed out', () => {
  assert.deepEqual([...code(sql).matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort(),
    [...CLIENT].sort());
  for (const fn of CLIENT) {
    assert.equal(latestDefinition(fn).file, F, `${fn}'s latest definition must be ${F}`);
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon;`), `${fn}: revoked`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`), `${fn}: granted`);
  }
});

test('setup counts seats the way checkout does, refusing in checkout\'s order', () => {
  const preview = body('preview_team_seats');
  const checkout = body('start_team_checkout');
  for (const step of [
    /public\._create_team_for\(v_uid, '[^']+', null, 3\)/,
    /perform public\._org_move_in\(v_w, v_org, v_uid, true\);/,
    /v_need := greatest\(3, public\._team_seats_used\(v_org\)\);/,
    /raise exception 'preview only' using errcode = 'SLPV0';/,
    /exception when sqlstate 'SLPV0' then\s+null;/,
  ]) assert.match(preview, step);
  assert.match(checkout, /v_need := greatest\(3, public\._team_seats_used\(v_org\)\);/, 'checkout still counts this way');
  const order = (s, hints) => hints.map((h) => s.indexOf(`hint = '${h}'`));
  const hints = ['teams_closed', 'team_exists', 'team_workspace'];
  const at = order(preview, hints);
  assert.ok(at.every((i) => i > 0), `preview raises ${hints.join(', ')}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in checkout\'s order');
  assert.match(preview, /w\.created_by = v_uid and w\.org_id is null/, 'only the caller\'s own personal workspaces');
  assert.match(preview, /cardinality\(v_ws\) > 50/);
});

test('a domain\'s challenge is the owner\'s and admins\' to read, and only for an open team', () => {
  const ch = body('team_domain_challenge');
  assert.match(ch, /if not public\._org_is_admin\(p_org_id, v_uid\) then/);
  assert.match(ch, /then 'team_not_member' else 'team_not_admin' end/);
  assert.match(ch, /'soleil-verification=' \|\| d\.verify_token/);
  assert.match(ch, /o\.closed_at is null/);
  assert.match(ch, /d\.domain = public\._team_norm_domain\(p_domain\)/);
  assert.match(ch, /hint = 'team_domain_missing'/);
  // get_team shows the same pair, so the page and the check can't disagree.
  assert.match(body('get_team'), /'soleil-verification=' \|\| d\.verify_token/);
});
