-- 0128_images_rls_and_share_bundle.sql
--
-- Fixes the user-visible half of the "locked image" bug: images that are IN a
-- board you can access but stay locked for non-workspace-members.
--
-- Root cause: image read authorization was scoped to a single images.board_id
-- (stamped once at upload). But image cards get moved/copied to OTHER boards
-- (cross-board drag, paste) without updating board_id, so an image referenced on
-- board B but stamped board_id = A was denied to anyone who isn't a workspace
-- member (board-share collaborators, public /share viewers). Workspace members
-- were unaffected (is_workspace_member short-circuits), which is why owners never
-- saw it but shared/public viewers did.
--
-- Migration 0127 made images.referenced_in_board_ids an always-fresh, server-
-- maintained list of the live boards each image is referenced on. This migration
-- uses it as the authorization source of truth:
--   1. images SELECT RLS also grants read when the viewer can read ANY board the
--      image is actually referenced on. This transparently fixes the
--      authenticated sign-reads + metadata paths with NO client/worker change.
--   2. get_share_bundle gathers the public viewer's presign keys by what's
--      referenced on the viewed board (board_id OR referenced_in_board_ids),
--      plus each original's preview_path, instead of only board_id = target.
--
-- Safety: images has no UPDATE policy for authenticated/anon — only the
-- SECURITY DEFINER recompute (0127) writes referenced_in_board_ids, derived from
-- board content. A user can only get a board into the array by actually placing
-- the image's card on a board they can write. The new RLS branch is ordered LAST
-- so workspace members (the common case) never pay the unnest/can_read_board cost.

-- ── 1. Broaden the images read policy. ──
drop policy if exists "images read" on public.images;
create policy "images read" on public.images for select
  using (
    is_workspace_member(workspace_id)
    or (board_id is not null and can_read_board(board_id))
    or exists (
      select 1
      from unnest(referenced_in_board_ids) as b(bid)
      where can_read_board(b.bid)
    )
  );

-- ── 2. get_share_bundle: presign keys referenced on the viewed board, not just
--       board_id = target. Signature unchanged so CREATE OR REPLACE swaps in. ──
create or replace function get_share_bundle(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_root_id uuid;
  v_include boolean;
  v_target uuid;
  v_board record;
  v_snapshot text;
  v_image_keys text[];
  v_image_meta json;
  v_nav json;
begin
  -- Resolve the link (active / not revoked / not expired).
  select l.board_id, l.include_subboards into v_root_id, v_include
  from public_share_links l
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());
  if v_root_id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  v_target := coalesce(p_board_id, v_root_id);

  -- Authorize a non-root target: link must share sub-boards AND target must be a
  -- descendant of the root (walk UP from the target).
  if v_target <> v_root_id then
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
      select 1 from chain where id = v_root_id
    ) then
      raise exception 'board is not part of this shared link' using errcode = 'P0002';
    end if;
  end if;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board
  from boards b where b.id = v_target;
  if v_board.id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  select doc into v_snapshot from board_state where board_id = v_target;

  -- Keys to presign: every image actually referenced on the VIEWED board
  -- (its original storage_path AND its preview variant), regardless of where the
  -- image's own board_id points. referenced_in_board_ids is maintained by
  -- migration 0127 from the live board_state.
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_image_keys
  from (
    select storage_path as k from images
     where storage_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_path as k from images
     where preview_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
  ) s;

  -- Per-original metadata (blur + preview) for progressive loading.
  select coalesce(
           jsonb_object_agg(storage_path, jsonb_build_object('blur', blur_hash, 'preview', preview_path)),
           '{}'::jsonb
         )::json
    into v_image_meta
  from images
  where storage_path is not null
    and (board_id = v_target or v_target = any(referenced_in_board_ids))
    and (blur_hash is not null or preview_path is not null);

  -- Navigable boards reachable via this link.
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
$$;
revoke all on function get_share_bundle(uuid, uuid) from public;
grant execute on function get_share_bundle(uuid, uuid) to anon, authenticated;
