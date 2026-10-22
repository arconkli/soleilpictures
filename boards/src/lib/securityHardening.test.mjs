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

// ── 0603: an image joins a cluster's reach only from its own workspace ─────

test('a cluster joins an image\'s list only in the image\'s workspace, when already listed, or from a public source', () => {
  const def = latestDefinition('recompute_image_refs').body;
  assert.match(def, /when i\.workspace_id = \(select b\.workspace_id from boards b where b\.id = p_board_id\) then true\s+else _image_source_is_public\(i\.board_id\) end/,
    'the per-cluster pass adds only same-workspace or public-source images');
  assert.match(def, /when l\.board_ws = i0\.workspace_id then true\s+when l\.board_id = any\(i0\.referenced_in_board_ids\) then true\s+else _image_source_is_public\(i0\.board_id\) end/,
    'the nightly pass follows the same rule');
  const pub = latestDefinition('_image_source_is_public').body;
  assert.match(pub, /from public_boards pb where pb\.board_id = p_board/);
  assert.match(pub, /l\.revoked_at is null\s+and \(l\.expires_at is null or l\.expires_at > now\(\)\)\s+and \(c\.depth = 0 or l\.include_subboards\)/);
  assert.ok(latestMatch(/revoke execute on function public\.recompute_image_refs\(uuid\) from public, anon, authenticated;/),
    'signed-in clients cannot run it');
});

// ── 0604: a chat file is listed only to its uploader and its conversation ──

test('the storage API shows a chat attachment only to its uploader and the people in its conversation', () => {
  const alter = latestMatch(/alter policy "msg-att read" on storage\.objects using \(([\s\S]*?)\n\);/);
  assert.ok(alter, 'the read policy is restated');
  const body = alter.match[1];
  assert.match(body, /\(storage\.foldername\(name\)\)\[2\] = \(select auth\.uid\(\)::text\)/, 'the uploader reads their own file back');
  assert.match(body, /m\.attachments @> jsonb_build_array\(jsonb_build_object\('storage_path', storage\.objects\.name\)\)\s+and public\.is_conversation_participant\(m\.conversation_id\)/);
  assert.ok(!/is_workspace_member/.test(body), 'workspace membership alone no longer lists every chat file');
});

// ── 0523: the security log ─────────────────────────────────────────────────

test('the security log is written by the server and read by managers, or by the account for its own rows', () => {
  assert.ok(latestMatch(/create table if not exists public\.security_events \(\s*id\s+bigint generated always as identity primary key,\s*at\s+timestamptz not null default now\(\),\s*actor_id\s+uuid,\s*workspace_id uuid,\s*kind\s+text not null,\s*target\s+jsonb not null default '\{\}'::jsonb\s*\);/));
  assert.ok(latestMatch(/on public\.security_events \(workspace_id, at desc\)/));
  assert.ok(latestMatch(/alter table public\.security_events enable row level security;/));
  assert.ok(latestMatch(/revoke all on table public\.security_events from public, anon, authenticated;\s*grant select on table public\.security_events to authenticated;/),
    'clients read through RLS and write nothing');
  const policy = latestMatch(/create policy "security_events read" on public\.security_events([\s\S]*?);/);
  assert.match(policy.match[1], /case when workspace_id is null then actor_id = \(select auth\.uid\(\)\)\s+else public\.can_manage_workspace\(workspace_id\) end/);
  const log = latestDefinition('_log_security_event');
  assert.match(log.body, /_log_security_event\(p_kind text, p_workspace uuid, p_target jsonb default '\{\}'::jsonb\)\s+returns void/i);
  assert.match(log.body, /security definer/i);
  assert.match(log.body, /values \(auth\.uid\(\), p_workspace, p_kind, coalesce\(p_target, '\{\}'::jsonb\)\)/, 'the actor is the session, never a parameter');
  assert.ok(latestMatch(/revoke execute on function public\._log_security_event\(text, uuid, jsonb\) from public, anon, authenticated;/));
  assert.ok(latestMatch(/from pg_publication_tables\s+where schemaname = 'public' and tablename = 'security_events'/),
    'the migration proves it is not in a realtime publication');
});

// ── 0524: offboarding ──────────────────────────────────────────────────────

