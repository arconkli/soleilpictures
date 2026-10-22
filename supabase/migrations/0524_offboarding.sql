-- 0524_offboarding.sql
--
-- When someone stops being part of a workspace, what they set up there stops
-- working for them and through them. One helper, _offboard_member(ws, user),
-- does it. It is idempotent, never needs or touches a workspace_members row
-- (access that comes from a team has none), makes no network calls, and
-- writes one security_events row per call. Scoped to that workspace and that
-- person, it:
--   * ends their access to the workspace's conversations
--     (conversation_participants.revoked_at, which clients cannot write;
--     the participant checks honour it from 0605);
--   * revokes the public and invite links they made for its clusters, and
--     the workspace invite links they made;
--   * ends their pending invitations (expires_at moves to now);
--   * revokes the file-share invitations they sent and turns off the file
--     links they set (link_access 'none');
--   * deactivates the webhooks and service accounts they created there and
--     revokes those accounts' API tokens (_offboard_integrations).
--
-- A workspace_members row leaving (remove_workspace_member, leave_workspace,
-- a service account being disabled) runs it through an AFTER DELETE trigger,
-- so those RPCs keep their live bodies. A workspace or an account being
-- deleted takes its rows with it and is skipped. Team removal calls
-- _offboard_member directly.
--
-- transfer_workspace_ownership (re-emitted from the live body) runs only the
-- integrations part for the outgoing owner, who stays an editor.
--
-- _user_can_write_board(user, board) is can_write_board itself, asked as a
-- named account rather than the session (the claims swap party_board_access
-- uses), so it follows every rule can_write_board follows, now and later; 0525,
-- 0606 and 0607 use it to ask whether the person behind a link or an
-- invitation can still edit what it hands on.

alter table public.conversation_participants
  add column if not exists revoked_at timestamptz;

create or replace function public._user_can_write_board(p_user uuid, p_board uuid)
 returns boolean
 language plpgsql
 volatile security definer
 set search_path to 'public'
as $function$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
  v_role   text := current_setting('request.jwt.claim.role', true);
  v_ok     boolean;
begin
  if p_user is null or p_board is null then
    return false;
  end if;
  -- can_write_board itself, asked as that account (the same swap as
  -- party_board_access), so this never drifts from the app's own rule.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_ok := coalesce(public.can_write_board(p_board), false);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  return v_ok;
end;
$function$;

revoke execute on function public._user_can_write_board(uuid, uuid) from public, anon, authenticated;

