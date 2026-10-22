-- 0606_invites_follow_their_sender.sql
--
-- An emailed invitation (pending_invites) is claimable only while the person
-- who sent it still has the access it hands on: for a cluster, they can still
-- edit it (_user_can_write_board, 0524); for a workspace, they can still
-- manage it (can_manage_workspace asked as them: the owner or a co-owner, the
-- rule invite_workspace_member and _workspace_invite_link_live already apply). Both claim paths ask:
-- claim_pending_invite (the emailed button) and _claim_pending_invites_for_user
-- (a new account's first sign-in).
--
-- Bodies re-emitted from the live definitions; only these lines change.

create or replace function public._inviter_still_in(p_user uuid, p_ws uuid, p_board uuid)
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
  if p_user is null then
    return false;
  end if;
  if p_board is not null then
    return public._user_can_write_board(p_user, p_board);
  end if;
  -- can_manage_workspace itself, asked as the person who sent it (the swap
  -- _user_can_write_board uses), so it follows that rule now and later.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_ok := coalesce(public.can_manage_workspace(p_ws), false);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  return v_ok;
end;
$function$;

revoke execute on function public._inviter_still_in(uuid, uuid, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_pending_invite(p_token uuid)
 RETURNS TABLE(workspace_id uuid, board_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
#variable_conflict use_column
declare
  v_row           pending_invites%rowtype;
  v_caller_email  text;
  v_fresh         boolean := false;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to claim invite' using errcode = '42501';
  end if;
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  select * into v_row from pending_invites where token = p_token;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if v_row.expires_at <= now() then
    raise exception 'invite has expired' using errcode = '22023';
  end if;
  -- 0371: an invitation held while its sender is under review, or one from a
  -- banned account, does nothing.
  if v_row.held_at is not null or public._sharer_suspended(v_row.invited_by) then
    raise exception 'this invitation is no longer valid' using errcode = '22023';
  end if;

  if lower(v_row.email) <> lower(coalesce(v_caller_email, '')) then
    raise exception 'this invite is for a different email' using errcode = '42501';
  end if;

  if v_row.claimed_at is not null and v_row.claimed_by is distinct from auth.uid() then
    raise exception 'invite already claimed' using errcode = '22023';
  end if;

  v_fresh := v_row.claimed_at is null;

  -- 0606: an invitation works only while the person who sent it still has
  -- the access it hands on. One already claimed by this account stays theirs.
  if v_fresh and not public._inviter_still_in(v_row.invited_by, v_row.workspace_id, v_row.board_id) then
    raise exception 'this invitation is no longer valid' using errcode = '22023';
  end if;

  if v_row.board_id is not null then
    insert into board_shares (board_id, user_id, role, invited_by)
    values (v_row.board_id, auth.uid(),
            case when v_row.role = 'editor' then 'editor' else 'viewer' end,
            v_row.invited_by)
    on conflict (board_id, user_id) do nothing;
  else
    insert into workspace_members (workspace_id, user_id, role)
    values (v_row.workspace_id, auth.uid(),
            case when v_row.role = 'viewer' then 'viewer' else 'editor' end)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update pending_invites
     set claimed_at = coalesce(claimed_at, now()),
         claimed_by = coalesce(claimed_by, auth.uid())
   where id = v_row.id;

  if v_fresh then
    perform public._joined_notification(
      v_row.invited_by, v_row.board_id, v_row.workspace_id, v_row.role, auth.uid());
  end if;

  return query select v_row.workspace_id, v_row.board_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public._claim_pending_invites_for_user(p_user_id uuid, p_email text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_row    pending_invites%rowtype;
  v_count  integer := 0;
  v_email_norm text := lower(trim(coalesce(p_email, '')));
begin
  if v_email_norm = '' or p_user_id is null then
    return 0;
  end if;

  for v_row in
    select * from pending_invites
    where lower(email) = v_email_norm
      and claimed_at is null
      and expires_at > now()
      -- 0371: not one held for review, nor one from a banned sender.
      and held_at is null
      and not public._sharer_suspended(invited_by)
      -- 0606: and only while the person who sent it still has that access.
      and public._inviter_still_in(invited_by, workspace_id, board_id)
  loop
    begin
      if v_row.board_id is not null then
        insert into board_shares (board_id, user_id, role, invited_by)
        values (v_row.board_id, p_user_id,
                case when v_row.role = 'editor' then 'editor' else 'viewer' end,
                v_row.invited_by)
        on conflict (board_id, user_id) do nothing;
      else
        insert into workspace_members (workspace_id, user_id, role)
        values (v_row.workspace_id, p_user_id,
                case when v_row.role = 'viewer' then 'viewer' else 'editor' end)
        on conflict (workspace_id, user_id) do nothing;
      end if;

      update pending_invites
         set claimed_at = now(),
             claimed_by = p_user_id
       where id = v_row.id;

      perform public._joined_notification(
        v_row.invited_by, v_row.board_id, v_row.workspace_id, v_row.role, p_user_id);

      v_count := v_count + 1;
    exception when others then
      raise warning '_claim_pending_invites_for_user: claim id=% failed: %', v_row.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

-- The 0311 habit: prove the grants, don't trust them.
do $$
begin
  if has_function_privilege('anon', 'public._inviter_still_in(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._inviter_still_in(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception '0606: _inviter_still_in is client-callable';
  end if;
  if has_function_privilege('anon', 'public.claim_pending_invite(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.claim_pending_invite(uuid)', 'EXECUTE') then
    raise exception '0606: claim_pending_invite grants changed';
  end if;
  if has_function_privilege('anon', 'public._claim_pending_invites_for_user(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._claim_pending_invites_for_user(uuid,text)', 'EXECUTE') then
    raise exception '0606: _claim_pending_invites_for_user is client-callable';
  end if;
end $$;
