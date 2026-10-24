-- 0650: Teams, part 10 — who pays: an upload reserves its team's space.
--
-- STATUS: written 2026-10-22. Applied 2026-10-24 (owner's go), teams closed.
-- Live as migration 20261024223700 teams_pay_upload_reserve, right after 0537.
-- Its function body matches this file by md5.
--
-- 0610 made record_upload_intent reserve an upload's bytes in the drive of the
-- key's workspace owner, under one lock per owner. Since 0537 a team's
-- workspace fills the team's drive, so this asks _drive_used_bytes and
-- _drive_quota_bytes for the key's workspace, as authorize_upload does, and
-- takes the lock of that drive: 'soleil.upload_space:org:' || team for a
-- team's workspace, 'soleil.upload_space:' || owner, as before, for a personal
-- one. The two drives never share bytes (0537), so one lock per drive is the
-- whole of it. With no team, it answers what 0610 answers.
--
-- Numbered after 0610 (the security block is 0600–0649, agreed by message
-- 2026-10-22) so the folder, read in order, ends on the body that is live.
-- Applied right after 0537, whose helpers it calls.
--
-- Re-emitted from the live body (0610), with the lines marked 0650 and nothing
-- else changed. Rebased on (the md5 of the live prosrc, checked again before
-- applying):
--   record_upload_intent  c10a10a16770d1664fd69e97052f70c9

begin;

create or replace function public.record_upload_intent(p_key text, p_bytes bigint, p_kind text, p_board_id uuid default null::uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ws uuid;
  v_n  integer;
  v_owner uuid;   -- 0610
  v_org   uuid;   -- 0650
begin
  if auth.uid() is null or p_key is null or p_bytes is null or p_bytes < 0
     or p_kind is null or p_kind not in ('put', 'multipart')
     or p_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,8}$' then
    return false;
  end if;
  v_ws := split_part(p_key, '/', 1)::uuid;
  if not (public.can_write_workspace(v_ws)
          or (p_board_id is not null and public.can_write_board(p_board_id)
              and (public._board_in_workspace(p_board_id, v_ws) or public.is_workspace_member(v_ws)))) then
    return false;
  end if;
  -- 0610: the bytes fill the drive of the key's workspace's owner. Check it and
  -- record the intent under one lock per owner, so two uploads can't both
  -- claim the same free space.
  select created_by, org_id into v_owner, v_org from public.workspaces where id = v_ws;
  if v_owner is null then
    return false;
  end if;
  -- 0650: a team's workspace fills the team's drive, under one lock per team;
  -- a personal workspace keeps the owner's lock key, unchanged.
  perform pg_advisory_xact_lock(hashtextextended('soleil.upload_space:' || coalesce('org:' || v_org::text, v_owner::text), 0));
  if public._drive_used_bytes(v_org, v_owner) + p_bytes
       > public._drive_quota_bytes(v_org, v_owner) then
    return false;
  end if;
  insert into public.upload_intents (storage_key, workspace_id, bytes, kind, created_by)
  values (p_key, v_ws, p_bytes, p_kind, auth.uid())
  on conflict (storage_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$function$;
-- Its grants, said again (each a no-op live) so this file proves its own.
revoke execute on function public.record_upload_intent(text, bigint, text, uuid) from public, anon;
grant execute on function public.record_upload_intent(text, bigint, text, uuid) to authenticated;

do $$
begin
  if to_regprocedure('public._drive_used_bytes(uuid,uuid)') is null
     or to_regprocedure('public._drive_quota_bytes(uuid,uuid)') is null then
    raise exception '0650 needs 0537 live first';
  end if;
  if not has_function_privilege('authenticated', 'public.record_upload_intent(text,bigint,text,uuid)', 'execute') then
    raise exception '0650: record_upload_intent is not callable signed in';
  end if;
  if has_function_privilege('anon', 'public.record_upload_intent(text,bigint,text,uuid)', 'execute') then
    raise exception '0650: record_upload_intent is callable signed out';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname = 'record_upload_intent') <> 1 then
    raise exception '0650: an overload exists (PGRST203)';
  end if;
  -- Applying this changes nothing for anyone: no team exists.
  if exists (select 1 from public.organizations) then
    raise exception '0650: an organization exists';
  end if;
end $$;

commit;
