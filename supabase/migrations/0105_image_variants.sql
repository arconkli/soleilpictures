-- 0105_image_variants.sql — progressive image loading metadata + write RPC.
--
-- Boards previously stored ONLY the full-resolution original for each image
-- (R2 key <ws>/<uuid>.<ext>). Opening an image-heavy board therefore meant
-- downloading every multi-MB original before anything appeared. This adds the
-- metadata needed for a three-tier progressive load:
--   Tier 0  blur_hash    — base64 ThumbHash, decoded client-side to an instant
--                          blurred placeholder (zero image bytes).
--   Tier 1  preview_path — R2 key of a downscaled WebP (the canvas shows this).
--   Tier 2  (the original storage_path) — used by the lightbox / zoom-in.
--
-- The preview is stored at a deterministic key <ws>/previews/<uuid>.webp and
-- gets its OWN images row (so /sign-reads + get_share_bundle authorize it via
-- the existing RLS). Like board thumbnails, a preview is never referenced by a
-- card, so its ref_count stays 0 — it MUST be retention-locked or the daily R2
-- orphan sweep (find_history_safe_orphan_images) deletes it after 30 days.

alter table public.images
  add column if not exists blur_hash    text,     -- base64-encoded ThumbHash of the original (Tier 0)
  add column if not exists preview_path text,      -- R2 key of the Tier-1 WebP preview, or NULL until generated
  add column if not exists preview_w    integer,
  add column if not exists preview_h    integer;

-- No new index: every read path looks images up BY storage_path (already
-- unique-indexed via images_storage_path_key, migration 0092). blur_hash /
-- preview_path are projected columns on rows we already fetch by key, never
-- filtered on.

-- public.images has NO update policy (only SELECT/INSERT/DELETE), so a writer
-- client cannot stamp these columns onto the original row directly. This
-- SECURITY DEFINER RPC is the single write path. One atomic call:
--   (a) authorize the caller as a writer of the ORIGINAL image's scope, using
--       the SAME expression as the images insert/delete policy;
--   (b) upsert the preview row (retention-locked far-future, ref_count 0) so
--       /sign-reads will hand out a URL for the preview key;
--   (c) stamp blur_hash/preview_path/preview_{w,h} on the ORIGINAL row.
-- COALESCE means a partial call (blur-only, or preview-only) never clobbers the
-- other field. Idempotent: re-running just re-stamps identical values.
create or replace function public.set_image_variant(
  p_storage_path text,             -- ORIGINAL image key (the card's r2:<key> minus prefix)
  p_blur         text default null, -- base64 thumbhash, or NULL to leave unchanged
  p_preview_path text default null, -- preview R2 key (<ws>/previews/<uuid>.webp), or NULL
  p_preview_w    integer default null,
  p_preview_h    integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_img public.images%rowtype;
begin
  select * into v_img from public.images where storage_path = p_storage_path;
  if not found then
    raise exception 'set_image_variant: unknown storage_path %', p_storage_path
      using errcode = 'no_data_found';
  end if;

  -- (a) Authorize against the ORIGINAL image's scope (mirrors images insert/delete policy).
  if not (
    can_write_workspace(v_img.workspace_id)
    or (v_img.board_id is not null and can_write_board(v_img.board_id))
  ) then
    raise exception 'set_image_variant: not authorized for %', p_storage_path
      using errcode = 'insufficient_privilege';
  end if;

  -- (b) Upsert the preview row so /sign-reads authorizes the preview key.
  --     ref_count stays 0; the retention lock keeps the orphan sweep off it.
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

  -- (c) Stamp the ORIGINAL row. COALESCE preserves any field not in this call.
  update public.images set
    blur_hash    = coalesce(p_blur,         blur_hash),
    preview_path = coalesce(p_preview_path, preview_path),
    preview_w    = coalesce(p_preview_w,    preview_w),
    preview_h    = coalesce(p_preview_h,    preview_h)
  where storage_path = p_storage_path;
end;
$$;

revoke all on function public.set_image_variant(text, text, text, integer, integer) from public, anon;
grant execute on function public.set_image_variant(text, text, text, integer, integer) to authenticated;
