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

// ── 0602: a conversation is read by the people in it ───────────────────────

test('clients change only read and hide state on a participant row, and only the title of a conversation', () => {
  assert.ok(latestMatch(/revoke update on table public\.conversation_participants from authenticated, anon;\s*grant update \(last_read_at, left_at\) on table public\.conversation_participants to authenticated;/));
  assert.ok(latestMatch(/revoke update on table public\.conversations from authenticated, anon;\s*grant update \(title, last_message_at\) on table public\.conversations to authenticated;/));
});

test('a link from a message never carries the message text, and only its conversation can read it', () => {
  const tg = latestDefinition('_tg_entity_links_message_context').body;
  assert.match(tg, /if new\.source_kind = 'message' then\s+new\.context_text := null;/);
  assert.ok(latestMatch(/create or replace trigger entity_links_message_context\s+before insert or update on public\.entity_links/));
  const policy = latestMatch(/alter policy "entity_links read" on public\.entity_links using \(([\s\S]*?)\n\);/);
  assert.ok(policy, 'the read policy is restated');
  assert.match(policy.match[1], /when source_kind = 'message' then exists \(\s*select 1 from public\.messages m\s+where m\.id::text = entity_links\.source_id\s+and public\.is_conversation_participant\(m\.conversation_id\)\)/);
});

test('mention search reads only the caller\'s conversations, matches literally and pages small', () => {
  const def = latestDefinition('get_entity_mentions').body;
  const participant = def.match(/is_conversation_participant\(m\.conversation_id\)/g) || [];
  assert.equal(participant.length, 2, 'both the message rows and their count are limited to the caller\'s conversations');
  assert.match(def, /replace\(replace\(replace\(pat, '\\', '\\\\'\), '%', '\\%'\), '_', '\\_'\)/, '% and _ are matched literally');
  assert.match(def, /lim\s+int := least\(greatest\(coalesce\(p_limit, 6\), 1\), 24\);/);
  assert.ok(!/ilike '%' \|\| pat \|\| '%'/.test(def) && !/like '%' \|\| pat \|\| '%'/.test(def), 'no unescaped pattern is left');
});
