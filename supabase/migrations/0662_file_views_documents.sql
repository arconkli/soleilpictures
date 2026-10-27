-- 0662_file_views_documents.sql
--
-- A picture of every document too.
--
-- No browser shows a Word, PowerPoint, Excel, Keynote, Pages, Numbers or
-- OpenDocument file (lib/fileView.js DOC_EXTS), so their cards showed only an
-- icon. The converter (media/ on Fly) now reads one with LibreOffice and makes
-- a view of its first page, as it does of a photo, and a PDF of its pages for
-- Quick look:
--
--   <ws>/<name>.<ext>  →  <ws>/previews/<name>.<ext>.view.webp | .view_sm.webp
--                         <ws>/previews/<name>.<ext>.view.pdf
--
-- They wait in file_views (0661) as kind 'doc'. Two columns record the PDF
-- and its number of pages; _file_view_request takes 'doc', and
-- _file_view_finish gives the PDF its own images row beside the first page's
-- (same workspace, cluster and uploader as the original, retention-locked, no
-- size, as the views have). The first page becomes the original's preview
-- when it has none, as a photo's view does, so every surface that shows
-- previews shows it. The PDF is no preview: Quick look reads its key from the
-- row, which a member can read for a file they can read (0661's policy).
-- /sign-reads signs it for the same members, since its images row has the
-- original's workspace and cluster. The R2 sweep deletes an original's
-- previews with it, and forgetPlayCopies (worker-playCopy.js) deletes the
-- PDF's row too, whose tombstone queues the object.
--
-- Same signatures, so create or replace keeps each function's grants; they
-- are proven again at the end (the 0311 habit).

alter table public.file_views add column if not exists view_pdf_path text;
alter table public.file_views add column if not exists page_count integer;

-- As 0661's, taking a document ('doc') as well as a photo ('image').
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
  if p_kind is null or p_kind not in ('image', 'doc') then return 'not_view'; end if;
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

-- As 0661's, and a document's PDF: its key derived here like the views',
-- recorded only when the converter says it made one (the Worker has checked
-- it is in the bucket).
create or replace function public._file_view_finish(p_storage_path text, p_state text, p_result jsonb default '{}'::jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_job public.file_views%rowtype;
  v_img public.images%rowtype;
  v_base text;
  v_view text;
  v_sm text;
  v_pdf text;
  v_num_re constant text := '^[0-9]{1,9}$';
  v_view_w integer;
  v_view_h integer;
  v_sm_w integer;
  v_sm_h integer;
  v_w integer;
  v_h integer;
  v_pages integer;
begin
  if p_state is null or p_state not in ('done', 'skip', 'failed') then
    raise exception '_file_view_finish: bad state %', p_state using errcode = '22023';
  end if;
  select * into v_job from public.file_views where storage_path = p_storage_path for update;
  if not found then return 'not_found'; end if;
  if v_job.state <> 'working' then return v_job.state; end if;
  select * into v_img from public.images where storage_path = p_storage_path;

  v_view_w := case when coalesce(p_result #>> '{view,w}', '') ~ v_num_re then (p_result #>> '{view,w}')::integer end;
  v_view_h := case when coalesce(p_result #>> '{view,h}', '') ~ v_num_re then (p_result #>> '{view,h}')::integer end;
  v_sm_w := case when coalesce(p_result #>> '{viewSm,w}', '') ~ v_num_re then (p_result #>> '{viewSm,w}')::integer end;
  v_sm_h := case when coalesce(p_result #>> '{viewSm,h}', '') ~ v_num_re then (p_result #>> '{viewSm,h}')::integer end;
  v_w := case when coalesce(p_result #>> '{original,w}', '') ~ v_num_re then (p_result #>> '{original,w}')::integer end;
  v_h := case when coalesce(p_result #>> '{original,h}', '') ~ v_num_re then (p_result #>> '{original,h}')::integer end;
  v_pages := case when coalesce(p_result #>> '{pdf,pages}', '') ~ '^[0-9]{1,6}$' then (p_result #>> '{pdf,pages}')::integer end;

  if p_state = 'done' then
    -- <dir>/previews/<name with its extension>, as lib/fileView.js viewKeys.
    v_base := regexp_replace(p_storage_path, '^(.*/)?([^/]+)$', '\1previews/\2');
    v_view := v_base || '.view.webp';
    if jsonb_typeof(p_result -> 'viewSm') = 'object' then
      v_sm := v_base || '.view_sm.webp';
    end if;
    if v_job.kind = 'doc' and v_pages > 0 then
      v_pdf := v_base || '.view.pdf';
    end if;
    insert into public.images (workspace_id, board_id, storage_path, width, height, uploaded_by, retention_locked_until)
    values (v_img.workspace_id, v_img.board_id, v_view, v_view_w, v_view_h, v_img.uploaded_by, timestamptz '2999-01-01')
    on conflict (storage_path) do nothing;
    if v_sm is not null then
      insert into public.images (workspace_id, board_id, storage_path, width, height, uploaded_by, retention_locked_until)
      values (v_img.workspace_id, v_img.board_id, v_sm, v_sm_w, v_sm_h, v_img.uploaded_by, timestamptz '2999-01-01')
      on conflict (storage_path) do nothing;
    end if;
    if v_pdf is not null then
      insert into public.images (workspace_id, board_id, storage_path, uploaded_by, retention_locked_until)
      values (v_img.workspace_id, v_img.board_id, v_pdf, v_img.uploaded_by, timestamptz '2999-01-01')
      on conflict (storage_path) do nothing;
    end if;
    update public.images i
       set preview_path = v_view, preview_w = v_view_w, preview_h = v_view_h,
           preview_sm_path = v_sm,
           preview_sm_w = case when v_sm is not null then v_sm_w end,
           preview_sm_h = case when v_sm is not null then v_sm_h end
     where i.storage_path = p_storage_path and i.preview_path is null;
    update public.images i
       set width = case when i.width > 0 and i.height > 0 then i.width else coalesce(v_w, i.width) end,
           height = case when i.width > 0 and i.height > 0 then i.height else coalesce(v_h, i.height) end,
           variants_checked_at = coalesce(i.variants_checked_at, now())
     where i.storage_path = p_storage_path;
  end if;

  update public.file_views f
     set state = p_state, lease_until = null, finished_at = now(), updated_at = now(),
         probe = case when jsonb_typeof(p_result -> 'probe') = 'object' then p_result -> 'probe' end,
         reason = case when p_state <> 'done' then coalesce(left(nullif(p_result ->> 'reason', ''), 40), 'error') end,
         error = left(nullif(p_result ->> 'error', ''), 300),
         view_path = v_view,
         view_w = case when v_view is not null then v_view_w end,
         view_h = case when v_view is not null then v_view_h end,
         view_sm_path = v_sm,
         view_sm_w = case when v_sm is not null then v_sm_w end,
         view_sm_h = case when v_sm is not null then v_sm_h end,
         view_pdf_path = v_pdf,
         page_count = case when v_pdf is not null then v_pages end,
         width = v_w, height = v_h
   where f.storage_path = p_storage_path;
  return p_state;
end;
$function$;

revoke execute on function public._file_view_request(text, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._file_view_finish(text, text, jsonb) from public, anon, authenticated;
grant execute on function public._file_view_request(text, text, uuid, boolean) to service_role;
grant execute on function public._file_view_finish(text, text, jsonb) to service_role;

-- The 0311 habit: prove the grants, don't trust them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._file_view_request(text,text,uuid,boolean)',
    'public._file_view_finish(text,text,jsonb)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0662: % is client-callable', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0662: the service role cannot call %', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.file_views', 'INSERT')
     or has_table_privilege('authenticated', 'public.file_views', 'UPDATE')
     or has_table_privilege('anon', 'public.file_views', 'SELECT')
     or not has_column_privilege('authenticated', 'public.file_views', 'view_pdf_path', 'SELECT')
     or not has_column_privilege('authenticated', 'public.file_views', 'page_count', 'SELECT') then
    raise exception '0662: file_views table grants are wrong';
  end if;
end $$;
