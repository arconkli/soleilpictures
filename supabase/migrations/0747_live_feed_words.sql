-- 0747 — The live feed in words (sharing insight, Phase 2).
--
-- The admin's live console prints raw event names ("share_link_copied"). To
-- read as a sentence ("Maya copied the view link to 'Pitch deck'") a row needs
-- who did it and what it was about, which the event's props only name by id.
--
--   1. _admin_event_facts(event, props, user_id): the facts a sentence needs,
--      for the sharing events only ({} for every other one): the cluster
--      (board_id, from props board_id, else root_id, else source_board_id; its
--      title, whether it's deleted, its workspace and that workspace's owner),
--      a shared file's title (file_share_view's share_id), and a whitelist of
--      short props (kind, surface, role, how, status, n, result, link_kind,
--      link_access, to, method, via, channel). insider: the person is a member
--      of the cluster's workspace (their own view of their own link). Never a
--      token: no props key is copied unless it is on the list, and none on it
--      carries one. Closed to clients.
--   2. admin_event_words(ids, exclude_internal): admin_events_by_id's row
--      (0278's internal rule, word for word) with actor_name and facts. The
--      console calls it for the rows it already has; admin_recent_events and
--      admin_events_by_id are left as they are, so production's admin, which
--      calls them, is untouched.

begin;

set local lock_timeout = '3s';

-- ── 1. The facts ─────────────────────────────────────────────────────────────
create or replace function public._admin_event_facts(p_event text, p_props jsonb, p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
as $fn$
declare
  v_props  jsonb := coalesce(p_props, '{}'::jsonb);
  v_board  uuid;
  v_share  uuid;
  v_out    jsonb;
  v_key    text;
begin
  if p_event is null or p_event not in (
    'share_open', 'share_link_copied', 'share_link_created', 'share_access_changed', 'share_ask_taken',
    'access_granted', 'co_creation_started', 'share_view', 'share_cta_click',
    'invite_sent', 'invite_link_created', 'invite_link_view', 'invite_link_join_click', 'invite_link_claimed',
    'file_share_open', 'file_share_access_set', 'file_share_people_add', 'file_share_link_copy',
    'file_share_view', 'file_share_download', 'file_share_stop',
    'shared_file_open', 'shared_file_save',
    'workspace_link_shared', 'joiner_landed', 'team_joined',
    'referral_link_copied', 'referral_link_shared', 'remix_clone') then
    return '{}'::jsonb;
  end if;

  v_out := '{}'::jsonb;
  foreach v_key in array array['kind', 'surface', 'role', 'how', 'status', 'n', 'result', 'link_kind',
                               'link_access', 'to', 'method', 'via', 'channel'] loop
    if jsonb_typeof(v_props -> v_key) in ('string', 'number', 'boolean') then
      v_out := v_out || jsonb_build_object(v_key, left(v_props ->> v_key, 40));
    end if;
  end loop;

  begin
    v_board := coalesce(nullif(v_props ->> 'board_id', ''), nullif(v_props ->> 'root_id', ''),
                        nullif(v_props ->> 'source_board_id', ''))::uuid;
  exception when invalid_text_representation then
    v_board := null;
  end;
  if v_board is not null then
    v_out := v_out || coalesce((
      select jsonb_build_object(
               'board_id', b.id, 'board_title', b.name, 'board_deleted', b.deleted_at is not null,
               'workspace_name', w.name, 'owner_id', w.created_by,
               'owner_name', coalesce(nullif(op.display_name, ''), split_part(ou.email::text, '@', 1)),
               'insider', p_user_id is not null and exists (
                 select 1 from public.workspace_members m where m.workspace_id = b.workspace_id and m.user_id = p_user_id))
        from public.boards b
        left join public.workspaces w on w.id = b.workspace_id
        left join public.profiles op on op.user_id = w.created_by
        left join auth.users ou on ou.id = w.created_by
       where b.id = v_board), '{}'::jsonb);
  end if;

  if p_event = 'file_share_view' then
    begin
      v_share := nullif(v_props ->> 'share_id', '')::uuid;
    exception when invalid_text_representation then
      v_share := null;
    end;
    if v_share is not null then
      v_out := v_out || coalesce((
        select jsonb_build_object(
                 'file_title', coalesce(nullif(ci.title, ''), b.name),
                 'board_id', fs.board_id, 'board_title', b.name, 'board_deleted', b.deleted_at is not null)
          from public.file_shares fs
          left join public.boards b on b.id = fs.board_id
          left join lateral (select c.title from public.card_index c
                              where c.board_id = fs.board_id and c.card_id = fs.card_id limit 1) ci on true
         where fs.id = v_share), '{}'::jsonb);
    end if;
  end if;

  return v_out;
end
$fn$;

revoke execute on function public._admin_event_facts(text, jsonb, uuid) from public, anon, authenticated;

-- ── 2. The read ──────────────────────────────────────────────────────────────
create or replace function public.admin_event_words(p_ids uuid[], p_exclude_internal boolean default true)
returns table (id uuid, event text, occurred_at timestamptz, user_id uuid, email text, path text,
               actor_name text, facts jsonb)
language plpgsql stable security definer
set search_path = 'public'
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'at most 200 ids per call' using errcode = '22023';
  end if;

  -- The predicate is admin_recent_events' (0278), as admin_events_by_id's is.
  return query
  select e.id, e.event, e.occurred_at, e.user_id, u.email::text, e.path,
         nullif(p.display_name, ''),
         public._admin_event_facts(e.event, e.props, e.user_id)
    from public.analytics_events e
    left join auth.users u on u.id = e.user_id
    left join public.profiles p on p.user_id = e.user_id
   where e.id = any(p_ids)
     and (not p_exclude_internal
          or ((e.user_id is null
               or e.user_id not in (select iu.user_id from public._internal_user_ids() iu))
              and (e.session_id is null
                   or e.session_id not in (select isid.session_id from public._internal_session_ids() isid))))
   order by e.occurred_at desc;
end $function$;

revoke execute on function public.admin_event_words(uuid[], boolean) from public, anon;
grant execute on function public.admin_event_words(uuid[], boolean) to authenticated;

notify pgrst, 'reload schema';

do $proof$
declare
  v_who   text;
  v_admin uuid;
  v_user  uuid;
  v_ids   uuid[];
  v_n     int;
  v_rows  int;
  v_blob  text;
begin
  foreach v_who in array array['public', 'anon', 'authenticated'] loop
    if has_function_privilege(v_who, 'public._admin_event_facts(text,jsonb,uuid)', 'execute') then
      raise exception '0747: % can execute _admin_event_facts', v_who;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.admin_event_words(uuid[],boolean)', 'execute') then
    raise exception '0747: anon can execute admin_event_words';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_event_words(uuid[],boolean)', 'execute') then
    raise exception '0747: authenticated cannot execute admin_event_words';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.admin_event_words(uuid[],boolean)'::regprocedure)
     or position('_require_admin()' in pg_get_functiondef('public.admin_event_words(uuid[],boolean)'::regprocedure)) = 0 then
    raise exception '0747: admin_event_words is not an admin-only definer';
  end if;

  -- A non-admin is turned away.
  select p.user_id into v_user from public.profiles p where p.tier is distinct from 'admin' and p.banned_at is null limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin
    perform 1 from public.admin_event_words(array[gen_random_uuid()], true);
    raise exception '0747: a non-admin read the feed';
  exception when insufficient_privilege then null;
  end;

  -- As an admin: the latest share events read with their facts, the same rows
  -- admin_events_by_id returns, and no token anywhere in them.
  select p.user_id into v_admin from public.profiles p where p.tier = 'admin' limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select array_agg(x.id) into v_ids from (
    select e.id from public.analytics_events e
     where e.event in ('share_link_copied', 'share_view', 'access_granted', 'file_share_view', 'invite_sent')
       and e.occurred_at > now() - interval '30 days'
     order by e.occurred_at desc limit 100) x;
  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception '0747: no share events in 30 days to read';
  end if;
  select count(*), count(*) filter (where w.facts ? 'board_title' or w.facts ? 'file_title' or w.facts ? 'kind'),
         string_agg(w.facts::text, ' ')
    into v_rows, v_n, v_blob
    from public.admin_event_words(v_ids, false) w;
  if v_rows <> (select count(*) from public.admin_events_by_id(v_ids, false)) then
    raise exception '0747: the words read % rows, admin_events_by_id another number', v_rows;
  end if;
  if v_n = 0 then
    raise exception '0747: no share event carried a fact';
  end if;
  if v_blob ~* '"token"|_token"|device_id|session_id' then
    raise exception '0747: a token or a device left in the facts';
  end if;
  if (select count(*) from public.admin_event_words(v_ids, true))
     <> (select count(*) from public.admin_events_by_id(v_ids, true)) then
    raise exception '0747: the internal rule differs from admin_events_by_id''s';
  end if;
  if public._admin_event_facts('card_placed', '{"board_id":"00000000-0000-0000-0000-000000000000"}', null) <> '{}'::jsonb then
    raise exception '0747: a non-sharing event carried facts';
  end if;
  if public._admin_event_facts('share_view', '{"board_id":"not-a-uuid","token":"x","kind":"view"}', null) <> '{"kind":"view"}'::jsonb then
    raise exception '0747: a bad id or an unlisted key got through';
  end if;

  perform set_config('request.jwt.claims', '', true);
end
$proof$;

commit;
