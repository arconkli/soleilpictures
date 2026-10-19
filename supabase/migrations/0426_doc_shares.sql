-- 0426: share one doc and edit it together (owner, 2026-10-18: "share
-- individual docs really easily and people can edit collaboratively on
-- them"). The doc stays in its cluster; its people work in a live mirror
-- (party DocParty, src/lib/docRoomBridge.js) that this migration authorises.
--
--   1. An edit role without a DROP: file_share_people.can_edit and
--      file_shares.link_can_edit. Only these RPCs set them, only for docs.
--   2. _file_share_rank knows 'edit' (the comment tier).
--   3. _file_share_file: a doc card can be shared ({kind:'doc', name,
--      card_key}). The media branch is unchanged.
--   4. _doc_share_access(share, token_ok): manage | edit | view | none.
--      The team (can_read_board) views, people get view or edit, the link
--      gives view, or edit to someone signed in, and only when the link was
--      presented. The 0422 takedowns apply.
--   5. _file_share_resolve dispatches by kind and says how the link is set.
--   6. get_file_share: a doc answers its room and whether you may edit; and
--      no answer carries storage keys any more. The party reads them through
--      _file_share_keys, service role only, after get_file_share has said
--      ok as the caller (security review, 2026-10-18).
--   7. get_file_share_posters answers which rows have a poster, not keys;
--      _file_share_poster_keys is the party's, service role only.
--   8. The owner dialog's RPCs speak view | edit for a doc.
--   9. A doc's comments live in the doc: the file-comment RPCs refuse docs.
--  10. doc_room_access(room, token): what the doc's room asks, as the caller.
--      A room is <share id>.<edit|view>.<generation>: the generation hashes
--      the card's cluster, its id and the cluster's restore count, so a
--      restore or a move opens a fresh room.
--  11. _doc_room_target(share) and _doc_room_recheck(share, subjects): the
--      room's own questions, service role only.
--  12. The invitation names a doc and the edit role.
--
-- Each re-emit is the live definition with only these changes. Nothing is
-- removed by a statement here.

-- ── 1. The edit role ────────────────────────────────────────────────────────

alter table public.file_share_people add column if not exists can_edit boolean not null default false;
alter table public.file_shares add column if not exists link_can_edit boolean not null default false;

-- ── 2. The rank knows 'edit' ────────────────────────────────────────────────

create or replace function public._file_share_rank(p text)
returns integer
language sql immutable security definer
set search_path = '' as $$
  select case p when 'manage' then 3 when 'comment' then 2 when 'edit' then 2 when 'view' then 1 else 0 end;
$$;

-- ── 3. A doc card can be shared ─────────────────────────────────────────────

create or replace function public._file_share_file(p_ws uuid, p_ci public.card_index)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  v_kind   text := p_ci.kind;
  v_meta   jsonb := case when jsonb_typeof(p_ci.meta) = 'object' then p_ci.meta else '{}'::jsonb end;
  v_ref    text;
  v_key    text;
  v_img    public.images;
  v_p      text;
  v_poster text;
  v_name   text;
  v_mime   text;
  v_ext    text;
begin
  if p_ws is null or p_ci.card_id is null or v_kind is null then
    return null;
  end if;
  -- A doc lives in its cluster's document, not in storage: what it is called
  -- and which card it is are all a share needs.
  if v_kind = 'doc' then
    return jsonb_build_object(
      'kind', 'doc',
      'name', left(coalesce(nullif(btrim(p_ci.title), ''), 'Untitled doc'), 200),
      'mime', null, 'size', null, 'duration', null, 'page_count', null, 'ext', null,
      'src', null, 'poster', null, 'risky', false,
      'card_key', p_ci.card_id);
  end if;
  if v_kind <> all (array['image', 'video', 'audio', 'pdf', 'file']) then
    return null;
  end if;
  v_ref := v_meta->>(case v_kind when 'pdf' then 'pdfSrc' when 'file' then 'fileSrc' else 'src' end);
  if v_ref is null or left(v_ref, 3) <> 'r2:' or char_length(v_ref) < 4 then
    return null;
  end if;
  v_key := substr(v_ref, 4);
  select i.* into v_img
    from public.images i
   where i.storage_path = v_key and i.workspace_id = p_ws and i.deleted_at is null
   limit 1;
  if not found then
    return null;
  end if;

  if v_kind in ('video', 'pdf') then
    v_p := v_meta->>(case v_kind when 'video' then 'poster' else 'src' end);
    if v_p is not null and left(v_p, 3) = 'r2:'
       and exists (select 1 from public.images i
                    where i.storage_path = substr(v_p, 4) and i.workspace_id = p_ws and i.deleted_at is null) then
      v_poster := substr(v_p, 4);
    end if;
  elsif v_kind = 'image' then
    v_poster := coalesce(v_img.preview_path, v_img.preview_sm_path);
  end if;

  v_name := left(coalesce(nullif(btrim(v_meta->>'fileName'), ''),
                          nullif(btrim(v_meta->>'name'), ''),
                          nullif(btrim(p_ci.title), ''),
                          nullif(btrim(v_img.original_name), ''),
                          'File'), 200);
  v_mime := nullif(btrim(left(v_meta->>'mime', 200)), '');
  v_ext := lower(substring(v_name from '\.([A-Za-z0-9]{1,8})$'));
  if v_ext is null and lower(v_meta->>'ext') ~ '^[a-z0-9]{1,8}$' then
    v_ext := lower(v_meta->>'ext');
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'name', v_name,
    'mime', v_mime,
    'size', case when v_meta->>'sizeBytes' ~ '^\d{1,15}$' then (v_meta->>'sizeBytes')::bigint
                 else v_img.size_bytes end,
    'duration', case when v_kind in ('video', 'audio') and v_meta->>'duration' ~ '^\d{1,7}(\.\d+)?$'
                     then (v_meta->>'duration')::numeric end,
    'page_count', case when v_kind = 'pdf' and v_meta->>'pageCount' ~ '^\d{1,6}$'
                       then (v_meta->>'pageCount')::integer end,
    'ext', v_ext,
    'src', v_key,
    'poster', v_poster,
    'risky', v_kind = 'file' and public._file_risky(v_name, v_mime)
  );
