-- 0106_share_bundle_image_meta.sql — progressive image loading for /share.
--
-- Public board viewers had no blur/preview metadata, so shared boards still
-- loaded full-resolution originals. get_share_bundle now also returns an
-- `image_meta` map (original storage_path → { blur, preview }) so the anon
-- viewer can render the Tier-0 blur + pick the Tier-1 preview, exactly like a
-- signed-in user. The preview KEYS need no extra plumbing: set_image_variant
-- stamps the preview row with the same board_id as its original, so the
-- existing `image_keys` aggregation (board_id = target) already includes them
-- and the upload party already presigns them.
--
-- Signature is unchanged (uuid, uuid) so CREATE OR REPLACE swaps it in place.

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

  -- Authorize a non-root target: the link must share sub-boards AND the
  -- target must be a descendant of the root (walk UP from the target).
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
  -- Keys to presign: every image row on the target board (originals AND their
  -- preview variants, which carry the same board_id).
  select coalesce(array_agg(storage_path), '{}'::text[]) into v_image_keys
  from images where board_id = v_target and storage_path is not null;

  -- Per-original metadata for progressive loading. Only originals have
  -- blur_hash/preview_path set (preview rows leave them null), so this maps
  -- original key → { blur, preview }.
  select coalesce(
           jsonb_object_agg(storage_path, jsonb_build_object('blur', blur_hash, 'preview', preview_path)),
           '{}'::jsonb
         )::json
    into v_image_meta
  from images
  where board_id = v_target
    and storage_path is not null
    and (blur_hash is not null or preview_path is not null);

  -- Navigable boards reachable via this link. Sub-boards off → just the
  -- root. On → root + all non-deleted descendants (walk DOWN).
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
