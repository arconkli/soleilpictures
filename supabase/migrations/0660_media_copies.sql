-- 0660_media_copies.sql
--
-- A copy of every video and audio file that every browser can play.
--
-- Browsers decode different formats (Chrome shows ProRes as sound with no
-- picture, Safari won't open MKV, Firefox misses HEVC), so a card holding one
-- of those played nowhere or only somewhere. The converter (media/, on Fly)
-- now makes an H.264/AAC MP4 (or AAC for sound) next to the original, and the
-- player uses it. lib/playCopy.js holds the rules and the names:
--
--   <ws>/<name>.<ext>  →  <ws>/previews/<name>.play.mp4 | .play.m4a | .poster.webp
--
-- media_copies is the queue and the record: one row per original, holding the
-- job's state and, once done, what was made. The Worker (worker-playCopy.js)
-- drives it with the service role; the converter never touches the database.
--
-- Each copy also gets its own images row, so /sign-reads and the share
-- bundles can sign it like any preview: same workspace, cluster and uploader
-- as its original, retention-locked (the orphan sweep never takes a copy on
-- its own), no size. Under previews/ it never counts toward storage
-- (_image_counts). Copies go when their original does: the R2 sweep only
-- marks an original's row, so the Worker deletes the copies' rows and the
-- record after it (worker-playCopy.js forgetPlayCopies), and the rows'
-- tombstones (images_tombstone_r2_keys) queue the objects; a workspace's
-- deletion cascades all of it. Nothing in here removes rows or objects: the
-- MCP refuses to apply that.
--
-- Members read their files' rows (the player and the editors' backfill ask how
-- a copy is getting on); nobody but the service role writes them.

create table if not exists public.media_copies (
  storage_path  text primary key references public.images (storage_path) on delete cascade,
  workspace_id  uuid not null,
  board_id      uuid,
  kind          text not null check (kind in ('video', 'audio')),
  state         text not null default 'queued' check (state in ('queued', 'working', 'done', 'skip', 'failed')),
  attempts      smallint not null default 0,
  lease_until   timestamptz,
  -- Why no copy: too_long | too_large | no_streams | error. Null otherwise.
  reason        text,
  -- The converter's last error, trimmed, with no URLs in it.
  error         text,
  -- Trimmed ffprobe output: codecs, sizes, length. No tags, no names.
  probe         jsonb,
  copy_path     text,
  copy_w        integer,
  copy_h        integer,
  copy_bytes    bigint,
  poster_path   text,
  poster_w      integer,
  poster_h      integer,
  duration_sec  double precision,
  requested_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists media_copies_queue
  on public.media_copies (created_at) where state in ('queued', 'working');

alter table public.media_copies enable row level security;
revoke all on table public.media_copies from public, anon, authenticated;
grant select on table public.media_copies to authenticated;

-- A member sees the row for a file they can see. The subquery runs under
-- images' own read policy, so this is exactly "can read the original".
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'media_copies' and policyname = 'media_copies read') then
    create policy "media_copies read" on public.media_copies
      for select to authenticated
      using (exists (select 1 from public.images i where i.storage_path = media_copies.storage_path));
  end if;
end $$;