end;
$$;

-- ── 4. Who may open or edit a shared doc ────────────────────────────────────

-- 'manage' | 'edit' | 'view' | 'none' for the caller. p_token_ok: the caller
-- presented the share's token (the link is the capability; a room joined by
-- name alone counts only the team and the people added).
create or replace function public._doc_share_access(p_share public.file_shares, p_token_ok boolean)
returns text
language plpgsql stable security definer
set search_path = '' as $$
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
      from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
    select max(case when p.can_edit then 2 else 1 end) into v_rank
      from public.file_share_people p
     where p.share_id = p_share.id and p.revoked_at is null
       and not public._sharer_suspended(p.invited_by)
       and (p.user_id = v_uid or (p.user_id is null and v_email is not null and p.email = v_email));
    v_best := greatest(v_best, coalesce(v_rank, 0));
  end if;

  if coalesce(p_token_ok, false) and p_share.link_access <> 'none'
     and not public._sharer_suspended(p_share.link_set_by) then
    v_best := greatest(v_best, case when p_share.link_can_edit and v_uid is not null then 2 else 1 end);
  end if;

  return case when v_best >= 2 then 'edit' when v_best = 1 then 'view' else 'none' end;
end;
$$;

-- The room's generation: a restore (board_state_version.version) or a move
-- (a new cluster or card id) gives a new room, so nobody can push a stale
-- copy back into a restored doc.
create or replace function public._doc_room_gen(p_board uuid, p_card text)
returns text
language sql stable security definer
set search_path = '' as $$
  select substr(md5(p_board::text || ':' || coalesce(p_card, '') || ':'
                    || coalesce((select v.version from public.board_state_version v where v.board_id = p_board), 0)::text),
                1, 12);
$$;

-- ── 5. _file_share_resolve dispatches by kind ───────────────────────────────

