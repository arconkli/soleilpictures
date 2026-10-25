-- 0661_file_views.sql
--
-- A picture of every photo, whatever its format.
--
-- Only Safari draws HEIC, TIFF and JPEG XL, and no browser draws OpenEXR, so
-- a card holding one said "Preview not available" nearly everywhere. The
-- converter that makes playable copies (0660, media/ on Fly) now also makes a
-- VIEW of such a file: a WebP at up to 2048 on its long side, and one at 640.
-- lib/fileView.js holds the rules and the names:
--
--   <ws>/<name>.<ext>  →  <ws>/previews/<name>.<ext>.view.webp | .view_sm.webp
--
-- file_views is the queue and the record, one row per original, as
-- media_copies is for copies. It is a table of its own because widening
-- media_copies' kind check takes a DROP, which the MCP won't apply. The
-- Worker (worker-playCopy.js) drives it with the service role; the converter
-- never touches the database.
--
-- A finished view is recorded where every surface already looks for a
-- preview. Each key gets its own images row (same workspace, cluster and
-- uploader as its original, retention-locked, no size), as set_image_variant
-- gives a browser-made preview, and the original's preview_path and
-- preview_sm_path point at them when it has none: a preview a browser made
-- (Safari draws HEIC) is never replaced. The original's width and height are
-- filled in when the browser couldn't read them at upload, and
-- variants_checked_at is stamped, so the preview backfill leaves the file
-- alone. /sign-reads, the share bundles and the R2 sweep (which deletes an
-- original's preview_path and preview_sm_path with it) need nothing new. The
-- views' rows go with their original (forgetPlayCopies), and a workspace's
-- deletion cascades all of it. Nothing in here removes rows or objects.
--
-- Members read their files' rows (a card waiting on its view asks how it is
-- getting on); nobody but the service role writes them.

create table if not exists public.file_views (
  storage_path  text primary key references public.images (storage_path) on delete cascade,
  workspace_id  uuid not null,
  board_id      uuid,
  -- The Worker's (lib/fileView.js viewKindOfKey): 'image' today. A pattern,
  -- not a list, so a later kind needs no DROP of a check.
  kind          text not null check (kind ~ '^[a-z]{1,16}$'),
  state         text not null default 'queued' check (state in ('queued', 'working', 'done', 'skip', 'failed')),
  attempts      smallint not null default 0,
  lease_until   timestamptz,
  -- Why no view: too_large | unsupported | has_preview | error. Null otherwise.
  reason        text,
  -- The converter's last error, trimmed, with no URLs in it.
  error         text,
  -- What the converter read: the decoder, the size, the bands. No tags.
  probe         jsonb,
  view_path     text,
  view_w        integer,
  view_h        integer,
  view_sm_path  text,
  view_sm_w     integer,
  view_sm_h     integer,
  -- The original's size, upright.
  width         integer,
  height        integer,
  requested_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists file_views_queue
  on public.file_views (created_at) where state in ('queued', 'working');

alter table public.file_views enable row level security;
revoke all on table public.file_views from public, anon, authenticated;
grant select on table public.file_views to authenticated;

-- A member sees the row for a file they can see. The subquery runs under
-- images' own read policy, so this is exactly "can read the original".
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'file_views' and policyname = 'file_views read') then
    create policy "file_views read" on public.file_views
      for select to authenticated
      using (exists (select 1 from public.images i where i.storage_path = file_views.storage_path));
  end if;
end $$;

-- Ask for a view. Idempotent: one row per original, and asking again returns
-- how it is getting on. A file that already has a preview (a browser made
-- one) and was never queued answers 'has_preview' and queues nothing.
-- p_force re-queues a finished job (the Worker passes it when a 'done' view's
-- object turns out to be gone). The workspace and the cluster come from the
-- original's row, never from the caller.
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
  if p_kind is null or p_kind <> 'image' then return 'not_view'; end if;
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

-- Hand the converter the oldest job: queued, or working with a lease that ran
-- out. A file a browser made a preview of while it waited is skipped first
-- (Safari draws HEIC, and its upload makes its own); a preview that is this
-- file's own view, re-queued because its object went missing, is not.
-- Three tries, then it is failed for good.
create or replace function public._file_view_claim(p_lease_seconds integer default 900)
 returns table (storage_path text, kind text, size_bytes bigint, attempts smallint)
 language plpgsql
 security definer
 set search_path to ''