-- Ask for a copy. Idempotent: one row per original, and asking again returns
-- how it is getting on. p_force re-queues a finished job (the Worker passes it
-- when a 'done' copy's object turns out to be gone). The workspace and the
-- cluster come from the original's row, never from the caller. The kind is the
-- Worker's (lib/playCopy.js mediaKindOfKey), checked here.
create or replace function public._media_copy_request(
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
  if p_kind is null or p_kind not in ('video', 'audio') then return 'not_media'; end if;
  if p_storage_path ~* '/previews/[^/]+\.(play\.(mp4|m4a)|poster\.webp)$' then return 'not_media'; end if;
  select * into v_img from public.images where storage_path = p_storage_path and deleted_at is null;
  if not found then return 'not_found'; end if;

  insert into public.media_copies as m (storage_path, workspace_id, board_id, kind, requested_by)
  values (p_storage_path, v_img.workspace_id, v_img.board_id, p_kind, p_requested_by)
  on conflict (storage_path) do update
     set state = 'queued', attempts = 0, lease_until = null, reason = null, error = null,
         finished_at = null, updated_at = now()
   where p_force and m.state in ('done', 'failed')
  returning m.state into v_state;

  if v_state is null then
    select m.state into v_state from public.media_copies m where m.storage_path = p_storage_path;
  end if;
  return v_state;
end;
$function$;

-- Hand the converter the oldest job: queued, or working with a lease that ran
-- out (the machine stopped mid-job). Three tries, then it is failed for good.
create or replace function public._media_copy_claim(p_lease_seconds integer default 900)
 returns table (storage_path text, kind text, size_bytes bigint, original_name text, attempts smallint)
 language plpgsql
 security definer
 set search_path to ''
as $function$
#variable_conflict use_column
begin
  update public.media_copies
     set state = 'failed', reason = 'error', lease_until = null, finished_at = now(), updated_at = now(),
         error = coalesce(error, 'the converter stopped before finishing, three times')
   where state = 'working' and lease_until < now() and attempts >= 3;

  return query
  with nxt as (
    select m.storage_path
      from public.media_copies m
     where (m.state = 'queued' or (m.state = 'working' and m.lease_until < now()))
       and m.attempts < 3
     order by m.created_at
     limit 1
     for update skip locked
  ), upd as (
    update public.media_copies m
       set state = 'working', attempts = m.attempts + 1, updated_at = now(),
           lease_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600)))
      from nxt
     where m.storage_path = nxt.storage_path
    returning m.storage_path, m.kind, m.attempts
  )
  select u.storage_path, u.kind, i.size_bytes, i.original_name, u.attempts
    from upd u
    left join public.images i on i.storage_path = u.storage_path;
end;
$function$;

-- The converter is still on it: push the lease out. False when the job is no
-- longer this lease's (it ran out and another claim took it, or it finished).
create or replace function public._media_copy_heartbeat(p_storage_path text, p_lease_seconds integer default 900)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  update public.media_copies m
     set lease_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600))),
         updated_at = now()
   where m.storage_path = p_storage_path and m.state = 'working' and m.lease_until > now();
  return found;
end;
$function$;

