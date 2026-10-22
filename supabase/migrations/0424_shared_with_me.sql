-- 0424: what happens to a file once it's shared — the Shared page.
--
--   1. file_share_seen: one row per (person, share) once a shared file has
--      reached them: when they opened it, whether they took it off their list,
--      and whether it came from a link rather than an invitation.
--   2. list_shared_with_me(limit, before): files people added you to, and
--      files you opened from a link while signed in, newest first. Every row
--      is resolved through _file_share_resolve, so a takedown, a stopped share
--      or a deleted card drops out exactly as the /f/ page would say "gone".
--   3. mark_file_share_opened(token) and hide_shared_file(token, hidden).
--   4. list_my_file_shares(): what you have shared that is still shared.
--   5. stop_file_share(board, card) turns the link off and removes everyone in
--      one step; undo_stop_file_share brings back exactly what that step
--      removed, and sends no email (only add_file_share_people sets
--      app.file_share_invite, which the invitation trigger needs).
--   6. get_file_share_posters(tokens): poster keys for list rows, for the party
--      to presign. Keys never reach a browser.
--
-- Additive: no existing function is replaced. Nothing is removed by a
-- statement here.

-- ── 1. Who has seen what ────────────────────────────────────────────────────

create table if not exists public.file_share_seen (
  user_id       uuid not null references auth.users(id) on delete cascade,
  share_id      uuid not null references public.file_shares(id) on delete cascade,
  source        text not null default 'person' check (source in ('person', 'link')),
  first_seen_at timestamptz not null default now(),
  opened_at     timestamptz,
  hidden_at     timestamptz,
  primary key (user_id, share_id)
);
create index if not exists file_share_seen_share_idx on public.file_share_seen (share_id);

-- Only the RPCs below touch it.
alter table public.file_share_seen enable row level security;
revoke all on table public.file_share_seen from public, anon, authenticated;

-- "Shared by me" looks shares up by who made them.
create index if not exists file_shares_created_by_idx on public.file_shares (created_by);
create index if not exists file_share_people_inviter_idx on public.file_share_people (invited_by)
  where revoked_at is null;

-- ── 2. Shared with me ───────────────────────────────────────────────────────

-- A person's display name and picture, never their email.
create or replace function public._file_share_person_card(p_user uuid)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('name', coalesce(nullif(btrim(pr.display_name), ''), 'Someone on Clusters'),
                               'avatar_url', pr.avatar_url)
       from public.profiles pr where pr.user_id = p_user),
    jsonb_build_object('name', 'Someone on Clusters', 'avatar_url', null));
$$;