create or replace function public._file_share_resolve(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_share  public.file_shares;
  v_ci     public.card_index;
  v_file   jsonb;
  v_access text;
begin
  if p_token is null then
    return null;
  end if;
  select s.* into v_share from public.file_shares s where s.token = p_token;
  if not found then
    return null;
  end if;
  v_ci := public._file_share_card(v_share);
  if v_ci.card_id is null then
    return null;
  end if;
  if not exists (select 1 from public.boards b where b.id = v_share.board_id and b.deleted_at is null) then
    return null;
  end if;
  if (public._sharer_suspended(v_share.created_by)
      or exists (select 1 from public.workspaces w
                  where w.id = v_share.workspace_id and public._user_banned(w.created_by)))
     and not (auth.uid() is not null and coalesce(public.can_read_board(v_share.board_id), false)) then
    return null;
  end if;
  v_file := public._file_share_file(v_share.workspace_id, v_ci);
  if v_file is null then
    return null;
  end if;
  if v_file->>'kind' = 'doc' then
    v_access := public._doc_share_access(v_share, true);
  else
    v_access := public._file_share_access(v_share, coalesce((v_file->>'risky')::boolean, false));
  end if;
  return jsonb_build_object(
    'share_id', v_share.id,
    'token', v_share.token,
    'access', v_access,
    'file', v_file,
    'board_id', v_share.board_id,
    'card_id', v_share.card_id,
    'workspace_id', v_share.workspace_id,
    'created_by', v_share.created_by,
    'allow_download', v_share.allow_download,
    'link_access', v_share.link_access,
    'link_can_edit', v_share.link_can_edit
  );
end;
$$;

-- ── 6. get_file_share: a doc's room, and no storage keys for anyone ─────────

create or replace function public.get_file_share(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
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
    select lower(u.email) into v_email
      from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
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
$$;

-- The storage keys of a shared file, for the party to presign once
-- get_file_share, run as the caller, has said ok. Service role only.
create or replace function public._file_share_keys(p_token uuid)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  v_share public.file_shares;
  v_ci    public.card_index;
  v_file  jsonb;
begin
  select s.* into v_share from public.file_shares s where s.token = p_token;
  if not found then
    return null;
  end if;
  v_ci := public._file_share_card(v_share);
  if v_ci.card_id is null then
    return null;
  end if;
  v_file := public._file_share_file(v_share.workspace_id, v_ci);
  if v_file is null or v_file->>'kind' = 'doc' then
    return null;
  end if;
  return jsonb_build_object('src', v_file->'src', 'poster', v_file->'poster');
end;
$$;

-- ── 7. Posters: which rows have one; the keys are the party's ───────────────

create or replace function public.get_file_share_posters(p_tokens uuid[])
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_out  jsonb := '{}'::jsonb;
  v_t    uuid;
  v_r    jsonb;
  v_file jsonb;
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
    if v_file->>'poster' is not null
       or (v_file->>'kind' = 'image' and coalesce((v_file->>'size')::bigint, 0) between 1 and 5 * 1024 * 1024) then
      v_out := v_out || jsonb_build_object(v_t::text, true);
    end if;
  end loop;
  return v_out;
end;
$$;

-- {token: poster key} for tokens the party has already been told the caller
-- may open (get_file_share_posters as the caller). Service role only.
create or replace function public._file_share_poster_keys(p_tokens uuid[])
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  v_out   jsonb := '{}'::jsonb;
  v_t     uuid;
  v_share public.file_shares;
  v_ci    public.card_index;
  v_file  jsonb;
  v_key   text;
begin
  if p_tokens is null or cardinality(p_tokens) = 0 then
    return v_out;
  end if;
  foreach v_t in array p_tokens[1:50] loop
    select s.* into v_share from public.file_shares s where s.token = v_t;
    if not found then
      continue;
    end if;
    v_ci := public._file_share_card(v_share);
    if v_ci.card_id is null then
      continue;
    end if;
    v_file := public._file_share_file(v_share.workspace_id, v_ci);
    if v_file is null or v_file->>'kind' = 'doc' then
      continue;
    end if;
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

-- ── 8. The owner dialog speaks view | edit for a doc ────────────────────────

create or replace function public.get_file_share_settings(p_board uuid, p_card text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_share public.file_shares;
  v_kind  text;
begin
  if auth.uid() is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  select ci.kind into v_kind from public.card_index ci where ci.board_id = p_board and ci.card_id = p_card;
  v_share := public._file_share_find(p_board, p_card);
  if v_share.id is null then
    return jsonb_build_object('exists', false, 'kind', v_kind);
  end if;
  return jsonb_build_object(
    'exists', true,
    'kind', v_kind,
    'token', v_share.token,
    'link_access', case when v_kind = 'doc' and v_share.link_access <> 'none' and v_share.link_can_edit
                        then 'edit' else v_share.link_access end,
    'allow_download', v_share.allow_download,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', p.email,
               'role', case when v_kind = 'doc' and p.can_edit then 'edit' else p.role end,
               'pending', p.user_id is null,
               'name', nullif(btrim(pr.display_name), ''),
               'avatar_url', pr.avatar_url
             ) order by p.created_at, p.email)
        from public.file_share_people p
        left join public.profiles pr on pr.user_id = p.user_id
       where p.share_id = v_share.id and p.revoked_at is null), '[]'::jsonb),
    'comment_count', (select count(*) from public.file_comments c
                       where c.share_id = v_share.id and c.deleted_at is null)
  );
end;
$$;

-- Create a card's share or change its link and download settings. A doc's
-- link is none | view | edit (stored as view with link_can_edit).
create or replace function public.set_file_share(p_board uuid, p_card text, p_link_access text, p_allow_download boolean)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_link text := coalesce(p_link_access, 'none');
  v_ws   uuid;
  v_ci   public.card_index;
  v_file jsonb;
  v_doc  boolean;
  v_edit boolean := false;
