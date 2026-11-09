// 0450: the whole-workspace invite link. Pinned at the source, the latest
// migration definition, so a later rewrite cannot quietly drop a check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestDefinition, latestMatch, MIGRATIONS_DIR } from './migrationText.mjs';
import { NAME_MAX } from './workspaceSetup.js';
import { JOINING_SCRIPTS, VIRAMAS } from '../../../supabase/functions/_shared/email/safeLabel.mjs';

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
  assert.ok(b.includes("left(normalize(coalesce(p_value, ''), NFKC), 1000)"));
  assert.ok(b.includes('chr(8230)'));
  assert.ok(b.includes('s := public._safe_label_scrub(s);'));
  // The hand-written bodies use \x escapes. Only the generated helpers (0881:
  // _safe_label_marks_a and _b, _numbers, _cjk, _tlds_cjk, _tlds_other_a
  // and _b, _picto and _modifiers, from boards/scripts/gen-idn-tlds.mjs) use
  // fixed-width \u and \U escapes, each in a body that is nothing but the one
  // string it returns; safeLabelSql.test.mjs decodes and checks them, and the
  // ASCII check below catches a tool that rewrites one into the character
  // itself.
  const generated = ['marks_a', 'marks_b', 'numbers', 'cjk', 'tlds_cjk', 'tlds_other_a', 'tlds_other_b', 'picto', 'modifiers'];
  for (const g of generated) {
    assert.match(body('_safe_label_' + g), new RegExp(`^create or replace function public\\._safe_label_${g}\\(\\)\\nreturns text\\nlanguage sql immutable parallel safe\\nset search_path = ''\\nas \\$\\$ select '[^']*'::text \\$\\$;$`));
  }
  const file = readFileSync(MIGRATIONS_DIR + latestDefinition('_safe_label').file, 'utf8');
  const handWritten = file.replace(/\nas \$\$ select '[^']*'::text \$\$;\n/g, '\n');
  assert.equal(file.length - handWritten.length > 10000, true, 'the generated bodies were not found');
  assert.equal((file.match(/\nas \$\$ select '[^']*'::text \$\$;\n/g) || []).length, generated.length);
  assert.doesNotMatch(handWritten, /\\u[0-9a-f]{4}/i, 'tooling rewrites \\u escapes into invisible characters');
  assert.doesNotMatch(body('_safe_label_scrub'), /\\u[0-9a-f]{4}/i);
  for (const ch of file) assert.ok(ch.codePointAt(0) < 128, `non-ASCII character U+${ch.codePointAt(0).toString(16)}`);
});

// The SQL copy of safeLabel keeps the joining scripts the .mjs does: the class
// J in the latest definition of its scrub step is JOINING_SCRIPTS written as
// \x ranges.
test('_safe_label names the same joining scripts as safeLabel.mjs', () => {
  assert.ok(latestDefinition('_safe_label').file >= '0881', 'the latest _safe_label predates 0881');
  const d = latestDefinition('_safe_label_scrub');
  assert.ok(d && d.file >= '0881', `the latest _safe_label_scrub is ${d?.file}`);
  const hex = (n) => n.toString(16).padStart(4, '0');
  const j = JOINING_SCRIPTS.map(([a, b]) => `\\x${hex(a)}-\\x${hex(b)}`).join('');
  assert.ok(d.body.includes(`[${j}]`), 'class J (JOINING_SCRIPTS) is missing or out of step');
  const v = [...VIRAMAS].map((c) => `\\x${hex(c)}`).join('');
  assert.ok(d.body.includes(`[${v}]`), 'class V (VIRAMAS) is missing or out of step');
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

// 0451: a link's terms, for the people who can share it.
test('only a manager of the link\'s workspace reads its terms, and never signed out', () => {
  const b = body('get_workspace_invite_link_terms');
  assert.ok(b.includes('auth.uid() is null or not public._actor_active()'));
  assert.ok(b.includes('public.can_manage_workspace(v_link.workspace_id)'));
  assert.ok(latestMatch(/revoke all on function public\.get_workspace_invite_link_terms\(uuid\) from public, anon/));
  assert.ok(latestMatch(/grant execute on function public\.get_workspace_invite_link_terms\(uuid\) to authenticated, service_role/));
});

// "Maya joined Lost Time": a whole-workspace join names the workspace and
// opens it, never "joined "Studio"" with "Open board". Held until the release
// migration passes scope, so today's mail is unchanged.
test('the joined email names the workspace once it is told the join was the whole workspace', async () => {
  const { readFileSync } = await import('node:fs');
  const tpl = readFileSync(new URL('../../../supabase/functions/_shared/email/templates.ts', import.meta.url), 'utf8');
  const fn = tpl.slice(tpl.indexOf('function workspaceJoined('), tpl.indexOf('// Pre-account invite.'));
  assert.ok(tpl.includes('if (d.scope === "workspace" && d.workspaceName) return workspaceJoined(d);'));
  assert.ok(fn.includes('subject: `${d.joinerName} joined ${ws}`'));
  assert.ok(fn.includes('`Open ${ws}`') && fn.includes('"Open your workspace"'));
  assert.ok(fn.includes('deepLink(\n    { w: d.workspaceId },'), 'the button opens the workspace, not a cluster');
  assert.doesNotMatch(fn, /Open board/);
  const sw = tpl.slice(tpl.indexOf('case "invite_accepted":'), tpl.indexOf('case "pending_invite":'));
  assert.match(sw, /scope:\s+data\.scope === "workspace" \? "workspace" : undefined/);
  assert.match(sw, /workspaceName: safeLabel\(data\.workspaceName, 60\) \|\| undefined/);
});
