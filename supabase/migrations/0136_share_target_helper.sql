-- 0136: single-source share-link validation (_resolve_share_target).
--
-- get_share_bundle (0131) and get_share_meta (0132/0135) each carried a
-- VERBATIM copy of the same token-resolution + sub-board-authorization block.
-- They were required to stay "in lockstep" by hand — and had already drifted in
-- prod (get_share_meta grew a `public_slug` field for the /c/<slug> SEO pages
-- that never made it into a local migration). Extract the shared gate into one
-- SECURITY DEFINER helper so the two can never again diverge on what a
-- (token, board) pair is allowed to reveal.
--
-- Also closes a correctness gap surfaced by the public-viewer audit: the target
-- board must not be soft-deleted. A deleted board previously stayed publicly
-- viewable through an un-revoked link (both RPCs only checked existence). The
-- helper now raises P0002 for a soft-deleted target.
--
-- Verified against live data before apply: for every active link the refactored
-- functions return byte-identical JSON to the old ones (image_keys compared as a
-- sorted set; public_slug preserved), and bad-token / deleted-board both raise
-- P0002 from both RPCs.
--
-- Grants: CREATE OR REPLACE preserves the existing anon/authenticated/
-- service_role EXECUTE grants on both RPCs, so they are intentionally NOT
-- re-stated here. The helper is internal-only — it is reached solely through
-- the two SECURITY DEFINER callers, which run as the function owner and so can
-- execute it regardless of the caller's grant. We revoke it from public AND
-- from anon/authenticated explicitly, because Supabase's default privileges on
-- schema `public` auto-grant EXECUTE to those roles on every new function.

create or replace function public._resolve_share_target(p_token uuid, p_board_id uuid default null)
returns table(root_id uuid, target_id uuid, include_subboards boolean, allow_indexing boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_root    uuid;
  v_include boolean;
  v_allow   boolean;
  v_target  uuid;
begin
  -- Resolve the link (active / not revoked / not expired).
  select l.board_id, l.include_subboards, l.allow_indexing
    into v_root, v_include, v_allow
  from public_share_links l
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());
  if v_root is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  v_target := coalesce(p_board_id, v_root);

  -- Authorize a non-root target: the link must share sub-boards AND the target
  -- must be a descendant of the root (walk UP from the target).
  if v_target <> v_root then
    if not coalesce(v_include, false) then
      raise exception 'sub-boards are not shared by this link' using errcode = 'P0002';
    end if;
    if not exists (
      with recursive chain as (
        select id, parent_board_id from boards where id = v_target
        union all
        select b.id, b.parent_board_id
        from boards b join chain c on b.id = c.parent_board_id
      )
      select 1 from chain where id = v_root
    ) then
      raise exception 'board is not part of this shared link' using errcode = 'P0002';
    end if;
  end if;

  -- Target must exist and not be soft-deleted.
  if not exists (select 1 from boards b where b.id = v_target and b.deleted_at is null) then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  return query select v_root, v_target, coalesce(v_include, false), coalesce(v_allow, false);
end;
$function$;

revoke all on function public._resolve_share_target(uuid, uuid) from public;
revoke execute on function public._resolve_share_target(uuid, uuid) from anon, authenticated;

-- get_share_bundle: validation now delegated to _resolve_share_target; body
-- below the resolve is byte-for-byte the live 0131 definition.
create or replace function public.get_share_bundle(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_root_id    uuid;
  v_include    boolean;
  v_target     uuid;
  v_board      record;
  v_snapshot   text;
  v_image_keys text[];
  v_image_meta json;
  v_nav        json;
begin
  select t.root_id, t.target_id, t.include_subboards
    into v_root_id, v_target, v_include
  from public._resolve_share_target(p_token, p_board_id) t;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board
  from boards b where b.id = v_target;

  select doc into v_snapshot from board_state where board_id = v_target;

  select coalesce(array_agg(distinct k), '{}'::text[]) into v_image_keys
  from (
    select storage_path as k from images
     where storage_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_path as k from images
     where preview_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_sm_path as k from images
     where preview_sm_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
  ) s;

  select coalesce(
           jsonb_object_agg(storage_path, jsonb_build_object(
             'blur', blur_hash,
             'preview', preview_path,
             'preview_w', preview_w,
             'preview_h', preview_h,
             'preview_sm', preview_sm_path,
             'preview_sm_w', preview_sm_w,
             'preview_sm_h', preview_sm_h
           )),
           '{}'::jsonb
         )::json
    into v_image_meta
  from images
  where storage_path is not null
    and (board_id = v_target or v_target = any(referenced_in_board_ids))
    and (blur_hash is not null or preview_path is not null);

  if coalesce(v_include, false) then
    select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
      into v_nav
    from (
      with recursive sub as (
        select id, name from boards where id = v_root_id
        union all
        select b.id, b.name
        from boards b join sub s on b.parent_board_id = s.id
        where b.deleted_at is null
      )
      select id, name from sub
    ) t;
  else
    select json_build_array(json_build_object('id', b.id, 'name', b.name))
      into v_nav
    from boards b where b.id = v_root_id;
  end if;

  return json_build_object(
    'board', json_build_object(
      'id', v_board.id,
      'name', v_board.name,
      'view', v_board.view,
      'cover', v_board.cover,
      'bg_color', v_board.bg_color
    ),
    'snapshot', v_snapshot,
    'image_keys', v_image_keys,
    'image_meta', v_image_meta,
    'role', 'viewer',
    'root_id', v_root_id,
    'include_subboards', coalesce(v_include, false),
    'nav_boards', v_nav
  );
end;
$function$;

-- get_share_meta: validation delegated to _resolve_share_target; body below the
-- resolve matches the live definition, INCLUDING the public_slug cross-link that
-- had drifted out of the migration files.
create or replace function public.get_share_meta(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_root_id uuid;
  v_target  uuid;
  v_allow   boolean;
  v_board   record;
  v_slug    text;
begin
  select t.root_id, t.target_id, t.allow_indexing
    into v_root_id, v_target, v_allow
  from public._resolve_share_target(p_token, p_board_id) t;

  select b.id, b.name, b.thumb_key, b.thumb_updated_at, b.thumb_version into v_board
  from boards b where b.id = v_target;

  select pb.slug into v_slug
  from public_boards pb
  where pb.board_id = v_target and pb.published_at is not null;

  return json_build_object(
    'board_id', v_board.id,
    'root_id', v_root_id,
    'name', v_board.name,
    'thumb_key', v_board.thumb_key,
    'thumb_updated_at', v_board.thumb_updated_at,
    'thumb_version', v_board.thumb_version,
    'allow_indexing', coalesce(v_allow, false),
    'public_slug', v_slug
  );
end;
$function$;