as $function$
#variable_conflict use_column
begin
  update public.file_views f
     set state = 'skip', reason = 'has_preview', finished_at = now(), updated_at = now()
    from public.images i
   where i.storage_path = f.storage_path and f.state = 'queued' and i.preview_path is not null
     and i.preview_path not like '%.view.webp';

  update public.file_views
     set state = 'failed', reason = 'error', lease_until = null, finished_at = now(), updated_at = now(),
         error = coalesce(error, 'the converter stopped before finishing, three times')
   where state = 'working' and lease_until < now() and attempts >= 3;

  return query
  with nxt as (
    select f.storage_path
      from public.file_views f
     where (f.state = 'queued' or (f.state = 'working' and f.lease_until < now()))
       and f.attempts < 3
     order by f.created_at
     limit 1
     for update skip locked
  ), upd as (
    update public.file_views f
       set state = 'working', attempts = f.attempts + 1, updated_at = now(),
           lease_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600)))
      from nxt
     where f.storage_path = nxt.storage_path
    returning f.storage_path, f.kind, f.attempts
  )
  select u.storage_path, u.kind, i.size_bytes, u.attempts
    from upd u
    left join public.images i on i.storage_path = u.storage_path;
end;
$function$;

-- The converter is still on it: push the lease out. False when the job is no
-- longer this lease's.
create or replace function public._file_view_heartbeat(p_storage_path text, p_lease_seconds integer default 900)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  update public.file_views f
     set lease_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600))),
         updated_at = now()
   where f.storage_path = p_storage_path and f.state = 'working' and f.lease_until > now();
  return found;
end;
$function$;

-- Record what the converter made. Only a running job finishes; a late or
-- repeated finish returns the state it already has and changes nothing. The
-- views' keys are derived here from the original's, never taken from the
-- caller, so a finish can only ever name the original's own views.
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
  v_num_re constant text := '^[0-9]{1,9}$';
  v_view_w integer;
  v_view_h integer;
  v_sm_w integer;
  v_sm_h integer;
  v_w integer;
  v_h integer;
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

  if p_state = 'done' then
    -- <dir>/previews/<name with its extension>, as lib/fileView.js viewKeys.
    v_base := regexp_replace(p_storage_path, '^(.*/)?([^/]+)$', '\1previews/\2');
    v_view := v_base || '.view.webp';
    if jsonb_typeof(p_result -> 'viewSm') = 'object' then
      v_sm := v_base || '.view_sm.webp';
    end if;
    insert into public.images (workspace_id, board_id, storage_path, width, height, uploaded_by, retention_locked_until)
    values (v_img.workspace_id, v_img.board_id, v_view, v_view_w, v_view_h, v_img.uploaded_by, timestamptz '2999-01-01')
    on conflict (storage_path) do nothing;
    if v_sm is not null then
      insert into public.images (workspace_id, board_id, storage_path, width, height, uploaded_by, retention_locked_until)
      values (v_img.workspace_id, v_img.board_id, v_sm, v_sm_w, v_sm_h, v_img.uploaded_by, timestamptz '2999-01-01')
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
         width = v_w, height = v_h
   where f.storage_path = p_storage_path;
  return p_state;
end;
$function$;

-- Is there work? The minute cron wakes the converter when there is.
create or replace function public._file_view_due()
 returns integer
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select count(*)::integer
    from public.file_views f
   where (f.state = 'queued' or (f.state = 'working' and f.lease_until < now()))
     and f.attempts < 3;
$function$;

revoke execute on function public._file_view_request(text, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._file_view_claim(integer) from public, anon, authenticated;
revoke execute on function public._file_view_heartbeat(text, integer) from public, anon, authenticated;
revoke execute on function public._file_view_finish(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._file_view_due() from public, anon, authenticated;
grant execute on function public._file_view_request(text, text, uuid, boolean) to service_role;
grant execute on function public._file_view_claim(integer) to service_role;
grant execute on function public._file_view_heartbeat(text, integer) to service_role;
grant execute on function public._file_view_finish(text, text, jsonb) to service_role;
grant execute on function public._file_view_due() to service_role;

-- The 0311 habit: prove the grants, don't trust them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._file_view_request(text,text,uuid,boolean)',
    'public._file_view_claim(integer)',
    'public._file_view_heartbeat(text,integer)',
    'public._file_view_finish(text,text,jsonb)',
    'public._file_view_due()'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0661: % is client-callable', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0661: the service role cannot call %', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.file_views', 'INSERT')
     or has_table_privilege('authenticated', 'public.file_views', 'UPDATE')
     or has_table_privilege('authenticated', 'public.file_views', 'DELETE')
     or has_table_privilege('anon', 'public.file_views', 'SELECT')
     or has_table_privilege('anon', 'public.file_views', 'INSERT')
     or not has_table_privilege('authenticated', 'public.file_views', 'SELECT') then
    raise exception '0661: file_views table grants are wrong';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.file_views'::regclass) then
    raise exception '0661: file_views has RLS off';
  end if;
  if exists (select 1 from pg_publication_tables
              where schemaname = 'public' and tablename = 'file_views') then
    raise exception '0661: file_views is in a realtime publication';
  end if;
end $$;