-- The files shared with the caller, newest first:
--   people who added you (live rows, by account or by your confirmed email),
--   and links you opened while signed in (file_share_seen, source 'link').
-- Not your own shares, not files on clusters you can already open (those are
-- yours to find in the cluster), and not rows you took off the list. Each row
-- must still resolve with at least view access.
create or replace function public.list_shared_with_me(p_limit integer default 100, p_before timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_lim    integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_items  jsonb := '[]'::jsonb;
  v_n      integer := 0;
  v_last   timestamptz;
  v_more   boolean := false;
  v_row    record;
  v_r      jsonb;
  v_access text;
  v_file   jsonb;
  v_act    timestamptz;
begin
  if v_uid is null then
    raise exception 'sign in to see what is shared with you' using errcode = '42501';
  end if;
  select lower(u.email) into v_email
    from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  -- Nothing binds an invitation to an account made after it; get_file_share
  -- binds one file at a time, this binds them all.
  if v_email is not null then
    update public.file_share_people p
       set user_id = v_uid
     where p.user_id is null and p.revoked_at is null and p.email = v_email;
  end if;

  for v_row in
    with cand as (
      select p.share_id, 'person'::text as source, p.created_at as shared_at, p.invited_by as by_user
        from public.file_share_people p
       where p.user_id = v_uid and p.revoked_at is null
      union all
      select s.share_id, 'link'::text, s.first_seen_at, null::uuid
        from public.file_share_seen s
       where s.user_id = v_uid and s.source = 'link'
    ), best as (
      select distinct on (c.share_id) c.share_id, c.source, c.shared_at, c.by_user
        from cand c
       order by c.share_id, (c.source = 'person') desc, c.shared_at desc
    )
    select b.share_id, b.source, b.shared_at,
           coalesce(b.by_user, f.link_set_by, f.created_by) as by_user,
           f.token, f.board_id, seen.opened_at
      from best b
      join public.file_shares f on f.id = b.share_id
      left join public.file_share_seen seen on seen.user_id = v_uid and seen.share_id = b.share_id
     where f.created_by <> v_uid
       and seen.hidden_at is null
       and (p_before is null or b.shared_at < p_before)
     order by b.shared_at desc, b.share_id
     limit 1000
  loop
    if v_n >= v_lim then
      v_more := true;
      exit;
    end if;
    if coalesce(public.can_read_board(v_row.board_id), false) then
      continue;
    end if;
    v_r := public._file_share_resolve(v_row.token);
    if v_r is null then
      continue;
    end if;
    v_access := v_r->>'access';
    if public._file_share_rank(v_access) < 1 then
      continue;
    end if;
    v_file := v_r->'file';
    v_act := null;
    if public._file_share_rank(v_access) >= 2 then
      select max(c.created_at) into v_act
        from public.file_comments c
       where c.share_id = v_row.share_id and c.author <> v_uid and c.deleted_at is null;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'token', v_row.token,
      'kind', v_file->'kind',
      'name', v_file->'name',
      'mime', v_file->'mime',
      'size', v_file->'size',
      'ext', v_file->'ext',
      'risky', v_file->'risky',
      'access', v_access,
      'allow_download', coalesce((v_r->>'allow_download')::boolean, false),
      'shared_by', public._file_share_person_card(v_row.by_user),
      'source', v_row.source,
      'shared_at', v_row.shared_at,
      'opened_at', v_row.opened_at,
      'activity_at', v_act,
      'unread', v_row.opened_at is null or (v_act is not null and v_act > v_row.opened_at)
    ));
    v_n := v_n + 1;
    v_last := v_row.shared_at;
  end loop;

  return jsonb_build_object('items', v_items, 'next_before', case when v_more then v_last end);
end;
$$;

-- Opening a shared file marks it read; a signed-in open from a link puts it
-- on your list ("link-opened files listed too", owner 2026-10-18). Opening a
-- file you had taken off the list puts it back. Your own shares and files on
-- clusters you can already open are not recorded. Returns whether it recorded.
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
         source = case when excluded.source = 'person' then 'person' else s.source end;
  return true;
end;
$$;

-- Take a file off your "Shared with me" list, or put it back (the undo
-- toast). It changes nothing for the person who shared it.
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
     set hidden_at = case when coalesce(p_hidden, true) then now() end;
  return true;
end;
$$;

-- ── 4. Shared by me ─────────────────────────────────────────────────────────

