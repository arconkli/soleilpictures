-- 0425: a file you reopen from its link stays on your list.
--
-- mark_file_share_opened and hide_shared_file kept the first source a
-- file_share_seen row ever had. Someone removed as a person who then opened
-- the file from its link kept source 'person' and fell off "Shared with me",
-- which lists seen rows only for links. The source is now how the file
-- reaches you at that moment: an invitation while one is live, else the link.
-- (Found by the 0424 live matrix.)
--
-- Each re-emit is the 0424 definition with only the conflict clause changed.

create or replace function public.mark_file_share_opened(p_token uuid)
returns boolean
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_share  public.file_shares;
  v_r      jsonb;
  v_source text;
begin
  if v_uid is null or p_token is null then
    return false;
  end if;
  select s.* into v_share from public.file_shares s where s.token = p_token;
  if not found or v_share.created_by = v_uid then
    return false;
  end if;
  if coalesce(public.can_read_board(v_share.board_id), false) then
    return false;
  end if;
  v_r := public._file_share_resolve(p_token);
  if v_r is null or public._file_share_rank(v_r->>'access') < 1 then
    return false;
  end if;
  select lower(u.email) into v_email
    from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  v_source := case when exists (
                select 1 from public.file_share_people p
                 where p.share_id = v_share.id and p.revoked_at is null
                   and (p.user_id = v_uid or (p.user_id is null and v_email is not null and p.email = v_email)))
              then 'person' else 'link' end;
  insert into public.file_share_seen as s (user_id, share_id, source, opened_at)
  values (v_uid, v_share.id, v_source, now())
  on conflict (user_id, share_id) do update
     set opened_at = now(),
         hidden_at = null,
         source = excluded.source;
  return true;
end;
$$;

create or replace function public.hide_shared_file(p_token uuid, p_hidden boolean)
returns boolean
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_share  public.file_shares;
  v_source text;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select s.* into v_share from public.file_shares s where s.token = p_token;
  if not found then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  -- A row exists once the file reached you; otherwise you must still be able
  -- to open it, so a guessed token cannot plant rows.
  if not exists (select 1 from public.file_share_seen x where x.user_id = v_uid and x.share_id = v_share.id) then
    if public._file_share_rank(coalesce(public._file_share_resolve(p_token)->>'access', 'none')) < 1 then
      raise exception 'file not found' using errcode = 'P0002';
    end if;
  end if;
  select lower(u.email) into v_email
    from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  v_source := case when exists (
                select 1 from public.file_share_people p
                 where p.share_id = v_share.id and p.revoked_at is null
                   and (p.user_id = v_uid or (p.user_id is null and v_email is not null and p.email = v_email)))
              then 'person' else 'link' end;
  insert into public.file_share_seen as s (user_id, share_id, source, hidden_at)
  values (v_uid, v_share.id, v_source, case when coalesce(p_hidden, true) then now() end)
  on conflict (user_id, share_id) do update
     set hidden_at = case when coalesce(p_hidden, true) then now() end,
         source = excluded.source;
  return true;
end;
$$;

-- create or replace keeps each function's ACL; these restate it.
revoke all on function public.mark_file_share_opened(uuid) from public, anon;
revoke all on function public.hide_shared_file(uuid, boolean) from public, anon;
grant execute on function public.mark_file_share_opened(uuid) to authenticated, service_role;
grant execute on function public.hide_shared_file(uuid, boolean) to authenticated, service_role;

-- ── Proof (0311 habit) ──────────────────────────────────────────────────────

do $$
declare
  v_sig text;
  v_src text;
begin
  foreach v_sig in array array['public.mark_file_share_opened(uuid)', 'public.hide_shared_file(uuid, boolean)'] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0425: % is callable signed out', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0425: % is not callable by a signed-in user', v_sig;
    end if;
    if not (select p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
              from pg_proc p where p.oid = v_sig::regprocedure) then
      raise exception '0425: % is not security definer with an empty search_path', v_sig;
    end if;
    select p.prosrc into v_src from pg_proc p where p.oid = v_sig::regprocedure;
    if position('source = excluded.source' in v_src) = 0 then
      raise exception '0425: % keeps a stale source', v_sig;
    end if;
  end loop;
end $$;