begin
  if v_uid is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  select b.workspace_id into v_ws from public.boards b where b.id = p_board and b.deleted_at is null;
  if v_ws is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  select ci.* into v_ci from public.card_index ci where ci.board_id = p_board and ci.card_id = p_card;
  if not found then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  v_file := public._file_share_file(v_ws, v_ci);
  if v_file is null then
    raise exception 'this file cannot be shared' using errcode = '22023', hint = 'not_shareable';
  end if;
  v_doc := v_file->>'kind' = 'doc';
  if v_doc then
    if v_link not in ('none', 'view', 'edit') then
      raise exception 'link access must be none, view or edit' using errcode = '22023';
    end if;
    v_edit := v_link = 'edit';
    if v_edit then
      v_link := 'view';
    end if;
  elsif v_link not in ('none', 'view', 'comment') then
    raise exception 'link access must be none, view or comment' using errcode = '22023';
  end if;
  if not v_doc and coalesce((v_file->>'risky')::boolean, false) and v_link <> 'none' and public._account_is_new() then
    raise exception 'new accounts cannot share this kind of file by link yet'
      using errcode = '42501', hint = 'new_account_risky';
  end if;

  perform public._file_share_find(p_board, p_card);
  insert into public.file_shares as f
         (workspace_id, board_id, card_id, link_access, link_can_edit, link_set_by, allow_download, created_by)
  values (v_ws, p_board, p_card, v_link, v_edit,
          case when v_link <> 'none' then v_uid end,
          coalesce(p_allow_download, true), v_uid)
  on conflict (board_id, card_id) do update
     set link_access = excluded.link_access,
         link_can_edit = excluded.link_can_edit,
         link_set_by = case when excluded.link_access <> 'none' then v_uid else f.link_set_by end,
         allow_download = coalesce(p_allow_download, f.allow_download),
         updated_at = now();

  return public.get_file_share_settings(p_board, p_card);
end;
$$;