-- What the caller has shared that is still shared (a link that is on, or
-- someone still added), on clusters they can still manage. Newest first.
create or replace function public.list_my_file_shares(p_limit integer default 200)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_lim   integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_items jsonb := '[]'::jsonb;
  v_n     integer := 0;
  v_f     public.file_shares;
  v_r     jsonb;
  v_file  jsonb;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  for v_f in
    select f.*
      from public.file_shares f
     where (f.created_by = v_uid or f.link_set_by = v_uid
            or exists (select 1 from public.file_share_people p
                        where p.share_id = f.id and p.invited_by = v_uid and p.revoked_at is null))
       and (f.link_access <> 'none'
            or exists (select 1 from public.file_share_people p
                        where p.share_id = f.id and p.revoked_at is null))
     order by f.updated_at desc, f.id
     limit 1000
  loop
    exit when v_n >= v_lim;
    v_r := public._file_share_resolve(v_f.token);
    if v_r is null or v_r->>'access' <> 'manage' then
      continue;
    end if;
    v_file := v_r->'file';
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'token', v_f.token,
      'board_id', v_f.board_id,
      'board_name', (select b.name from public.boards b where b.id = v_f.board_id),
      'card_id', v_f.card_id,
      'kind', v_file->'kind',
      'name', v_file->'name',
      'link_access', v_f.link_access,
      'allow_download', v_f.allow_download,
      'people_count', (select count(*) from public.file_share_people p
                        where p.share_id = v_f.id and p.revoked_at is null),
      'people', coalesce((select jsonb_agg(x.email order by x.created_at, x.email)
                            from (select p.email, p.created_at from public.file_share_people p
                                   where p.share_id = v_f.id and p.revoked_at is null
                                   order by p.created_at, p.email limit 5) x), '[]'::jsonb),
      'comment_count', (select count(*) from public.file_comments c
                         where c.share_id = v_f.id and c.deleted_at is null),
      'updated_at', v_f.updated_at
    ));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('items', v_items);
end;
$$;

-- ── 5. Stop sharing, and its undo ───────────────────────────────────────────

