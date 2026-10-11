-- 0402 — Image variants reach a terminal state (audit PERF-04).
--
-- The client's variant backfill (previewBackfill.js) treated only a non-null
-- preview_path as "done". An image of 1280px or less that is not byte-heavy
-- never gets a preview, by design (the original already serves as Tier-1),
-- so every writer session re-downloaded it, re-decoded it, recomputed the
-- blur and called set_image_variant again, forever.
--
-- images.variants_checked_at records that variant generation finished for a
-- row and there is nothing more to make. set_image_variant stamps it when the
-- call is complete: a preview was recorded, or the original is small enough
-- (<= 1280 on its long edge, uploads.js PREVIEW_LONGEST_EDGE) to be its own
-- preview. A large image whose preview failed is deliberately NOT stamped, so
-- it still self-heals on a later open.
--
-- Client compatibility: imageMeta.js reads the column when it exists and
-- falls back to the old column list when it does not, and previewBackfill.js
-- also applies the same <= 1280 rule from width/height, so neither apply order
-- breaks anything. Signature unchanged, so create or replace keeps the ACL;
-- the block at the end proves it (the 0311 habit).
--
-- Integrator: re-diff the function body against the live
-- pg_get_functiondef before applying; this file re-emits 0131's body.

begin;

alter table public.images
  add column if not exists variants_checked_at timestamptz;

comment on column public.images.variants_checked_at is
  'Set by set_image_variant once variant generation has nothing more to make (a preview exists, or the original is <= 1280px). The client backfill skips stamped rows.';

create or replace function public.set_image_variant(
  p_storage_path text,
  p_blur text default null::text,
  p_preview_path text default null::text,
  p_preview_w integer default null::integer,
  p_preview_h integer default null::integer,
  p_preview_sm_path text default null::text,
  p_preview_sm_w integer default null::integer,
  p_preview_sm_h integer default null::integer
)
returns void
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
    preview_sm_h    = coalesce(p_preview_sm_h,    preview_sm_h),
    variants_checked_at = case
      when coalesce(p_preview_path, preview_path) is not null
        or greatest(width, height) <= 1280
      then coalesce(variants_checked_at, now())
      else variants_checked_at
    end
  where storage_path = p_storage_path;
end;
$function$;

-- The rows that already finished: a blur and either a preview or a small
-- original. Retention-locked preview rows (their own storage_path is a
-- preview) are left alone; nothing reads their meta.
update public.images
   set variants_checked_at = now()
 where variants_checked_at is null
   and blur_hash is not null
   and (preview_path is not null or greatest(width, height) <= 1280);

do $$
declare f text := 'public.set_image_variant(text,text,text,integer,integer,text,integer,integer)';
begin
  if has_function_privilege('anon', f, 'execute')
     or has_function_privilege('public', f, 'execute')
     or not has_function_privilege('authenticated', f, 'execute')
     or not has_function_privilege('service_role', f, 'execute') then
    raise exception '0402: grants are wrong on %', f;
  end if;
end $$;

commit;
