-- 0131 — right-sized (DPR-down) image preview variant.
--
-- Adds a ~640px webp "sm" preview alongside the existing 1280px preview so small
-- / zoomed-out cards can fetch ~3-4× fewer bytes on first paint (the renderer
-- offers a <img srcset> and lets the browser pick). Additive + nullable: every
-- existing image stays 1280-only and is untouched (the renderer just omits the
-- srcset when there's no sm variant — no regression).
--
-- NOTE: applied to prod via the Supabase MCP (the local CLI targets the wrong
-- account). This file is the committed record; prod is the source of truth.

ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS preview_sm_path text,
  ADD COLUMN IF NOT EXISTS preview_sm_w integer,
  ADD COLUMN IF NOT EXISTS preview_sm_h integer;

-- set_image_variant gains 3 nullable sm params. Adding params changes the
-- signature, so the old 5-arg version is DROPPED first — otherwise both coexist
-- as overloads and a named-arg RPC call becomes ambiguous ("function is not
-- unique"). Grants are re-applied to match the prior state (authenticated +
-- service_role; PUBLIC revoked; anon revoked in 0131b).
DROP FUNCTION IF EXISTS public.set_image_variant(text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.set_image_variant(
  p_storage_path text,
  p_blur text DEFAULT NULL::text,
  p_preview_path text DEFAULT NULL::text,
  p_preview_w integer DEFAULT NULL::integer,
  p_preview_h integer DEFAULT NULL::integer,
  p_preview_sm_path text DEFAULT NULL::text,
  p_preview_sm_w integer DEFAULT NULL::integer,
  p_preview_sm_h integer DEFAULT NULL::integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_img public.images%rowtype;
begin
  select * into v_img from public.images where storage_path = p_storage_path;
  if not found then
    raise exception 'set_image_variant: unknown storage_path %', p_storage_path
      using errcode = 'no_data_found';
  end if;
  if not (
    can_write_workspace(v_img.workspace_id)
    or (v_img.board_id is not null and can_write_board(v_img.board_id))
  ) then
    raise exception 'set_image_variant: not authorized for %', p_storage_path
      using errcode = 'insufficient_privilege';
  end if;
  -- Each preview key gets its own images row (retention-locked) so /sign-reads
  -- and the share bundle can authorize + sign it.
  if p_preview_path is not null then
    insert into public.images (
      workspace_id, board_id, storage_path, width, height,
      uploaded_by, retention_locked_until
    ) values (
      v_img.workspace_id, v_img.board_id, p_preview_path, p_preview_w, p_preview_h,
      auth.uid(), timestamptz '2999-01-01'
    )
    on conflict (storage_path) do nothing;
  end if;
  if p_preview_sm_path is not null then
    insert into public.images (
      workspace_id, board_id, storage_path, width, height,
      uploaded_by, retention_locked_until
    ) values (
      v_img.workspace_id, v_img.board_id, p_preview_sm_path, p_preview_sm_w, p_preview_sm_h,
      auth.uid(), timestamptz '2999-01-01'
    )
    on conflict (storage_path) do nothing;
  end if;
  update public.images set
    blur_hash       = coalesce(p_blur,           blur_hash),
    preview_path    = coalesce(p_preview_path,    preview_path),
    preview_w       = coalesce(p_preview_w,       preview_w),
    preview_h       = coalesce(p_preview_h,       preview_h),
    preview_sm_path = coalesce(p_preview_sm_path, preview_sm_path),
    preview_sm_w    = coalesce(p_preview_sm_w,    preview_sm_w),
    preview_sm_h    = coalesce(p_preview_sm_h,    preview_sm_h)
  where storage_path = p_storage_path;
end;
$function$;

REVOKE ALL ON FUNCTION public.set_image_variant(text,text,text,integer,integer,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_image_variant(text,text,text,integer,integer,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_image_variant(text,text,text,integer,integer,text,integer,integer) TO service_role;

-- get_share_bundle: signature unchanged (CREATE OR REPLACE preserves grants).
-- Adds preview_sm_path to the signable image_keys union (the party auto-signs
-- every key — NO party redeploy) and the sm fields + preview w/h to image_meta
-- so the public /share viewer can build the same srcset.
CREATE OR REPLACE FUNCTION public.get_share_bundle(p_token uuid, p_board_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select l.board_id, l.include_subboards into v_root_id, v_include
  from public_share_links l
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());
  if v_root_id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  v_target := coalesce(p_board_id, v_root_id);

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