-- Add people by email. A doc's role is view | edit (stored as view with
-- can_edit); a file's is view | comment. Otherwise the 0422 definition.
create or replace function public.add_file_share_people(p_board uuid, p_card text, p_emails text[], p_role text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_share    public.file_shares;
  v_self     text;
  v_e        text;
  v_norm     text;
  v_strip    text := ' ' || chr(9) || chr(10) || chr(13) || '"''<>';
  v_row      public.file_share_people;
  v_target   uuid;
  v_added    text[] := '{}';
  v_skipped  text[] := '{}';
  v_kind     text;
  v_role     text;
  v_can_edit boolean := false;
begin
  if v_uid is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  select ci.kind into v_kind from public.card_index ci where ci.board_id = p_board and ci.card_id = p_card;
  if v_kind = 'doc' then
    if p_role is null or p_role not in ('view', 'edit') then
      raise exception 'role must be view or edit' using errcode = '22023';
    end if;
    v_role := 'view';
    v_can_edit := p_role = 'edit';
  else
    if p_role is null or p_role not in ('view', 'comment') then
      raise exception 'role must be view or comment' using errcode = '22023';
    end if;
    v_role := p_role;
  end if;
  if p_emails is null or cardinality(p_emails) < 1 then
    raise exception 'add at least one email' using errcode = '22023';
  end if;
  if cardinality(p_emails) > 20 then
    raise exception 'at most 20 people at a time' using errcode = '22023';
  end if;

  -- set_file_share validates the card; only called when there is no share
  -- yet, so adding people never rewrites who opened the link.
  v_share := public._file_share_find(p_board, p_card);
  if v_share.id is null then
    perform public.set_file_share(p_board, p_card, 'none', null);
    v_share := public._file_share_find(p_board, p_card);
  end if;
  if v_share.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;

  -- Tells the email trigger an un-revoke here is a real (re-)invitation, not
  -- the undo of a removal.
  perform set_config('app.file_share_invite', 'on', true);
  select lower(u.email) into v_self from auth.users u where u.id = v_uid;

  foreach v_e in array p_emails loop
    v_norm := btrim(coalesce(v_e, ''), v_strip);
    v_norm := regexp_replace(v_norm, '^mailto:', '', 'i');
    v_norm := lower(btrim(v_norm, v_strip));
    if v_norm !~ '^[^@\s"''<>(),;:\[\]]+@[^@\s"''<>(),;:\[\]]+\.[^@\s"''<>(),;:\[\]]+$'
       or char_length(v_norm) > 320 or v_norm = v_self then
      v_skipped := v_skipped || coalesce(v_e, '');
      continue;
    end if;
    if v_norm = any (v_added) then
      continue;
    end if;
    select p.* into v_row
      from public.file_share_people p
     where p.share_id = v_share.id and p.email = v_norm
       for update;
    if found and v_row.revoked_at is null then
      update public.file_share_people p set role = v_role, can_edit = v_can_edit
       where p.share_id = v_share.id and p.email = v_norm;
      v_added := v_added || v_norm;
      continue;
    end if;
    perform public._invite_budget_take();
    select u.id into v_target
      from auth.users u
     where lower(u.email) = v_norm and u.email_confirmed_at is not null
     limit 1;
    insert into public.file_share_people as p (share_id, email, user_id, role, can_edit, invited_by)
    values (v_share.id, v_norm, v_target, v_role, v_can_edit, v_uid)
    on conflict (share_id, email) do update
       set revoked_at = null,
           user_id = coalesce(excluded.user_id, p.user_id),
           role = excluded.role,
           can_edit = excluded.can_edit,
           invited_by = excluded.invited_by;
    v_added := v_added || v_norm;
  end loop;

  return public.get_file_share_settings(p_board, p_card)
         || jsonb_build_object('added', to_jsonb(v_added), 'skipped', to_jsonb(v_skipped));
end;
$$;

-- Change a person's role, or remove them (p_role null). A role on a removed
-- person brings them back: that is the undo toast, and it sends no email.
-- A doc's roles are view | edit.
create or replace function public.set_file_share_person(p_board uuid, p_card text, p_email text, p_role text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_share    public.file_shares;
  v_norm     text := lower(btrim(coalesce(p_email, '')));
  v_kind     text;
  v_role     text := p_role;
  v_can_edit boolean := false;
begin
  if auth.uid() is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  select ci.kind into v_kind from public.card_index ci where ci.board_id = p_board and ci.card_id = p_card;
  if p_role is not null then
    if v_kind = 'doc' then
      if p_role not in ('view', 'edit') then
        raise exception 'role must be view or edit' using errcode = '22023';
      end if;
      v_role := 'view';
      v_can_edit := p_role = 'edit';
    elsif p_role not in ('view', 'comment') then
      raise exception 'role must be view or comment' using errcode = '22023';
    end if;
  end if;
  v_share := public._file_share_find(p_board, p_card);
  if v_share.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  if p_role is null then
    update public.file_share_people p
       set revoked_at = now()
     where p.share_id = v_share.id and p.email = v_norm and p.revoked_at is null;
  else
    update public.file_share_people p
       set role = v_role, can_edit = v_can_edit, revoked_at = null
     where p.share_id = v_share.id and p.email = v_norm;
    if not found then
      raise exception 'that person is not on this file' using errcode = 'P0002';
    end if;
  end if;
  return public.get_file_share_settings(p_board, p_card);
end;
$$;

-- What you've shared: a doc's link reads 'edit' when it lets people edit.
-- Otherwise the 0424 definition.
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
      'link_access', case when v_file->>'kind' = 'doc' and v_f.link_access <> 'none' and v_f.link_can_edit
                          then 'edit' else v_f.link_access end,
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

-- ── 9. A doc's comments live in the doc ─────────────────────────────────────

create or replace function public.add_file_comment(p_token uuid, p_body text, p_at_ms integer default null,
                                                   p_page integer default null, p_reply_to uuid default null)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_body      text := btrim(coalesce(p_body, ''));
  v_r         jsonb;
  v_share_id  uuid;
  v_kind      text;
  v_n_burst   integer;
  v_n_day     integer;
  v_id        uuid;
begin
  if v_uid is null then
    raise exception 'sign in to comment' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'your account cannot comment' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'a comment is 1 to 2000 characters' using errcode = '22023';
  end if;
  v_r := public._file_share_resolve(p_token);
  if v_r is null then
    raise exception 'that file is gone' using errcode = 'P0002';
  end if;
  v_kind := v_r->'file'->>'kind';
  if v_kind = 'doc' then
    raise exception 'comments on a doc are made in the doc' using errcode = '22023';
  end if;
  if coalesce(v_r->>'access', 'none') not in ('comment', 'manage') then
    raise exception 'you cannot comment on this file' using errcode = '42501';
  end if;
  v_share_id := (v_r->>'share_id')::uuid;

  perform pg_advisory_xact_lock(hashtext('file_comment:' || v_uid::text));
  select count(*) filter (where c.created_at > now() - interval '10 minutes'),
         count(*)
    into v_n_burst, v_n_day
    from public.file_comments c
   where c.author = v_uid and c.created_at > now() - interval '1 day';
  if v_n_burst >= 20 or v_n_day >= 300 then
    raise exception 'too many comments: wait a few minutes'
      using errcode = 'P0001', hint = 'comment_rate_limited';
  end if;

  if p_reply_to is not null and not exists (
       select 1 from public.file_comments c
        where c.id = p_reply_to and c.share_id = v_share_id
          and c.deleted_at is null and c.reply_to is null) then
    raise exception 'that comment is gone' using errcode = 'P0002';
  end if;

  insert into public.file_comments (share_id, author, body, at_ms, page, version_key, reply_to)
  values (v_share_id, v_uid, v_body,
          case when p_reply_to is null and v_kind in ('video', 'audio')
                    and p_at_ms between 0 and 864000000 then p_at_ms end,
          case when p_reply_to is null and v_kind = 'pdf'
                    and p_page between 1 and 100000 then p_page end,
          v_r->'file'->>'src',
          p_reply_to)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.get_file_comments(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_r      jsonb;
  v_access text;
  v_manage boolean;
  v_src    text;
  v_rows   jsonb;
begin
  v_r := public._file_share_resolve(p_token);
  if v_r is null then
    return jsonb_build_object('status', 'gone');
  end if;
  v_access := v_r->>'access';
  if v_access = 'none' then
    return jsonb_build_object('status', case when v_uid is null then 'sign_in' else 'no_access' end);
  end if;
  if public._file_share_rank(v_access) < 2 or v_r->'file'->>'kind' = 'doc' then
    return jsonb_build_object('status', 'ok', 'access', v_access, 'comments', '[]'::jsonb);
  end if;
  v_manage := v_access = 'manage';
  v_src := v_r->'file'->>'src';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'body', case when c.deleted_at is null then c.body end,
           'deleted', c.deleted_at is not null,
           'at_ms', c.at_ms,
           'page', c.page,
           'reply_to', c.reply_to,
           'resolved', c.resolved_at is not null,
           'created_at', c.created_at,
           'edited_at', c.edited_at,
           'on_current', c.version_key is null or c.version_key = v_src,
           'mine', v_uid is not null and c.author = v_uid,
           'author', jsonb_build_object('name', coalesce(nullif(btrim(pr.display_name), ''), 'Someone'),
                                        'avatar_url', pr.avatar_url,
                                        'color', pr.color),
           'can_delete', c.deleted_at is null and v_uid is not null and (c.author = v_uid or v_manage),
           'can_resolve', v_manage and c.reply_to is null
         ) order by c.created_at, c.id), '[]'::jsonb)
    into v_rows
    from (select x.*
            from public.file_comments x
           where x.share_id = (v_r->>'share_id')::uuid
             and (x.deleted_at is null
                  or exists (select 1 from public.file_comments r
                              where r.reply_to = x.id and r.deleted_at is null))
           order by x.created_at, x.id
           limit 2000) c
    left join public.profiles pr on pr.user_id = c.author;

  return jsonb_build_object('status', 'ok', 'access', v_access, 'comments', v_rows);
