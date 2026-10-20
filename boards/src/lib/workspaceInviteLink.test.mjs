// 0450: the whole-workspace invite link. Pinned at the source, the latest
// migration definition, so a later rewrite cannot quietly drop a check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestDefinition, latestMatch } from './migrationText.mjs';
import { NAME_MAX } from './workspaceSetup.js';

const body = (name) => {
  const d = latestDefinition(name);
  assert.ok(d, `no definition of ${name}`);
  return d.body;
};

function constant(text, name) {
  const m = text.match(new RegExp(`${name}\\s+constant\\s+integer\\s*:=\\s*(\\d+)`));
  assert.ok(m, `missing constant ${name}`);
  return Number(m[1]);
}

test('a link opens nothing while its maker or the workspace owner is suspended or the maker lost the role', () => {
  const b = body('_workspace_invite_link_live');
  for (const s of [
    'l.revoked_at is null',
    'l.expires_at > now()',
    '< l.max_uses',
    'public._sharer_suspended(l.created_by)',
    'p.send_hold_at is not null',
    'public._user_banned(w.created_by)',
    "m.role = 'coowner'",
  ]) assert.ok(b.includes(s), `_workspace_invite_link_live lacks ${s}`);
});

test('making a link is gated, locked, and tighter for a new account', () => {
  const b = body('create_workspace_invite_link');
  assert.match(b, /if not public\._actor_can_send\(\) then/);
  assert.ok(b.includes('public.can_manage_workspace(p_workspace_id)'));
  assert.ok(b.includes('pg_advisory_xact_lock('));
  assert.ok(b.includes('public._account_is_new()'));
  assert.match(b, /p_role not in \('editor', 'viewer'\)/, 'only editor or viewer');

  const c = (n) => constant(b, n);
  assert.ok(c('c_new_uses') < c('c_uses'), 'a new account gets fewer joins');
  assert.ok(c('c_new_days') < c('c_days'), 'a new account gets fewer days');
  assert.ok(c('c_new_links_per_day') < c('c_links_per_day'), 'a new account gets fewer links a day');
  assert.ok(c('c_uses') <= 100, 'the table CHECK allows at most 100 uses');
});

test('turning a link off needs an active account that manages the workspace', () => {
  const b = body('revoke_workspace_invite_link');
  assert.match(b, /if not public\._actor_active\(\) then/);
  assert.ok(b.includes('public.can_manage_workspace(v_workspace)'));
});

test('joining needs a session, an active account, a live link, and a lock', () => {
  const b = body('claim_workspace_invite_link');
  assert.match(b, /if auth\.uid\(\) is null then/);
  assert.match(b, /if not public\._actor_active\(\) then/);
  assert.ok(b.includes('for update'));
  assert.ok(b.includes('public._workspace_invite_link_live(p_token)'));
  assert.ok(b.includes('ops_alert_raise('));
  assert.ok(b.includes("set_config('soleil.ws_link_join', '1', true)"));
  assert.ok(b.includes("set_config('soleil.ws_link_join', '', true)"));
  assert.ok(
    b.indexOf("set_config('soleil.ws_link_join', '1', true)") < b.indexOf("set_config('soleil.ws_link_join', '', true)"),
    'the flag is set, then reset',
  );
  assert.doesNotMatch(b, /'token'/, 'the token never reaches analytics or the referral meta');
});

test('the burst rule can fire before the link runs out', () => {
  const burst = constant(body('claim_workspace_invite_link'), 'c_burst');
  assert.ok(burst < constant(body('create_workspace_invite_link'), 'c_uses'));
});

test('the preview cleans both names and never returns an address', () => {
  const b = body('peek_workspace_invite_link');
  assert.ok(b.includes(`public._safe_label(v_name, ${NAME_MAX}`), 'workspace name cut at NAME_MAX');
  assert.ok(b.includes('public._safe_label(v_first, 30'));
  assert.doesNotMatch(b, /email/i);
});

test('the member email trigger stays quiet for a link join and still skips service roles', () => {
  const d = latestDefinition('_tg_workspace_member_email');
  assert.ok(d.body.includes("current_setting('soleil.ws_link_join', true) = '1'"));
  assert.ok(d.body.includes("new.role = 'service'"));
});

test('_safe_label writes its special characters as \\x escapes, in plain ASCII', () => {
  const b = body('_safe_label');
  assert.ok(b.includes("normalize(coalesce(p_value, ''), NFKC)"));
  assert.ok(b.includes('chr(8230)'));
  assert.doesNotMatch(b, /\\u[0-9a-f]{4}/i, 'tooling rewrites \\u escapes into invisible characters');
  for (const ch of b) assert.ok(ch.codePointAt(0) < 128, `non-ASCII character U+${ch.codePointAt(0).toString(16)}`);
});

test('only the preview is callable signed out; the helpers are not callable by clients', () => {
  assert.ok(latestMatch(/grant execute on function public\.peek_workspace_invite_link\(uuid\) to anon/));
  assert.ok(latestMatch(/revoke execute on function public\._safe_label\(text, integer, text\) from public, anon, authenticated/));
  assert.ok(latestMatch(/revoke execute on function public\._workspace_invite_link_live\(uuid\) from public, anon, authenticated/));
  for (const sig of ['create_workspace_invite_link(uuid, text)', 'claim_workspace_invite_link(uuid)', 'revoke_workspace_invite_link(uuid)']) {
    const re = new RegExp(`revoke (?:all|execute) on function public\\.${sig.replace(/[()]/g, '\\$&')} from public, anon`);
    assert.ok(latestMatch(re), `${sig} is not revoked from public, anon`);
  }
});