-- Record what the converter made. Only a running job finishes; a late or
-- repeated finish returns the state it already has and changes nothing. The
-- copies' keys are derived here from the original's, never taken from the
-- caller, so a finish can only ever name the original's own copies.
create or replace function public._media_copy_finish(p_storage_path text, p_state text, p_result jsonb default '{}'::jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_job public.media_copies%rowtype;
  v_img public.images%rowtype;
  v_base text;
  v_copy text;
  v_poster text;
  v_num_re constant text := '^[0-9]{1,9}$';
  v_copy_w integer;
  v_copy_h integer;
  v_poster_w integer;
  v_poster_h integer;
  v_bytes bigint;
  v_dur double precision;
begin
  if p_state is null or p_state not in ('done', 'skip', 'failed') then
    raise exception '_media_copy_finish: bad state %', p_state using errcode = '22023';
  end if;
  select * into v_job from public.media_copies where storage_path = p_storage_path for update;
  if not found then return 'not_found'; end if;
  if v_job.state <> 'working' then return v_job.state; end if;
  select * into v_img from public.images where storage_path = p_storage_path;

  v_copy_w := case when coalesce(p_result #>> '{copy,w}', '') ~ v_num_re then (p_result #>> '{copy,w}')::integer end;
  v_copy_h := case when coalesce(p_result #>> '{copy,h}', '') ~ v_num_re then (p_result #>> '{copy,h}')::integer end;
  v_poster_w := case when coalesce(p_result #>> '{poster,w}', '') ~ v_num_re then (p_result #>> '{poster,w}')::integer end;
  v_poster_h := case when coalesce(p_result #>> '{poster,h}', '') ~ v_num_re then (p_result #>> '{poster,h}')::integer end;
  v_bytes := case when coalesce(p_result #>> '{copy,bytes}', '') ~ '^[0-9]{1,15}$' then (p_result #>> '{copy,bytes}')::bigint end;
  v_dur := case when coalesce(p_result ->> 'durationSec', '') ~ '^[0-9]{1,7}(\.[0-9]{1,6})?$' then (p_result ->> 'durationSec')::double precision end;

  if p_state = 'done' then
    -- <dir>/previews/<name minus extension>, as lib/playCopy.js copyKeys.
    v_base := regexp_replace(p_storage_path, '^(.*/)?([^/]*?)(\.[A-Za-z0-9]{1,8})?$', '\1previews/\2');
    v_copy := v_base || case when v_job.kind = 'audio' then '.play.m4a' else '.play.mp4' end;
    if v_job.kind = 'video' and jsonb_typeof(p_result -> 'poster') = 'object' then
      v_poster := v_base || '.poster.webp';
    end if;
    insert into public.images (workspace_id, board_id, storage_path, width, height, uploaded_by, retention_locked_until)
    values (v_img.workspace_id, v_img.board_id, v_copy, v_copy_w, v_copy_h, v_img.uploaded_by, timestamptz '2999-01-01')
    on conflict (storage_path) do nothing;
    if v_poster is not null then
      insert into public.images (workspace_id, board_id, storage_path, width, height, uploaded_by, retention_locked_until)
      values (v_img.workspace_id, v_img.board_id, v_poster, v_poster_w, v_poster_h, v_img.uploaded_by, timestamptz '2999-01-01')
      on conflict (storage_path) do nothing;
    end if;
  end if;

  update public.media_copies m
     set state = p_state, lease_until = null, finished_at = now(), updated_at = now(),
         probe = case when jsonb_typeof(p_result -> 'probe') = 'object' then p_result -> 'probe' end,
         duration_sec = v_dur,
         reason = case when p_state = 'failed' then coalesce(left(nullif(p_result ->> 'reason', ''), 40), 'error') end,
         error = left(nullif(p_result ->> 'error', ''), 300),
         copy_path = v_copy, copy_w = v_copy_w, copy_h = v_copy_h, copy_bytes = v_bytes,
         poster_path = v_poster,
         poster_w = case when v_poster is not null then v_poster_w end,
         poster_h = case when v_poster is not null then v_poster_h end
   where m.storage_path = p_storage_path;
  return p_state;
end;
$function$;

-- Is there work? The minute cron wakes the converter when there is.
create or replace function public._media_copy_due()
 returns integer
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select count(*)::integer
    from public.media_copies m
   where (m.state = 'queued' or (m.state = 'working' and m.lease_until < now()))
     and m.attempts < 3;
$function$;

revoke execute on function public._media_copy_request(text, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._media_copy_claim(integer) from public, anon, authenticated;
revoke execute on function public._media_copy_heartbeat(text, integer) from public, anon, authenticated;
revoke execute on function public._media_copy_finish(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._media_copy_due() from public, anon, authenticated;
grant execute on function public._media_copy_request(text, text, uuid, boolean) to service_role;
grant execute on function public._media_copy_claim(integer) to service_role;
grant execute on function public._media_copy_heartbeat(text, integer) to service_role;
grant execute on function public._media_copy_finish(text, text, jsonb) to service_role;
grant execute on function public._media_copy_due() to service_role;

-- The 0311 habit: prove the grants, don't trust them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._media_copy_request(text,text,uuid,boolean)',
    'public._media_copy_claim(integer)',
    'public._media_copy_heartbeat(text,integer)',
    'public._media_copy_finish(text,text,jsonb)',
    'public._media_copy_due()'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0660: % is client-callable', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0660: the service role cannot call %', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.media_copies', 'INSERT')
     or has_table_privilege('authenticated', 'public.media_copies', 'UPDATE')
     or has_table_privilege('authenticated', 'public.media_copies', 'DELETE')
     or has_table_privilege('anon', 'public.media_copies', 'SELECT')
     or has_table_privilege('anon', 'public.media_copies', 'INSERT')
     or not has_table_privilege('authenticated', 'public.media_copies', 'SELECT') then
    raise exception '0660: media_copies table grants are wrong';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.media_copies'::regclass) then
    raise exception '0660: media_copies has RLS off';
  end if;
  if exists (select 1 from pg_publication_tables
              where schemaname = 'public' and tablename = 'media_copies') then
    raise exception '0660: media_copies is in a realtime publication';
  end if;
end $$;