end;
$$;

-- ── 10. What the doc's room asks, as the caller ─────────────────────────────

-- p_room '<share id>.<edit|view>.<generation>'; p_token the share's token when
-- the person came by its link. → { status: ok | sign_in | no_access | gone |
-- moved | view_only, access, variant, card_key, share_id, user_id, name }.
-- 'moved': the room is an old generation (a restore or a move): read
-- get_file_share again for the new one.
create or replace function public.doc_room_access(p_room text, p_token uuid default null)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_m     text[];
  v_share public.file_shares;
  v_r     jsonb;
  v_acc   text;
  v_name  text;
begin
  v_m := regexp_match(coalesce(p_room, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(edit|view)\.([0-9a-f]{12})$');
  if v_m is null then
    return jsonb_build_object('status', 'gone');
  end if;
  select s.* into v_share from public.file_shares s where s.id = v_m[1]::uuid;
  if not found then
    return jsonb_build_object('status', 'gone');
  end if;
  v_r := public._file_share_resolve(v_share.token);
  if v_r is null or v_r->'file'->>'kind' is distinct from 'doc' then
    return jsonb_build_object('status', 'gone');
  end if;
  v_acc := public._doc_share_access(v_share, p_token is not null and p_token = v_share.token);
  if v_acc = 'none' then
    return jsonb_build_object('status', case when v_uid is null then 'sign_in' else 'no_access' end);
  end if;
  if public._doc_room_gen(v_share.board_id, v_share.card_id) <> v_m[3] then
    return jsonb_build_object('status', 'moved');
  end if;
  if v_m[2] = 'edit' and (v_uid is null or v_acc not in ('edit', 'manage')) then
    return jsonb_build_object('status', case when v_uid is null then 'sign_in' else 'view_only' end);
  end if;
  if v_uid is not null then
    select coalesce(nullif(btrim(pr.display_name), ''), 'Guest') into v_name
      from public.profiles pr where pr.user_id = v_uid;
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'access', v_acc,
    'variant', v_m[2],
    'card_key', v_share.card_id,
    'share_id', v_share.id,
    'user_id', v_uid,
    'name', case when v_uid is null then null else coalesce(v_name, 'Guest') end
  );
end;
$$;

-- ── 11. The room's own questions (service role only) ────────────────────────

-- Where the room's doc lives: its cluster and card, and the generation.
create or replace function public._doc_room_target(p_share uuid)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  v_share public.file_shares;
begin
  select s.* into v_share from public.file_shares s where s.id = p_share;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'board_id', v_share.board_id,
    'card_id', v_share.card_id,
    'workspace_id', v_share.workspace_id,
    'gen', public._doc_room_gen(v_share.board_id, v_share.card_id));
end;
$$;

-- Who may still be in the room. p_subjects: [{ key, user_id|null, token_ok }]
-- → { gone, gen, access: { key: manage | edit | view | none | gone } }. Each
-- subject is asked as themselves: the claims are theirs for the question.
create or replace function public._doc_room_recheck(p_share uuid, p_subjects jsonb)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_share  public.file_shares;
  v_out    jsonb := '{}'::jsonb;
  v_s      jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
  v_r      jsonb;
  v_acc    text;
