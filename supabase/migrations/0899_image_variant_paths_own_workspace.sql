-- 0899: set_image_variant only records preview keys that sit in the picture's
-- own workspace's previews folder.
--
-- The images insert policy (0427, given preview_xs_path by 0898) lets a row
-- name only keys under its own workspace. set_image_variant is SECURITY
-- DEFINER, so its inserts and its update run past that policy: a writer of one
-- workspace could record any key, another workspace's original included, as a
-- preview of their own picture, and the share bundles (get_share_bundle,
-- get_public_board_bundle, mcp_draft_keep_view) would then sign it for anyone
-- holding their link. Every preview key the app (lib/uploads.js), the upload
-- route (party/upload.ts isValidPreviewKey), the backfill and the converter
-- record has the form <workspace>/previews/<name>, with no further slash; on
-- 15 Nov 2026 every recorded preview key matched, so nothing in use is
-- refused. Anything else is now refused before a row is written.
--
-- Same signature and body as 0898, plus the check. Grants are restated and
-- proved (the 0311 habit).

-- ── part 1 ──

create or replace function public.set_image_variant(
  p_storage_path text,
  p_blur text default null,
  p_preview_path text default null,
  p_preview_w integer default null,
  p_preview_h integer default null,
  p_preview_sm_path text default null,
  p_preview_sm_w integer default null,
  p_preview_sm_h integer default null,
  p_preview_xs_path text default null,
  p_preview_xs_w integer default null,
  p_preview_xs_h integer default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  -- Each preview key must be <this picture's workspace>/previews/<name>: no
  -- other workspace, no original, no deeper folder. coalesce: a row with no
  -- workspace refuses every key rather than letting a null comparison pass.
  if exists (
    select 1
      from unnest(array[p_preview_path, p_preview_sm_path, p_preview_xs_path]) as k
     where k is not null
       and not coalesce(
         k ~ ('^' || v_img.workspace_id::text || '/previews/[A-Za-z0-9_-][A-Za-z0-9_.-]*$'),
         false)
  ) then
    raise exception 'set_image_variant: preview keys must be in the previews folder of %', v_img.workspace_id
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
  if p_preview_xs_path is not null then
    insert into public.images (
      workspace_id, board_id, storage_path, width, height,
      uploaded_by, retention_locked_until
    ) values (
      v_img.workspace_id, v_img.board_id, p_preview_xs_path, p_preview_xs_w, p_preview_xs_h,
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
    preview_sm_h    = coalesce(p_preview_sm_h,    preview_sm_h),
    preview_xs_path = coalesce(p_preview_xs_path, preview_xs_path),
    preview_xs_w    = coalesce(p_preview_xs_w,    preview_xs_w),
    preview_xs_h    = coalesce(p_preview_xs_h,    preview_xs_h),
    variants_checked_at = case
      when coalesce(p_preview_path, preview_path) is not null
        or greatest(width, height) <= 1280
      then coalesce(variants_checked_at, now())
      else variants_checked_at
    end
  where storage_path = p_storage_path;
end;
$function$;

revoke all on function public.set_image_variant(text,text,text,integer,integer,text,integer,integer,text,integer,integer) from public, anon;
grant execute on function public.set_image_variant(text,text,text,integer,integer,text,integer,integer,text,integer,integer) to authenticated, service_role;

-- ── part 2 ──

do $$
declare
  v_fn regprocedure := 'public.set_image_variant(text,text,text,integer,integer,text,integer,integer,text,integer,integer)'::regprocedure;
  v_src text;
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute')
     or not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception '0899: grants are wrong on set_image_variant';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = v_fn;
  if v_src is null or v_src not like '%/previews/[A-Za-z0-9_-][A-Za-z0-9_.-]*$%' then
    raise exception '0899: set_image_variant does not check its preview keys';
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'set_image_variant') <> 1 then
    raise exception '0899: more than one set_image_variant exists';
  end if;
end $$;
