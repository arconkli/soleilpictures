-- 0527_inbox_proof.sql
--
-- An invitation addressed to an email matches an account only when that
-- account has proven the address. email_confirmed_at proves nothing here: an
-- account is confirmed the moment an address is submitted.
--
--   * profiles.inbox_proven_at / inbox_proven_hash (sha256 of the address, never the address itself) are written by the server
--     only (_stamp_inbox_proof), when the session came from the inbox
--     (_session_proves_inbox, 0600): on the presence heartbeat
--     (touch_presence), and when get_file_share / list_shared_with_me run
--     (0607). Clients can read their own profile row only and write none of
--     these columns.
--   * _user_proved_inbox(user) is true while the proven address is still the
--     account's address.
--   * The rule: a match for the session's own account needs
--     _session_proves_inbox(); a match for a named account needs
--     _user_proved_inbox(user).
--   An account that has not been signed in since this shipped counts as
--   unproven until its next heartbeat.
--
-- _file_share_reaches (asked about a named account) now needs
-- _user_proved_inbox for an address match, and, like 0607's access checks,
-- counts an invitation only while the person who sent it can still edit the
-- cluster (_user_can_write_board, 0524). It lives here, before 0530, because
-- the Team program re-emits it there.
--
-- Bodies re-emitted from the live definitions; only these lines change.

alter table public.profiles
  add column if not exists inbox_proven_at timestamptz,
  add column if not exists inbox_proven_hash text;

create or replace function public._user_proved_inbox(p_user uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select p_user is not null
     and exists (select 1 from public.profiles p
                   join auth.users u on u.id = p.user_id
                  where p.user_id = p_user
                    and p.inbox_proven_hash is not null
                    and p.inbox_proven_hash = encode(sha256(convert_to(lower(u.email), 'UTF8')), 'hex'));
$function$;

revoke execute on function public._user_proved_inbox(uuid) from public, anon, authenticated;

create or replace function public._stamp_inbox_proof()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if auth.uid() is null or not public._session_proves_inbox() then
    return;
  end if;
  update public.profiles p
     set inbox_proven_at = now(),
         inbox_proven_hash = encode(sha256(convert_to(lower(u.email), 'UTF8')), 'hex')
    from auth.users u
   where u.id = auth.uid()
     and p.user_id = u.id
     and u.email is not null
     and p.inbox_proven_hash is distinct from encode(sha256(convert_to(lower(u.email), 'UTF8')), 'hex');
end;
$function$;

revoke execute on function public._stamp_inbox_proof() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_presence()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_presence (user_id, last_seen_at, updated_at)
  values (auth.uid(), now(), now())
  on conflict (user_id)
  do update set last_seen_at = now(), updated_at = now();
  -- 0527: a session from the inbox records that the account proved its address.
  perform public._stamp_inbox_proof();
  perform public._note_origin('session');
end;
$function$;

CREATE OR REPLACE FUNCTION public._file_share_reaches(p_share file_shares, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text;
begin
  if p_user is null or p_share.id is null or public._user_banned(p_user) then
    return false;
  end if;
  if exists (select 1 from public.workspaces w
              where w.id = p_share.workspace_id and w.created_by = p_user)
     or exists (select 1 from public.workspace_members m
                 where m.workspace_id = p_share.workspace_id and m.user_id = p_user) then
    return true;
  end if;
  if exists (
       with recursive chain as (
         select b.id, b.parent_board_id, b.deleted_at
           from public.boards b where b.id = p_share.board_id
         union all
         select b.id, b.parent_board_id, b.deleted_at
           from public.boards b join chain c on b.id = c.parent_board_id
       )
       select 1 from chain
        join public.board_shares s on s.board_id = chain.id and s.user_id = p_user
       where chain.deleted_at is null) then
    return true;
  end if;
  select lower(u.email) into v_email
    from auth.users u where u.id = p_user and u.email_confirmed_at is not null
      and public._user_proved_inbox(p_user);
  if exists (select 1 from public.file_share_people p
              where p.share_id = p_share.id and p.revoked_at is null
                and not public._sharer_suspended(p.invited_by)
                and public._user_can_write_board(p.invited_by, p_share.board_id)
                and (p.user_id = p_user
                     or (p.user_id is null and v_email is not null and p.email = v_email))) then
    return true;
  end if;
  if p_share.link_access = 'comment'
     and exists (select 1 from public.file_comments c
                  where c.share_id = p_share.id and c.author = p_user and c.deleted_at is null) then
    return true;
  end if;
  return false;
end;
$function$;

-- The 0311 habit: prove the grants, don't trust them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._user_proved_inbox(uuid)',
    'public._stamp_inbox_proof()',
    'public._file_share_reaches(file_shares,uuid)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0527: % is client-callable', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.touch_presence()', 'EXECUTE') then
    raise exception '0527: touch_presence lost its grant';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'inbox_proven_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'inbox_proven_hash', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'inbox_proven_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.profiles', 'inbox_proven_hash', 'INSERT')
     or has_column_privilege('anon', 'public.profiles', 'inbox_proven_at', 'UPDATE')
     or has_column_privilege('anon', 'public.profiles', 'inbox_proven_hash', 'UPDATE')
     or has_column_privilege('anon', 'public.profiles', 'inbox_proven_hash', 'INSERT') then
    raise exception '0527: clients can write the inbox proof';
  end if;
end $$;
