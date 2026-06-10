-- 0132: get_share_meta — lightweight share-link metadata for OG link previews.
--
-- The soleil-boards Worker injects per-board Open Graph tags into the HTML it
-- serves for /share/<token> (board name + a thumbnail og:image served from R2
-- via /api/share-thumb/<token>). get_share_bundle is far too heavy for that —
-- it returns the full Y.Doc snapshot plus every image key on the board — so
-- this function answers the one question the edge needs: "what board does this
-- token resolve to, and does it have a stored thumbnail?"
--
-- IMPORTANT: the token-validation + sub-board-authorization logic here is a
-- verbatim copy of get_share_bundle's (migration 0128). The two must stay in
-- lockstep — anything this function reveals (board name, thumbnail) must be
-- exactly what the bundle would reveal for the same (token, board) pair.

create or replace function get_share_meta(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_root_id uuid;
  v_include boolean;
  v_target uuid;
  v_board record;
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

  select b.id, b.name, b.thumb_key, b.thumb_updated_at into v_board
  from boards b where b.id = v_target;
  if v_board.id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  return json_build_object(
    'board_id', v_board.id,
    'root_id', v_root_id,
    'name', v_board.name,
    'thumb_key', v_board.thumb_key,
    'thumb_updated_at', v_board.thumb_updated_at
  );
end;
$$;

revoke all on function get_share_meta(uuid, uuid) from public;
grant execute on function get_share_meta(uuid, uuid) to anon, authenticated;