begin
  select s.* into v_share from public.file_shares s where s.id = p_share;
  if not found then
    return jsonb_build_object('gone', true, 'access', '{}'::jsonb);
  end if;
  for v_s in select x from jsonb_array_elements(coalesce(p_subjects, '[]'::jsonb)) x loop
    if nullif(v_s->>'user_id', '') is null then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform set_config('request.jwt.claim.sub', '', true);
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_s->>'user_id', 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_s->>'user_id', true);
    end if;
    v_r := public._file_share_resolve(v_share.token);
    if v_r is null or v_r->'file'->>'kind' is distinct from 'doc' then
      v_acc := 'gone';
    else
      v_acc := public._doc_share_access(v_share, coalesce((v_s->>'token_ok')::boolean, false));
    end if;
    v_out := v_out || jsonb_build_object(coalesce(v_s->>'key', ''), v_acc);
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return jsonb_build_object(
    'gone', false,
    'gen', public._doc_room_gen(v_share.board_id, v_share.card_id),
    'access', v_out);
end;
$$;

-- ── 12. The invitation names a doc and the edit role ────────────────────────

create or replace function public._tg_file_share_person_email()
returns trigger
language plpgsql security definer
set search_path = '' as $$
declare
  v_share     public.file_shares;
  v_ci        public.card_index;
  v_file      jsonb;
  v_name      text;
  v_sharer_id uuid;
  v_sharer    text;
  v_role      text;
