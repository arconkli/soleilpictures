-- 0663_file_views_design_archive.sql
--
-- A picture of every design file and archive too.
--
-- No browser shows a Sketch, Figma, XD, Procreate, Krita, OpenRaster,
-- Affinity, InDesign, Illustrator or EPS file (lib/fileView.js DESIGN_EXTS),
-- or what is inside a .zip, so their cards showed only an icon. The converter
-- (media/ on Fly) now makes a design file's picture from the one saved inside
-- it, and an archive's contact sheet, into the same view and small view a
-- photo gets (0661), which become the original's preview when it has none.
--
-- They wait in file_views as kind 'design' and 'archive'. file_views.kind is
-- a pattern, not a list (0661), so only _file_view_request changes: it takes
-- the two kinds. No size ceiling is set here, for any kind, as before: the
-- converter holds them (a design file is downloaded whole up to the photos'
-- ceiling, lib/fileView.js VIEW_MAX_BYTES; a zip-based one and an archive are
-- read by byte ranges within the converter's own fetch budget). The
-- has_preview shortcut stays for every kind, as 0662 left it: a file that
-- already has a preview needs no view. _file_view_finish needs nothing new:
-- a design file's or an archive's view is recorded as a photo's is, and only
-- a document has a PDF.
--
-- Same signature, so create or replace keeps the function's grants; they are
-- proven again at the end (the 0311 habit).

-- As 0662's, taking a design file ('design') and an archive ('archive') too.
create or replace function public._file_view_request(
  p_storage_path text, p_kind text, p_requested_by uuid default null, p_force boolean default false
)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_img public.images%rowtype;
  v_state text;
begin
  if p_kind is null or p_kind not in ('image', 'doc', 'design', 'archive') then return 'not_view'; end if;
  if p_storage_path like '%/previews/%' then return 'not_view'; end if;
  select * into v_img from public.images where storage_path = p_storage_path and deleted_at is null;
  if not found then return 'not_found'; end if;
  select f.state into v_state from public.file_views f where f.storage_path = p_storage_path;
  if v_state is null and v_img.preview_path is not null then return 'has_preview'; end if;

  insert into public.file_views as f (storage_path, workspace_id, board_id, kind, requested_by)
  values (p_storage_path, v_img.workspace_id, v_img.board_id, p_kind, p_requested_by)
  on conflict (storage_path) do update
     set state = 'queued', attempts = 0, lease_until = null, reason = null, error = null,
         finished_at = null, updated_at = now()
   where p_force and f.state in ('done', 'failed')
  returning f.state into v_state;

  if v_state is null then
    select f.state into v_state from public.file_views f where f.storage_path = p_storage_path;
  end if;
  return v_state;
end;
$function$;

revoke execute on function public._file_view_request(text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public._file_view_request(text, text, uuid, boolean) to service_role;

-- The 0311 habit: prove the grants, don't trust them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._file_view_request(text,text,uuid,boolean)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0663: % is client-callable', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0663: the service role cannot call %', f;
    end if;
  end loop;
end $$;