-- Turn the link off and remove everyone, in one step. Returns what the undo
-- needs: the link as it was and the stamp on the rows this step removed.
create or replace function public.stop_file_share(p_board uuid, p_card text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_share public.file_shares;
  v_at    timestamptz := clock_timestamp();
  v_n     integer;
begin
  if auth.uid() is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  v_share := public._file_share_find(p_board, p_card);
  if v_share.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  update public.file_shares f
     set link_access = 'none', updated_at = v_at
   where f.id = v_share.id;
  update public.file_share_people p
     set revoked_at = v_at
   where p.share_id = v_share.id and p.revoked_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('link_access', v_share.link_access, 'stopped_at', v_at, 'people', v_n);
end;
$$;

-- The undo: the link back as it was, and only the people that step removed.
-- No invitation goes out again: app.file_share_invite stays off.
create or replace function public.undo_stop_file_share(p_board uuid, p_card text, p_link_access text, p_stopped_at timestamptz)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_share public.file_shares;
  v_link  text := coalesce(p_link_access, 'none');
begin
  if v_uid is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  if v_link not in ('none', 'view', 'comment') then
    raise exception 'link access must be none, view or comment' using errcode = '22023';
  end if;
  v_share := public._file_share_find(p_board, p_card);
  if v_share.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  -- Only the step that turned it off: a link someone set again since is theirs.
  if v_share.link_access = 'none' then
    update public.file_shares f
       set link_access = v_link,
           link_set_by = case when v_link <> 'none' then coalesce(f.link_set_by, v_uid) else f.link_set_by end,
           updated_at = now()
     where f.id = v_share.id;
  end if;
  if p_stopped_at is not null then
    update public.file_share_people p
       set revoked_at = null
     where p.share_id = v_share.id and p.revoked_at = p_stopped_at;
  end if;
  return public.get_file_share_settings(p_board, p_card);
end;
$$;

-- ── 6. Posters for list rows ────────────────────────────────────────────────

-- {token: poster key} for the files among p_tokens the caller can open. The
-- party presigns them; a browser never sees a key. An image without a preview
-- gets its original only when that is small.
create or replace function public.get_file_share_posters(p_tokens uuid[])
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_out  jsonb := '{}'::jsonb;
  v_t    uuid;
  v_r    jsonb;
  v_file jsonb;
  v_key  text;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_tokens is null or cardinality(p_tokens) = 0 then
    return v_out;
  end if;
  if cardinality(p_tokens) > 50 then
    raise exception 'at most 50 files at a time' using errcode = '22023';
  end if;
  foreach v_t in array p_tokens loop
    v_r := public._file_share_resolve(v_t);
    if v_r is null or public._file_share_rank(v_r->>'access') < 1 then
      continue;
    end if;
    v_file := v_r->'file';
    v_key := v_file->>'poster';
    if v_key is null and v_file->>'kind' = 'image'
       and coalesce((v_file->>'size')::bigint, 0) between 1 and 5 * 1024 * 1024 then
      v_key := v_file->>'src';
    end if;
    if v_key is not null then
      v_out := v_out || jsonb_build_object(v_t::text, v_key);
    end if;
  end loop;
  return v_out;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke execute on function public._file_share_person_card(uuid) from public, anon, authenticated;

revoke all on function public.list_shared_with_me(integer, timestamptz) from public, anon;
revoke all on function public.mark_file_share_opened(uuid) from public, anon;
revoke all on function public.hide_shared_file(uuid, boolean) from public, anon;
revoke all on function public.list_my_file_shares(integer) from public, anon;
revoke all on function public.stop_file_share(uuid, text) from public, anon;
revoke all on function public.undo_stop_file_share(uuid, text, text, timestamptz) from public, anon;
revoke all on function public.get_file_share_posters(uuid[]) from public, anon;
grant execute on function public.list_shared_with_me(integer, timestamptz) to authenticated, service_role;
grant execute on function public.mark_file_share_opened(uuid) to authenticated, service_role;
grant execute on function public.hide_shared_file(uuid, boolean) to authenticated, service_role;
grant execute on function public.list_my_file_shares(integer) to authenticated, service_role;
grant execute on function public.stop_file_share(uuid, text) to authenticated, service_role;
grant execute on function public.undo_stop_file_share(uuid, text, text, timestamptz) to authenticated, service_role;
grant execute on function public.get_file_share_posters(uuid[]) to authenticated, service_role;

-- ── Proof (0311 habit: a REVOKE reporting success proves nothing) ───────────

do $$
declare
  v_sig text;
  v_src text;
begin
  foreach v_sig in array array[
    'public.list_shared_with_me(integer, timestamptz)',
    'public.mark_file_share_opened(uuid)',
    'public.hide_shared_file(uuid, boolean)',
    'public.list_my_file_shares(integer)',
    'public.stop_file_share(uuid, text)',
    'public.undo_stop_file_share(uuid, text, text, timestamptz)',
    'public.get_file_share_posters(uuid[])'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0424: % is callable signed out', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0424: % is not callable by a signed-in user', v_sig;
    end if;
    if not (select p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
              from pg_proc p where p.oid = v_sig::regprocedure) then
      raise exception '0424: % is not security definer with an empty search_path', v_sig;
    end if;
  end loop;

  v_sig := 'public._file_share_person_card(uuid)';
  if has_function_privilege('public', v_sig, 'execute')
     or has_function_privilege('anon', v_sig, 'execute')
     or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception '0424: % is client-callable', v_sig;
  end if;

  if has_table_privilege('authenticated', 'public.file_share_seen', 'select')
     or has_table_privilege('anon', 'public.file_share_seen', 'select')
     or has_table_privilege('authenticated', 'public.file_share_seen', 'insert') then
    raise exception '0424: file_share_seen is readable or writable by clients';
  end if;

  -- Every list row goes through the same resolver as the /f/ page.
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.list_shared_with_me(integer, timestamptz)'::regprocedure;
  if position('_file_share_resolve(v_row.token)' in v_src) = 0
     or position('can_read_board(v_row.board_id)' in v_src) = 0 then
    raise exception '0424: list_shared_with_me skips the resolver or the team check';
  end if;
  -- The undo never re-sends an invitation.
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.undo_stop_file_share(uuid, text, text, timestamptz)'::regprocedure;
  if position('file_share_invite' in v_src) > 0 then
    raise exception '0424: undo_stop_file_share would re-send invitations';
  end if;
end $$;
