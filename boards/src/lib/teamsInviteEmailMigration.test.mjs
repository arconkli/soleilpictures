// 0541: the team invite email (Team S4), pinned at the source. The gate is a
// re-emit of a live function every invitation passes through, so it may change
// only the one line that names team_invite; every invite spends the inviter's
// daily allowance before its email is queued; a resend never says "sent"
// before an email can go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';

const F = '0541_team_invite_email.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, F), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const body = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  assert.equal(d.file, F, `${fn}'s latest definition must be ${F}`);
  return code(d.body);
};
// The body of fn as one earlier migration wrote it.
function bodyIn(file, fn) {
  const s = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  const at = s.indexOf(`function public.${fn}(`);
  assert.ok(at >= 0, `${fn} not in ${file}`);
  const open = s.slice(at).match(/as (\$[a-z_]*\$)/i);
  const start = at + open.index + open[0].length;
  return s.slice(start, s.indexOf(open[1], start));
}

test('0541 is one transaction that proves its own grants, with no DROP', () => {
  assert.match(sql, /STATUS: APPLIED 2026-10-27 on the owner's go, as three parts/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /set local lock_timeout = '3s';/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /has_function_privilege\('authenticated'/);
  assert.match(sql, /an overload exists \(PGRST203\)/);
  assert.match(sql, /the invite email trigger is missing/);
  assert.doesNotMatch(code(sql), /\bdrop\s+(function|table|trigger|policy)\b/i);
});

test('the gate is 0421\'s live body with team_invite added to stranger mail, and nothing else', () => {
  const before = bodyIn('0421_file_shares.sql', '_outbound_gate');
  const after = bodyIn(F, '_outbound_gate');
  const line = "when p_template in ('pending_invite', 'board_shared', 'workspace_invite', 'file_shared') then 'stranger'";
  assert.ok(before.includes(line));
  assert.equal(after, before.replace(line,
    "when p_template in ('pending_invite', 'board_shared', 'workspace_invite', 'file_shared', 'team_invite') then 'stranger'"));
  assert.equal(latestDefinition('_outbound_gate').file, F);
});

test('every invite spends the allowance before its email, and the email names the inviter by address', () => {
  const tg = body('_tg_org_invite_email');
  const spend = tg.indexOf('public._invite_budget_take()');
  const send = tg.indexOf('public._team_invite_email(new.id)');
  assert.ok(spend > 0 && send > spend, 'allowance first, then the email');
  assert.match(sql, /create or replace trigger org_invites_email\s+after insert on public\.org_invites\s+for each row execute function public\._tg_org_invite_email\(\);/);

  const mail = body('_team_invite_email');
  assert.match(mail, /select u\.email into v_inviter from auth\.users u where u\.id = v_i\.invited_by/);
  assert.doesNotMatch(mail, /display_name/, 'a stranger reads this: never a typed display name (0358)');
  assert.match(mail, /'team_invite'/);
  assert.match(mail, /'token',\s+v_i\.token::text/);
  assert.match(mail, /email_workspace_invite/, 'an account that turned invitation emails off gets none');
  // Spent whether or not an email goes: the allowance must not say whether an account has the address.
  assert.doesNotMatch(tg, /_email_pref_enabled/);
});

test('resend: owner or admin, an open invite, once a day, and the allowance only when it sends', () => {
  const r = body('resend_team_invite');
  const admin = r.indexOf('_org_is_admin(v_i.org_id, v_uid)');
  const closed = r.indexOf("return 'closed'");
  const soon = r.indexOf("return 'too_soon'");
  const spend = r.indexOf('public._invite_budget_take()');
  const mail = r.indexOf('public._team_invite_email(v_i.id)');
  const sent = r.indexOf("return 'sent'");
  assert.ok(admin > 0 && admin < closed && closed < soon && soon < spend && spend < mail && mail < sent);
  assert.match(r, /v_i\.expires_at <= now\(\)/, 'an expired invite is closed, never revived past the seat count');
  assert.match(r, /coalesce\(v_i\.resent_at, v_i\.created_at\) > now\(\) - interval '1 day'/);
  assert.match(r, /_actor_can_send\(\)/);
  assert.match(sql, /add column if not exists resent_at timestamptz/);
});

test('grants: the helpers are no session\'s, the resend is a signed-in call', () => {
  for (const fn of ['_team_invite_email\\(uuid\\)', '_tg_org_invite_email\\(\\)']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn} from public, anon, authenticated;`));
  }
  assert.match(sql, /revoke execute on function public\.resend_team_invite\(uuid\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.resend_team_invite\(uuid\) to authenticated;/);
  assert.doesNotMatch(code(sql), /grant execute on function public\._/);
});