create or replace function public._offboard_integrations(p_ws uuid, p_user uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_hooks    integer := 0;
  v_accounts integer := 0;
  v_tokens   integer := 0;
begin
  if p_ws is null or p_user is null then
    return '{}'::jsonb;
  end if;

  update public.webhooks w
     set active = false,
         disabled_reason = 'creator_left',
         updated_at = now()
   where w.workspace_id = p_ws
     and w.created_by = p_user
     and w.active;
  get diagnostics v_hooks = row_count;

  update public.api_tokens t
     set revoked_at = now()
   where t.revoked_at is null
     and t.user_id in (select s.user_id from public.service_accounts s
                        where s.workspace_id = p_ws and s.created_by = p_user);
  get diagnostics v_tokens = row_count;

  update public.service_accounts s
     set disabled_at = now()
   where s.workspace_id = p_ws
     and s.created_by = p_user
     and s.disabled_at is null;
  get diagnostics v_accounts = row_count;

  return jsonb_build_object('webhooks', v_hooks, 'service_accounts', v_accounts, 'service_tokens', v_tokens);
end;
$function$;

revoke execute on function public._offboard_integrations(uuid, uuid) from public, anon, authenticated;

create or replace function public._offboard_member(p_ws uuid, p_user uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_conversations integer := 0;
  v_links         integer := 0;
  v_ws_links      integer := 0;
  v_invites       integer := 0;
  v_file_people   integer := 0;
  v_file_links    integer := 0;
begin
  if p_ws is null or p_user is null then
    return;
  end if;

  update public.conversation_participants cp
     set revoked_at = now(),
         left_at    = coalesce(cp.left_at, now())
   where cp.user_id = p_user
     and cp.revoked_at is null
     and cp.conversation_id in (select c.id from public.conversations c where c.workspace_id = p_ws);
  get diagnostics v_conversations = row_count;

  update public.public_share_links l
     set revoked_at = now()
   where l.created_by = p_user
     and l.revoked_at is null
     and l.board_id in (select b.id from public.boards b where b.workspace_id = p_ws);
  get diagnostics v_links = row_count;

  update public.workspace_invite_links l
     set revoked_at = now(),
         revoked_by = auth.uid()
   where l.workspace_id = p_ws
     and l.created_by = p_user
     and l.revoked_at is null;
  get diagnostics v_ws_links = row_count;

  update public.pending_invites i
     set expires_at = now()
   where i.invited_by = p_user
     and i.claimed_at is null
     and i.expires_at > now()
     and (i.workspace_id = p_ws
          or i.board_id in (select b.id from public.boards b where b.workspace_id = p_ws));
  get diagnostics v_invites = row_count;

  update public.file_share_people p
     set revoked_at = now()
   where p.invited_by = p_user
     and p.revoked_at is null
     and p.share_id in (select s.id from public.file_shares s where s.workspace_id = p_ws);
  get diagnostics v_file_people = row_count;

  update public.file_shares s
     set link_access = 'none',
         updated_at  = now()
   where s.workspace_id = p_ws
     and s.link_set_by = p_user
     and s.link_access <> 'none';
  get diagnostics v_file_links = row_count;

  perform public._log_security_event('member.offboarded', p_ws,
    jsonb_build_object(
      'user_id', p_user,
      'conversations', v_conversations,
      'links', v_links,
      'workspace_links', v_ws_links,
      'invites', v_invites,
      'file_people', v_file_people,
      'file_links', v_file_links)
    || public._offboard_integrations(p_ws, p_user));
end;
$function$;

revoke execute on function public._offboard_member(uuid, uuid) from public, anon, authenticated;

create or replace function public._tg_workspace_member_offboard()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  -- A workspace or an account being deleted takes these rows with it;
  -- nothing to revoke, and its own cascades are already rewriting them.
  if exists (select 1 from public.workspaces w where w.id = old.workspace_id)
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    perform public._offboard_member(old.workspace_id, old.user_id);
  end if;
  return old;
end;
$function$;

revoke execute on function public._tg_workspace_member_offboard() from public, anon, authenticated;

create or replace trigger workspace_member_offboard
  after delete on public.workspace_members
  for each row execute function public._tg_workspace_member_offboard();

CREATE OR REPLACE FUNCTION public.transfer_workspace_ownership(p_workspace_id uuid, p_new_owner uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old     uuid;
  v_name    text;
  v_tier    text;
  v_cap     integer;
  v_count   integer;
  v_role    text;
  v_bytes   bigint;
  v_objects bigint;
  v_integrations jsonb;
  v_note    text := '';
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- A banned account's clusters stop serving, so it can't be handed one.
  if public._user_banned(p_new_owner) then
    raise exception 'that account cannot own a workspace' using errcode = '42501';
  end if;
  if p_new_owner = auth.uid() then
    raise exception 'cannot transfer ownership to yourself'
      using errcode = '22023';
  end if;

  select created_by, name into v_old, v_name from workspaces where id = p_workspace_id;
  if v_old is null then
    raise exception 'workspace % not found', p_workspace_id using errcode = '42704';
  end if;
  if v_old <> auth.uid() then
    raise exception 'only the current owner can transfer ownership'
      using errcode = '42501';
  end if;
  select role into v_role from workspace_members
   where workspace_id = p_workspace_id and user_id = p_new_owner;
  if v_role is null then
    raise exception 'new owner must already be a workspace member'
      using errcode = '42704';
  end if;
  -- 0397: only someone who can edit it. A viewer or a service account would
  -- receive a workspace they cannot run, from an owner just demoted to editor.
  if v_role not in ('coowner', 'admin', 'editor') then
    raise exception 'only an editor or co-owner can become the owner — make them an editor first'
      using errcode = '42501';
  end if;

  update workspaces set created_by = p_new_owner where id = p_workspace_id;
  update workspace_members set role = 'owner'
    where workspace_id = p_workspace_id and user_id = p_new_owner;
  update workspace_members set role = 'editor'
    where workspace_id = p_workspace_id and user_id = v_old;

  -- 0524: the outgoing owner's integrations stop with their ownership. Their
  -- webhooks go inactive, the service accounts they made are disabled and
  -- those accounts' tokens revoked; the new owner sets up their own. The
  -- outgoing owner stays an editor, so nothing else of theirs is touched.
  v_integrations := public._offboard_integrations(p_workspace_id, v_old);
  perform public._log_security_event('workspace.ownership_transferred', p_workspace_id,
    jsonb_build_object('from_user', v_old, 'to_user', p_new_owner) || v_integrations);
  if coalesce((v_integrations ->> 'webhooks')::int, 0) + coalesce((v_integrations ->> 'service_accounts')::int, 0) > 0 then
    v_note := ' The previous owner''s webhooks and API service accounts were turned off; set up your own in Settings.';
  end if;

  -- 0397: the workspace's stored files now count toward the new owner, as the
  -- nightly reconcile would decide; move them now rather than at 03:55 UTC.
  -- 0411: only the files that count (_image_counts) — the rollup holds no others.
  select coalesce(sum(i.size_bytes), 0)::bigint, count(*)::bigint
    into v_bytes, v_objects
    from public.images i
   where i.workspace_id = p_workspace_id
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  perform public._storage_usage_apply(v_old, -v_bytes, -v_objects);
  perform public._storage_usage_apply(p_new_owner, v_bytes, v_objects);

  -- 0395: tell the new owner, with their own numbers (counted AFTER the
  -- hand-over, so this workspace is included). Only the free plan has a card
  -- cap (enforce_demo_card_cap_trg), so only it gets numbers.
  begin
    select coalesce(p.tier, 'demo'), coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
      into v_tier, v_cap
      from public.profiles p where p.user_id = p_new_owner;
    v_tier  := coalesce(v_tier, 'demo');
    v_cap   := coalesce(v_cap, 50);
    v_count := public._owner_card_count(p_new_owner);

    insert into public.notifications (user_id, kind, workspace_id, actor_id, title, body, data)
    values (
      p_new_owner,
      'workspace.ownership_received',
      p_workspace_id,
      auth.uid(),
      format('You now own "%s"', coalesce(nullif(btrim(v_name), ''), 'a workspace')),
      case
        when v_tier = 'demo' and v_count > v_cap then
          format('Its cards, files and storage now count toward your plan. You''re at %s of %s cards, so no new cards can be added to workspaces you own until you upgrade or clear space.', v_count, v_cap)
        when v_tier = 'demo' then
          format('Its cards, files and storage now count toward your plan. You''re at %s of %s cards.', v_count, v_cap)
        else
          'Its cards, files and storage now count toward your plan.'
      end || v_note,
      jsonb_build_object(
        'card_count', v_count,
        'card_limit', case when v_tier = 'demo' then v_cap end,
        'over_limit', (v_tier = 'demo' and v_count > v_cap)
      )
    );
  exception when others then
    raise warning 'transfer_workspace_ownership: could not notify the new owner of %: %', p_workspace_id, sqlerrm;
  end;
end;
$function$;

-- The 0311 habit: prove the grants, don't trust them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._user_can_write_board(uuid,uuid)',
    'public._offboard_integrations(uuid,uuid)',
    'public._offboard_member(uuid,uuid)',
    'public._tg_workspace_member_offboard()'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0524: % is client-callable', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.transfer_workspace_ownership(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.transfer_workspace_ownership(uuid,uuid)', 'EXECUTE') then
    raise exception '0524: transfer_workspace_ownership grants changed';
  end if;
  if has_column_privilege('authenticated', 'public.conversation_participants', 'revoked_at', 'UPDATE')
     or has_column_privilege('anon', 'public.conversation_participants', 'revoked_at', 'UPDATE') then
    raise exception '0524: clients can write conversation_participants.revoked_at';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'workspace_member_offboard'
                  and tgrelid = 'public.workspace_members'::regclass and tgenabled = 'O') then
    raise exception '0524: workspace_member_offboard is not in place';
  end if;
end $$;