test('offboarding ends what a person set up in a workspace, and is the shape the Team program was promised', () => {
  const def = latestDefinition('_offboard_member');
  assert.equal(def.file, '0524_offboarding.sql');
  const b = def.body;
  assert.match(b, /_offboard_member\(p_ws uuid, p_user uuid\)\s+returns void/i);
  assert.ok(!/workspace_members/.test(b), 'it never needs or touches a membership row');
  assert.match(b, /update public\.conversation_participants cp\s+set revoked_at = now\(\)/, 'conversation access ends');
  assert.match(b, /c\.workspace_id = p_ws/, 'only the workspace\'s conversations');
  assert.match(b, /update public\.public_share_links l\s+set revoked_at = now\(\)\s+where l\.created_by = p_user/);
  assert.match(b, /update public\.workspace_invite_links l\s+set revoked_at = now\(\)/);
  assert.match(b, /update public\.pending_invites i\s+set expires_at = now\(\)\s+where i\.invited_by = p_user/);
  assert.match(b, /update public\.file_share_people p\s+set revoked_at = now\(\)\s+where p\.invited_by = p_user/);
  assert.match(b, /update public\.file_shares s\s+set link_access = 'none'/);
  assert.match(b, /public\._offboard_integrations\(p_ws, p_user\)/);
  assert.match(b, /perform public\._log_security_event\('member\.offboarded', p_ws,/, 'one security log row');
  assert.ok(!/net\.http|_notify_email/.test(b), 'no network calls');
  const integ = latestDefinition('_offboard_integrations').body;
  assert.match(integ, /update public\.webhooks w\s+set active = false/);
  assert.match(integ, /update public\.api_tokens t\s+set revoked_at = now\(\)/);
  assert.match(integ, /update public\.service_accounts s\s+set disabled_at = now\(\)/);
  for (const fn of ['_offboard_member(uuid, uuid)', '_offboard_integrations(uuid, uuid)', '_user_can_write_board(uuid, uuid)', '_tg_workspace_member_offboard()']) {
    assert.ok(latestMatch(new RegExp(`revoke execute on function public\\.${fn.replace(/[()]/g, '\\$&')} from public, anon, authenticated;`)), `${fn} is server-only`);
  }
});

test('a membership row leaving runs offboarding, and a transfer stops the outgoing owner\'s integrations', () => {
  assert.ok(latestMatch(/create or replace trigger workspace_member_offboard\s+after delete on public\.workspace_members\s+for each row execute function public\._tg_workspace_member_offboard\(\);/));
  const tg = latestDefinition('_tg_workspace_member_offboard').body;
  assert.match(tg, /perform public\._offboard_member\(old\.workspace_id, old\.user_id\);/);
  const tr = latestDefinition('transfer_workspace_ownership').body;
  assert.match(tr, /public\._offboard_integrations\(p_workspace_id, v_old\)/);
  assert.ok(!/_offboard_member\(/.test(tr), 'the outgoing owner stays an editor: only their integrations stop');
  assert.ok(tr.indexOf("set role = 'editor'") < tr.indexOf('_offboard_integrations('));
  assert.ok(latestMatch(/add column if not exists revoked_at timestamptz;/));
});

test('a named account\'s edit rights are can_write_board itself, asked as that account', () => {
  const b = latestDefinition('_user_can_write_board').body;
  assert.match(b, /set_config\('request\.jwt\.claims',\s+jsonb_build_object\('sub', p_user, 'role', 'authenticated'\)::text, true\)/);
  assert.match(b, /v_ok := coalesce\(public\.can_write_board\(p_board\), false\);/, 'no hand-made copy of the rule to drift');
  assert.match(b, /set_config\('request\.jwt\.claims', coalesce\(v_claims, ''\), true\)/, 'the session\'s claims are put back');
});

// ── 0525: a link follows the account that made it ──────────────────────────

test('an invite link or view link stops when its maker can no longer edit the cluster', () => {
  const claim = latestDefinition('claim_collab_link').body;
  const check = claim.indexOf('public._user_can_write_board(v_link.created_by, v_link.board_id)');
  assert.ok(check > 0, 'claim_collab_link asks about the link\'s maker');
  assert.ok(check < claim.indexOf('insert into board_shares'), 'before anything is granted');
  assert.match(claim, /public\._editor_admit\(/, '0521\'s doors are kept');
  assert.match(latestDefinition('_resolve_share_target').body, /or not public\._user_can_write_board\(v_creator, v_root\)/);
});

// ── 0526: a share on a cluster in the trash grants nothing ─────────────────

test('a share on a trashed cluster grants neither read nor write', () => {
  const w = latestDefinition('can_write_board').body;
  assert.match(w, /public\._workspace_member_can_write\(chain\.workspace_id\)/, 'the membership branch still goes through the Team helper');
  assert.match(w, /or \(chain\.deleted_at is null and exists \(\s*select 1 from public\.board_shares s/);
  const r = latestDefinition('my_readable_board_ids').body;
  assert.match(r, /select 1 from board_shares s where s\.board_id = b\.id and s\.user_id = auth\.uid\(\)\s+and b\.deleted_at is null/);
  assert.match(latestDefinition('can_read_board').body, /is_workspace_member\(chain\.workspace_id\)/);
});

// ── 0527: an address is proven from the inbox ──────────────────────────────

test('an account proves its address only from a session that came from the inbox, and clients cannot write the proof', () => {
  assert.ok(latestMatch(/alter table public\.profiles\s+add column if not exists inbox_proven_at timestamptz,\s+add column if not exists inbox_proven_hash text;/));
  const stamp = latestDefinition('_stamp_inbox_proof').body;
  assert.match(stamp, /if auth\.uid\(\) is null or not public\._session_proves_inbox\(\) then\s+return;/);
  assert.match(stamp, /inbox_proven_hash = encode\(sha256\(convert_to\(lower\(u\.email\), 'UTF8'\)\), 'hex'\)/, 'a hash, never the address');
  assert.match(latestDefinition('touch_presence').body, /perform public\._stamp_inbox_proof\(\);/, 'the heartbeat stamps it');
  assert.match(latestDefinition('_user_proved_inbox').body, /p\.inbox_proven_hash = encode\(sha256\(convert_to\(lower\(u\.email\), 'UTF8'\)\), 'hex'\)/);
  for (const fn of ['_user_proved_inbox\\(uuid\\)', '_stamp_inbox_proof\\(\\)']) {
    assert.ok(latestMatch(new RegExp(`revoke execute on function public\\.${fn} from public, anon, authenticated;`)));
  }
  assert.ok(latestMatch(/has_column_privilege\('authenticated', 'public\.profiles', 'inbox_proven_hash', 'UPDATE'\)/));
});

test('matching an address to a named account needs a proven inbox, not a confirmed email', () => {
  const reach = latestDefinition('_file_share_reaches');
  assert.ok(reach.file >= '0527', 'the latest definition is 0527 or a later re-emit that carries it');
  assert.match(reach.body, /u\.email_confirmed_at is not null\s+and public\._user_proved_inbox\(p_user\);/);
  assert.match(reach.body, /public\._user_can_write_board\(p\.invited_by, p_share\.board_id\)/);
});

// ── 0605: chat ends at removal ─────────────────────────────────────────────

test('a participant whose access was ended is in none of the conversation\'s checks', () => {
  assert.match(latestDefinition('is_conversation_participant').body, /user_id = auth\.uid\(\)\s+and revoked_at is null/);
  assert.match(latestDefinition('is_active_conversation_participant').body, /left_at is null\s+and revoked_at is null/);
  assert.match(latestDefinition('messages_fanout_inbox_pings').body, /left_at is null\s+and revoked_at is null/);
  assert.match(latestDefinition('messages_fire_mention_notifications').body, /cp\.left_at is null\s+and cp\.revoked_at is null/);
  assert.match(latestDefinition('get_unread_counts').body, /p\.user_id = auth\.uid\(\)\s+and p\.revoked_at is null/);
  assert.match(latestDefinition('find_or_create_dm').body, /and not exists \(select 1 from conversation_participants\s+where conversation_id = c\.id and revoked_at is not null\)/);
  assert.match(latestDefinition('add_conversation_participants').body, /set left_at = null, revoked_at = null, joined_at = now\(\)/);
  const policy = latestMatch(/alter policy "participants insert" on public\.conversation_participants with check \(([\s\S]*?)\n\);/);
  assert.match(policy.match[1], /c\.created_by = auth\.uid\(\)\s+and can_write_workspace\(c\.workspace_id\)/, 'a removed creator cannot add themselves back');
  assert.ok(latestMatch(/has_column_privilege\('authenticated', 'public\.conversation_participants', 'revoked_at', 'UPDATE'\)/));
});

// ── 0606: an invitation follows the person who sent it ─────────────────────

test('an emailed invitation is claimable only while its sender still has the access it hands on', () => {
  const still = latestDefinition('_inviter_still_in').body;
  assert.match(still, /if p_board is not null then\s+return public\._user_can_write_board\(p_user, p_board\);/);
  assert.match(still, /v_ok := coalesce\(public\.can_manage_workspace\(p_ws\), false\);/, 'a workspace invitation asks the managers\' own rule, as its sender');
  const claim = latestDefinition('claim_pending_invite').body;
  assert.match(claim, /if v_fresh and not public\._inviter_still_in\(v_row\.invited_by, v_row\.workspace_id, v_row\.board_id\) then/);
  assert.ok(claim.indexOf('_inviter_still_in(') < claim.indexOf('insert into board_shares'));
  assert.match(latestDefinition('_claim_pending_invites_for_user').body, /and public\._inviter_still_in\(invited_by, workspace_id, board_id\)/);
});

// ── 0607: file shares follow the person who shared ─────────────────────────

test('a file or doc share reaches people only while its sharer can edit, and an address match needs the inbox', () => {
  for (const fn of ['_file_share_access', '_doc_share_access']) {
    const b = latestDefinition(fn).body;
    assert.match(b, /u\.email_confirmed_at is not null\s+and public\._session_proves_inbox\(\);/, `${fn}: the session came from the inbox`);
    assert.match(b, /public\._user_can_write_board\(p\.invited_by, p_share\.board_id\)/, `${fn}: invited people`);
    assert.match(b, /public\._user_can_write_board\(p_share\.link_set_by, p_share\.board_id\)/, `${fn}: the link`);
  }
  for (const fn of ['get_file_share', 'list_shared_with_me']) {
    const b = latestDefinition(fn).body;
    assert.ok(b.indexOf('perform public._stamp_inbox_proof();') < b.indexOf('update public.file_share_people'), `${fn} stamps before it binds`);
    assert.match(b, /u\.email_confirmed_at is not null\s+and public\._session_proves_inbox\(\)\s+and public\._user_proved_inbox\(v_uid\);/, `${fn} binds only to a proven inbox`);
  }
});

// ── 0608: purging is the managers', from the trash ─────────────────────────

test('only an owner or co-owner removes a cluster for good, and only from the trash', () => {
  assert.ok(latestMatch(/alter policy "boards delete by members" on public\.boards\s+using \(public\.can_manage_workspace\(workspace_id\) and deleted_at is not null\);/));
  assert.ok(latestMatch(/alter policy "bv delete by writers" on public\.board_versions\s+using \(exists \(select 1 from public\.boards b\s+where b\.id = board_versions\.board_id\s+and public\.can_manage_workspace\(b\.workspace_id\)\)\);/));
});

// ── 0609: webhooks are read by the owner ───────────────────────────────────

test('a webhook\'s address and deliveries are read by the workspace owner only', () => {
  for (const fn of ['webhook_list', 'webhook_deliveries_page', 'webhook_deliveries_list']) {
    const b = latestDefinition(fn).body;
    assert.ok(!/is_workspace_member/.test(b), `${fn}: membership alone no longer reads it`);
    assert.match(b, /public\.can_write_workspace\(w\.workspace_id\)\s+and exists \(select 1 from public\.workspaces ws\s+where ws\.id = w\.workspace_id and ws\.created_by = auth\.uid\(\)\)/, `${fn}: the owner`);
  }
});

// ── 0610: an upload reserves its owner's space ─────────────────────────────

test('an upload is recorded only if it fits the drive it fills, checked under one lock per owner', () => {
  const b = latestDefinition('record_upload_intent').body;
  assert.match(b, /select created_by into v_owner from public\.workspaces where id = v_ws;/, 'the drive is the key\'s workspace owner\'s');
  assert.match(b, /perform pg_advisory_xact_lock\(hashtextextended\('soleil\.upload_space:' \|\| v_owner::text, 0\)\);/);
  assert.match(b, /if public\._storage_used_bytes\(v_owner\) \+ public\._storage_pending_bytes\(v_owner\) \+ p_bytes\s+> public\._storage_quota_bytes\(v_owner\) then\s+return false;/);
  assert.ok(b.indexOf('pg_advisory_xact_lock(') < b.indexOf('_storage_used_bytes(')
    && b.indexOf('_storage_quota_bytes(') < b.indexOf('insert into public.upload_intents'), 'lock, then check, then record');
});