begin
  if new.revoked_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and not (old.revoked_at is not null
              and coalesce(current_setting('app.file_share_invite', true), '') = 'on') then
    return new;
  end if;
  select s.* into v_share from public.file_shares s where s.id = new.share_id;
  if not found then
    return new;
  end if;
  select ci.* into v_ci from public.card_index ci
   where ci.board_id = v_share.board_id and ci.card_id = v_share.card_id;
  if found then
    v_file := public._file_share_file(v_share.workspace_id, v_ci);
  end if;
  v_name := coalesce(v_file->>'name', 'a file');
  v_role := case when new.can_edit then 'edit' else new.role end;
  v_sharer_id := coalesce(new.invited_by, v_share.created_by);
  select u.email into v_sharer from auth.users u where u.id = v_sharer_id;
  v_sharer := coalesce(v_sharer, 'Someone on Clusters');

  if new.user_id is not null and new.user_id is distinct from v_sharer_id then
    insert into public.notifications (user_id, kind, actor_id, title, data)
    values (new.user_id, 'file.shared', v_sharer_id,
            left(v_sharer || ' shared “' || v_name || '” with you', 200),
            jsonb_build_object('token', v_share.token, 'file_name', v_name, 'role', v_role,
                               'kind', coalesce(v_file->>'kind', 'file')));
  end if;

  perform public._notify_email('file_shared', new.email, jsonb_build_object(
    'sharerName', v_sharer, 'fileName', v_name, 'role', v_role, 'kind', coalesce(v_file->>'kind', 'file'),
    'token', v_share.token::text,
    'origin', coalesce((select value #>> '{}' from public.app_config where key = 'file_share_link_origin'),
                       'https://clusters.soleilpictures.com')));
  return new;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

-- create or replace keeps each function's ACL; these restate it.
revoke execute on function public._file_share_rank(text) from public, anon, authenticated;
revoke execute on function public._file_share_file(uuid, public.card_index) from public, anon, authenticated;
revoke execute on function public._doc_share_access(public.file_shares, boolean) from public, anon, authenticated;
revoke execute on function public._doc_room_gen(uuid, text) from public, anon, authenticated;
revoke execute on function public._file_share_resolve(uuid) from public, anon, authenticated;
revoke execute on function public._file_share_keys(uuid) from public, anon, authenticated;
revoke execute on function public._file_share_poster_keys(uuid[]) from public, anon, authenticated;
revoke execute on function public._doc_room_target(uuid) from public, anon, authenticated;
revoke execute on function public._doc_room_recheck(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._tg_file_share_person_email() from public, anon, authenticated;
grant execute on function public._file_share_keys(uuid) to service_role;
grant execute on function public._file_share_poster_keys(uuid[]) to service_role;
grant execute on function public._doc_room_target(uuid) to service_role;
grant execute on function public._doc_room_recheck(uuid, jsonb) to service_role;

-- Signed out too: a view link opens without an account.
revoke all on function public.get_file_share(uuid) from public;
grant execute on function public.get_file_share(uuid) to anon, authenticated, service_role;
revoke all on function public.get_file_comments(uuid) from public;
grant execute on function public.get_file_comments(uuid) to anon, authenticated, service_role;
revoke all on function public.doc_room_access(text, uuid) from public;
grant execute on function public.doc_room_access(text, uuid) to anon, authenticated, service_role;

-- Signed in only.
revoke all on function public.get_file_share_posters(uuid[]) from public, anon;
revoke all on function public.get_file_share_settings(uuid, text) from public, anon;
revoke all on function public.set_file_share(uuid, text, text, boolean) from public, anon;
revoke all on function public.add_file_share_people(uuid, text, text[], text) from public, anon;
revoke all on function public.set_file_share_person(uuid, text, text, text) from public, anon;
revoke all on function public.list_my_file_shares(integer) from public, anon;
revoke all on function public.add_file_comment(uuid, text, integer, integer, uuid) from public, anon;
grant execute on function public.get_file_share_posters(uuid[]) to authenticated, service_role;
grant execute on function public.get_file_share_settings(uuid, text) to authenticated, service_role;
grant execute on function public.set_file_share(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.add_file_share_people(uuid, text, text[], text) to authenticated, service_role;
grant execute on function public.set_file_share_person(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.list_my_file_shares(integer) to authenticated, service_role;
grant execute on function public.add_file_comment(uuid, text, integer, integer, uuid) to authenticated, service_role;

-- ── Proof (0311 habit: a REVOKE reporting success proves nothing) ───────────

do $$
declare
  v_sig text;
  v_src text;
begin
  foreach v_sig in array array[
    'public._file_share_rank(text)',
    'public._file_share_file(uuid, public.card_index)',
    'public._doc_share_access(public.file_shares, boolean)',
    'public._doc_room_gen(uuid, text)',
    'public._file_share_resolve(uuid)',
    'public._file_share_keys(uuid)',
    'public._file_share_poster_keys(uuid[])',
    'public._doc_room_target(uuid)',
    'public._doc_room_recheck(uuid, jsonb)',
    'public._tg_file_share_person_email()'
  ] loop
    if has_function_privilege('public', v_sig, 'execute')
       or has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0426: % is client-callable', v_sig;
    end if;
    if not (select p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
              from pg_proc p where p.oid = v_sig::regprocedure) then
      raise exception '0426: % is not security definer with an empty search_path', v_sig;
    end if;
  end loop;
  foreach v_sig in array array[
    'public._file_share_keys(uuid)', 'public._file_share_poster_keys(uuid[])',
    'public._doc_room_target(uuid)', 'public._doc_room_recheck(uuid, jsonb)'
  ] loop
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception '0426: the party cannot call %', v_sig;
    end if;
  end loop;

  foreach v_sig in array array['public.get_file_share(uuid)', 'public.get_file_comments(uuid)', 'public.doc_room_access(text, uuid)'] loop
    if not has_function_privilege('anon', v_sig, 'execute')
       or not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0426: % lost its grants', v_sig;
    end if;
  end loop;
  foreach v_sig in array array[
    'public.get_file_share_posters(uuid[])', 'public.get_file_share_settings(uuid, text)',
    'public.set_file_share(uuid, text, text, boolean)', 'public.add_file_share_people(uuid, text, text[], text)',
    'public.set_file_share_person(uuid, text, text, text)', 'public.list_my_file_shares(integer)',
    'public.add_file_comment(uuid, text, integer, integer, uuid)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0426: % is callable signed out', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0426: % is not callable by a signed-in user', v_sig;
    end if;
    if not (select p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
              from pg_proc p where p.oid = v_sig::regprocedure) then
      raise exception '0426: % is not security definer with an empty search_path', v_sig;
    end if;
  end loop;

  -- No answer a browser can get carries storage keys.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.get_file_share(uuid)'::regprocedure;
  if position('''keys''' in v_src) > 0 or position('v_file->''src''' in v_src) > 0 then
    raise exception '0426: get_file_share still answers storage keys';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.get_file_share_posters(uuid[])'::regprocedure;
  if position('jsonb_build_object(v_t::text, true)' in v_src) = 0 or position('v_file->>''src''' in v_src) > 0 then
    raise exception '0426: get_file_share_posters still answers storage keys';
  end if;
  -- The media access rule is the one 0422 made (gen-docs reads its 72 hours).
  select p.prosrc into v_src from pg_proc p where p.oid = 'public._file_share_access(public.file_shares, boolean)'::regprocedure;
  if position('interval ''72 hours''' in v_src) = 0 then
    raise exception '0426: _file_share_access changed';
  end if;
  -- The link counts for a doc only when it was presented.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public._doc_share_access(public.file_shares, boolean)'::regprocedure;
  if position('coalesce(p_token_ok, false) and p_share.link_access <> ''none''' in v_src) = 0
     or position('p_share.link_can_edit and v_uid is not null' in v_src) = 0 then
    raise exception '0426: _doc_share_access lost the link rule';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'file_share_people' and column_name = 'can_edit')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'file_shares' and column_name = 'link_can_edit') then
    raise exception '0426: the edit columns are missing';
  end if;
end $$;
