-- 0607_file_shares_follow_their_sharer.sql
--
-- 1. A file or doc share reaches people only while the person who shared it
--    can still edit the cluster it lives in (_user_can_write_board, 0524):
--    the /f/ link they turned on and the people they invited stop working
--    when they are removed, leave, are unshared or become a viewer. The
--    share's own owner-and-team access is unchanged.
-- 2. An address match for the session's own account counts only when the
--    session came from the inbox (_session_proves_inbox, 0600), in
--    _file_share_access and _doc_share_access. Binding a pending invitation
--    to the account (get_file_share, list_shared_with_me) needs that and an
--    address the account has proven (_user_proved_inbox, 0527); both stamp
--    the proof first (_stamp_inbox_proof), so a session from the inbox binds
--    at once.
--
-- Bodies re-emitted from the live definitions; only these lines change.

CREATE OR REPLACE FUNCTION public._file_share_access(p_share file_shares, p_risky boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_team  boolean := false;
  v_best  integer;
  v_rank  integer;
  v_email text;
begin
  if p_share.id is null then
    return 'none';
  end if;
  if v_uid is not null and coalesce(public.can_write_board(p_share.board_id), false) then
    return 'manage';
  end if;
  v_team := v_uid is not null and coalesce(public.can_read_board(p_share.board_id), false);

  if public._sharer_suspended(p_share.created_by)
     or exists (select 1 from public.workspaces w
                 where w.id = p_share.workspace_id and public._user_banned(w.created_by)) then
    return case when v_team then 'comment' else 'none' end;
  end if;

  v_best := case when v_team then 2 else 0 end;

  if v_uid is not null then
    select lower(u.email) into v_email
      from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
       and public._session_proves_inbox();
    select max(public._file_share_rank(p.role)) into v_rank
      from public.file_share_people p
     where p.share_id = p_share.id and p.revoked_at is null
       and not public._sharer_suspended(p.invited_by)
       and public._user_can_write_board(p.invited_by, p_share.board_id)
       and (p.user_id = v_uid or (p.user_id is null and v_email is not null and p.email = v_email));
    v_best := greatest(v_best, coalesce(v_rank, 0));
  end if;

  if p_share.link_access <> 'none'
     and not public._sharer_suspended(p_share.link_set_by)
     and public._user_can_write_board(p_share.link_set_by, p_share.board_id)
     and not (coalesce(p_risky, false)
              and exists (select 1 from auth.users u
                           where u.id = p_share.link_set_by and u.created_at > now() - interval '72 hours')) then
    v_best := greatest(v_best, public._file_share_rank(p_share.link_access));
  end if;

  return case when v_best >= 2 then 'comment' when v_best = 1 then 'view' else 'none' end;
end;
$function$;

CREATE OR REPLACE FUNCTION public._doc_share_access(p_share file_shares, p_token_ok boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_team  boolean := false;
  v_best  integer;
  v_rank  integer;
  v_email text;
begin
  if p_share.id is null then
    return 'none';
  end if;
  if v_uid is not null and coalesce(public.can_write_board(p_share.board_id), false) then
    return 'manage';
  end if;
  v_team := v_uid is not null and coalesce(public.can_read_board(p_share.board_id), false);

  if public._sharer_suspended(p_share.created_by)
     or exists (select 1 from public.workspaces w
                 where w.id = p_share.workspace_id and public._user_banned(w.created_by)) then
    return case when v_team then 'view' else 'none' end;
  end if;

  v_best := case when v_team then 1 else 0 end;

  if v_uid is not null then
    select lower(u.email) into v_email
      from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
       and public._session_proves_inbox();
    select max(case when p.can_edit then 2 else 1 end) into v_rank
      from public.file_share_people p
     where p.share_id = p_share.id and p.revoked_at is null
       and not public._sharer_suspended(p.invited_by)
       and public._user_can_write_board(p.invited_by, p_share.board_id)
       and (p.user_id = v_uid or (p.user_id is null and v_email is not null and p.email = v_email));
    v_best := greatest(v_best, coalesce(v_rank, 0));
  end if;

  if coalesce(p_token_ok, false) and p_share.link_access <> 'none'
     and not public._sharer_suspended(p_share.link_set_by)
     and public._user_can_write_board(p_share.link_set_by, p_share.board_id) then
    v_best := greatest(v_best, case when p_share.link_can_edit and v_uid is not null then 2 else 1 end);
  end if;

  return case when v_best >= 2 then 'edit' when v_best = 1 then 'view' else 'none' end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_file_share(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_r      jsonb;
  v_access text;
  v_email  text;
  v_file   jsonb;
  v_by     jsonb;
  v_count  integer;
  v_edit   boolean;
begin
  v_r := public._file_share_resolve(p_token);
  if v_r is null then
    return jsonb_build_object('status', 'gone');
  end if;
  v_access := v_r->>'access';
  if v_access = 'none' then
    if v_uid is null then
      return jsonb_build_object('status', 'sign_in');
    end if;
    return jsonb_build_object('status', 'no_access',
                              'email', (select u.email from auth.users u where u.id = v_uid));
  end if;

  if v_uid is not null then
    -- 0607: an invitation binds to this account only when this session came
    -- from the inbox and the account has proven that address.
    perform public._stamp_inbox_proof();
    select lower(u.email) into v_email
      from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
       and public._session_proves_inbox()
       and public._user_proved_inbox(v_uid);
    if v_email is not null then
      update public.file_share_people p
         set user_id = v_uid
       where p.share_id = (v_r->>'share_id')::uuid
         and p.user_id is null and p.revoked_at is null and p.email = v_email;
    end if;
  end if;

  -- Never the sharer's email: a recipient may be anyone with the link.
  select jsonb_build_object('name', coalesce(nullif(btrim(pr.display_name), ''), 'Someone on Clusters'),
                            'avatar_url', pr.avatar_url)
    into v_by
    from public.profiles pr where pr.user_id = (v_r->>'created_by')::uuid;
  v_by := coalesce(v_by, jsonb_build_object('name', 'Someone on Clusters', 'avatar_url', null));

  v_file := v_r->'file';

  -- A doc: the room it opens in (the edit room for someone who may edit),
  -- and whether signing in would let you edit.
  if v_file->>'kind' = 'doc' then
    v_edit := v_access in ('edit', 'manage');
    return jsonb_build_object(
      'status', 'ok',
      'access', v_access,
      'signed_in', v_uid is not null,
      'can_edit', v_edit,
      'edit_needs_sign_in', v_uid is null and v_r->>'link_access' <> 'none'
                            and coalesce((v_r->>'link_can_edit')::boolean, false),
      'allow_download', coalesce((v_r->>'allow_download')::boolean, false) or v_access = 'manage',
      'file', jsonb_build_object('kind', 'doc', 'name', v_file->'name'),
      'room', (v_r->>'share_id') || case when v_edit then '.edit.' else '.view.' end
              || public._doc_room_gen((v_r->>'board_id')::uuid, v_r->>'card_id'),
      'card_key', v_file->'card_key',
      'shared_by', v_by
    ) || case when v_access = 'manage'
              then jsonb_build_object('board_id', v_r->'board_id', 'card_id', v_r->'card_id')
              else '{}'::jsonb end;
  end if;

  if public._file_share_rank(v_access) >= 2 then
    select count(*) into v_count
      from public.file_comments c
     where c.share_id = (v_r->>'share_id')::uuid and c.deleted_at is null;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'access', v_access,
    'signed_in', v_uid is not null,
    'can_comment', v_uid is not null and public._file_share_rank(v_access) >= 2,
    'allow_download', coalesce((v_r->>'allow_download')::boolean, false) or v_access = 'manage',
    'file', jsonb_build_object(
      'kind', v_file->'kind', 'name', v_file->'name', 'mime', v_file->'mime',
      'size', v_file->'size', 'duration', v_file->'duration', 'page_count', v_file->'page_count',
      'ext', v_file->'ext', 'risky', v_file->'risky'),
    'shared_by', v_by,
    'comment_count', v_count
  ) || case when v_access = 'manage'
            then jsonb_build_object('board_id', v_r->'board_id', 'card_id', v_r->'card_id')
            else '{}'::jsonb end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_shared_with_me(p_limit integer DEFAULT 100, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- 0607: invitations bind to this account only when this session came from
  -- the inbox and the account has proven that address.
  perform public._stamp_inbox_proof();
  select lower(u.email) into v_email
    from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
     and public._session_proves_inbox()
     and public._user_proved_inbox(v_uid);
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
$function$;

-- The 0311 habit: prove the grants, don't trust them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._file_share_access(file_shares,boolean)',
    'public._doc_share_access(file_shares,boolean)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0607: % is client-callable', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.get_file_share(uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.get_file_share(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_shared_with_me(integer,timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_shared_with_me(integer,timestamp with time zone)', 'EXECUTE') then
    raise exception '0607: a share RPC grant changed';
  end if;
end $$;
