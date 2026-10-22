// The 2026-10-21 security review (migrations 0600 onward, and 0523–0529 for
// the functions the Team program shares). Each fix is pinned at its source —
// the latest migration definition — so it cannot quietly come back.
// securityAudit.test.mjs pins the 2026-10-06 review the same way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestDefinition, latestMatch } from './migrationText.mjs';

// ── 0600: a session must come from the inbox ───────────────────────────────

test('the access checks grant nothing to a session that did not come from the inbox', () => {
  const def = latestDefinition('_actor_active').body;
  assert.match(def, /when auth\.uid\(\) is null then true/, 'public reads still pass through it');
  assert.match(def,
    /when jsonb_typeof\(auth\.jwt\(\) -> 'amr'\) = 'array' and not public\._session_proves_inbox\(\) then false/,
    'a token carrying amr must carry an inbox method');
});

test('the inbox methods are the emailed ones, never a password', () => {
  const def = latestDefinition('_session_proves_inbox').body;
  for (const method of ['otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change']) {
    assert.ok(def.includes(`'${method}'`), `${method} counts as the inbox`);
  }
  assert.ok(!def.includes("'password'"), 'a password never proves the inbox');
  assert.ok(latestMatch(/revoke execute on function public\._session_proves_inbox\(\) from public, anon, authenticated/),
    '_session_proves_inbox() is for SECURITY DEFINER callers only');
});

test('the access token hook refuses password sign-ins and only the auth server may run it', () => {
  const def = latestDefinition('auth_refuse_password').body;
  assert.match(def, /event ->> 'authentication_method' = 'password'/);
  assert.match(def, /return event;/, 'every other sign-in passes through unchanged');
  assert.ok(latestMatch(/grant execute on function public\.auth_refuse_password\(jsonb\) to supabase_auth_admin/));
  assert.ok(latestMatch(/revoke execute on function public\.auth_refuse_password\(jsonb\) from public, anon, authenticated/));
});

// ── 0601: a rewind restores its own workspace's clusters only ──────────────

test('a workspace rewind refuses a cluster from any other workspace', () => {
  const def = latestDefinition('perform_workspace_rewind').body;
  assert.match(def, /SELECT 1 FROM boards b\s+WHERE b\.id = v_board_id\s+AND b\.workspace_id = p_workspace_id/);
  assert.ok(def.indexOf('b.workspace_id = p_workspace_id') < def.indexOf('perform_board_restore('),
    'the check comes before anything is restored');
  assert.match(latestDefinition('perform_board_restore').body, /WHERE id = p_target_snapshot_id AND board_id = p_board_id/,
    'a snapshot restores only its own cluster');
});
