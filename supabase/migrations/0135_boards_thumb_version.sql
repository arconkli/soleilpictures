-- 0135: boards.thumb_version — version-gate stored board thumbnails.
--
-- The thumbnail renderer was reworked (RENDER_VERSION 2 in
-- boards/src/lib/renderThumbnail.js) from an abstract transparent render
-- into a faithful opaque mini-screenshot of the canvas. Existing R2 thumbs
-- are v1 output; this column lets clients tell the difference so tiles
-- keep displaying a stale thumb while regenerating it in the background
-- (useThumbnailBackfill / yboard.js stamp thumb_version on upload).
-- null = legacy v1 render.

alter table boards add column if not exists thumb_version int;

-- get_share_meta additionally returns thumb_version so the share worker can
-- emit the right og:image dimensions (v2 = 1200×675, v1 = 800×600).
-- Body otherwise identical to the live definition (incl. 0134's
-- allow_indexing) — validation stays in lockstep with get_share_bundle.
create or replace function get_share_meta(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_root_id uuid;
  v_include boolean;
  v_allow boolean;
  v_target uuid;
  v_board record;
begin
  -- Resolve the link (active / not revoked / not expired).
  select l.board_id, l.include_subboards, l.allow_indexing
    into v_root_id, v_include, v_allow
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

  select b.id, b.name, b.thumb_key, b.thumb_updated_at, b.thumb_version into v_board
  from boards b where b.id = v_target;
  if v_board.id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  return json_build_object(
    'board_id', v_board.id,
    'root_id', v_root_id,
    'name', v_board.name,
    'thumb_key', v_board.thumb_key,
    'thumb_updated_at', v_board.thumb_updated_at,
    'thumb_version', v_board.thumb_version,
    'allow_indexing', coalesce(v_allow, false)
  );
end;
$$;

revoke all on function get_share_meta(uuid, uuid) from public;
grant execute on function get_share_meta(uuid, uuid) to anon, authenticated;
