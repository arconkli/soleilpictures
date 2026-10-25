-- 0580_every_failure_on_record.sql
--
-- STATUS: applied 2026-10-24 through the MCP in five records,
-- every_failure_on_record_part1 … part5 (the proof is the fifth). Every
-- function body live is this file's, byte for byte.
--
-- The owner asked on 2026-10-24 to know every error and issue a user meets.
-- client_errors (0108) held what CRASHED, but almost nothing that merely
-- FAILED: a request that came back 500, a toast that said "Couldn't save", a
-- picture that never loaded, a sync that gave up. Those are written now (the
-- client's lib/errorReporting.js + errorSender.js, the Worker's and Party's
-- lib/serverErrors.js, the edge functions' _shared/reportError.ts), and this
-- migration gives the table what they carry.
--
-- (1) Columns:
--     - source, who wrote the row: client | worker | party | edge | db;
--     - severity: crash | error | warning;
--     - fingerprint, the group a row belongs to;
--     - context, a small allowlisted bag: what was being done, a request's
--       route and status, whether the browser was online;
--     - breadcrumbs, the names of the last steps taken, never what anyone typed;
--     - app_session_id, env and received_at.
-- (2) client_errors_shape, a before-insert trigger. Triggers fire in name
--     order, so it runs after client_errors_redact_links. It:
--     - clamps every text column;
--     - sanitises context and breadcrumbs (their keys are allowlisted here and
--       in lib/errorCore.js, and errorContext.test.mjs holds the two identical);
--     - stamps the fingerprint and severity;
--     - refuses floods: 300 rows per session per hour, or 60 a minute per
--       fingerprint for a row with no session.
-- (3) The insert policy also requires source = 'client', so a signed-out
--     caller cannot write a row that claims to come from a server. Rows the
--     old server writers send without a source (csp_violation, seo_health,
--     discovery_pipeline, aeo_probe) are given theirs by the trigger, which
--     also keeps a client from forging them.
-- (4) client_error_groups has one row per fingerprint:
--     - first and last seen, each with its release;
--     - all-time occurrences;
--     - a status: open | resolved | muted.
--
--     refresh_error_groups() folds new rows in every 5 minutes from a
--     received_at watermark. An upsert on every insert would queue a burst of
--     one error behind a single hot row.
--
--     A resolved group opens again (returned_at) when it turns up on a release
--     it had not been seen on before it was resolved. Today's mutes (0133)
--     carry over, and a new group whose message a mute already covers is born
--     muted.
--
-- The production client keeps working unchanged. Every new column is nullable
-- or defaulted, and an old client's row is shaped exactly like a new one's.

-- ── 1. Columns ───────────────────────────────────────────────────────────────
alter table public.client_errors
  add column if not exists source         text not null default 'client',
  add column if not exists severity       text,
  add column if not exists fingerprint    text,
  add column if not exists context        jsonb,
  add column if not exists breadcrumbs    jsonb,
  add column if not exists app_session_id uuid,
  add column if not exists env            text,
  add column if not exists received_at    timestamptz;
-- A volatile default given on ADD COLUMN rewrites the table; set it afterwards.
alter table public.client_errors alter column received_at set default now();

-- Guarded rather than replaced: the MCP's migration path refuses any body that
-- names a destructive statement, so nothing here is removed and re-added.
do $ck$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_errors_source_ck') then
    alter table public.client_errors add constraint client_errors_source_ck
      check (source in ('client', 'worker', 'party', 'edge', 'db'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_errors_severity_ck') then
    alter table public.client_errors add constraint client_errors_severity_ck
      check (severity is null or severity in ('crash', 'error', 'warning'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_errors_env_ck') then
    alter table public.client_errors add constraint client_errors_env_ck
      check (env is null or env in ('prod', 'preview', 'dev'));
  end if;
end $ck$;

-- ── 2. Helpers ───────────────────────────────────────────────────────────────

-- The grouping key: what varies between two occurrences of one failure goes.
-- _error_message_key (0133) stays exactly as it is, because the stored mutes
-- are keyed by it, and changing it would silently unmute them.
create or replace function public._error_group_key(p_message text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           regexp_replace(regexp_replace(lower(coalesce(p_message, '')),
             'https?://[^\s"''<>()]+', '<url>', 'g'),
             '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'g'),
             '"[^"]*"|“[^”]*”|‘[^’]*’|`[^`]*`|''[^'']*\s[^'']*''|''[^'']{41,}''', '<q>', 'g'),
             '\m(?=[0-9a-f]*[0-9])[0-9a-f]{8,}\M', '<hex>', 'g'),
             '[0-9]+', '<n>', 'g'),
             '\s+', ' ', 'g')), 300)
$$;

-- The top-most frame in one of our own chunks, by chunk name only. A minified
-- function name and a content hash change with every build, and a fingerprint
-- that moved with them would make every deploy look like a new failure.
create or replace function public._error_frame_key(p_stack text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select substring(coalesce(p_stack, '') from '/assets/([A-Za-z0-9_.-]+)-[A-Za-z0-9_-]{8}\.js')
$$;

create or replace function public._error_fingerprint(p_source text, p_kind text, p_message text, p_stack text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select md5(coalesce(p_source, 'client') || '|' || coalesce(p_kind, '') || '|'
             || public._error_group_key(p_message) || '|'
             || coalesce(public._error_frame_key(p_stack), ''))
$$;

-- crash: the person saw a crash screen. error: something they asked for
-- failed. warning: something degraded, or the browser complained.
create or replace function public._error_default_severity(p_kind text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_kind in ('render', 'surface') then 'crash'
    when p_kind in ('perf', 'csp_violation', 'resource', 'console', 'stuck', 'sync', 'warn',
                    'dom-mutated', 'chunk-recover', 'realtime-unavailable',
                    'seo_health', 'discovery_pipeline', 'aeo_probe') then 'warning'
    else 'error'
  end
$$;

-- One context string: link tokens and ids out, anything holding an address
-- left out, 80 characters at most.
create or replace function public._error_ctx_str(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p is null or p ~ '@' then null
    else left(regexp_replace(public._redact_link_text(p),
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', 'gi'), 80)
  end
$$;

create or replace function public._error_ctx_s(p jsonb)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case when jsonb_typeof(p) = 'string' then public._error_ctx_str(p #>> '{}') end
$$;

create or replace function public._error_ctx_int(p jsonb)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  select case when jsonb_typeof(p) = 'number'
              then least(greatest(round((p #>> '{}')::numeric), -2000000000), 2000000000)::integer end
$$;

-- The context allowlist. lib/errorCore.js's ERROR_CONTEXT_KEYS and
-- ERROR_HTTP_KEYS are its client twins (errorContext.test.mjs).
create or replace function public._client_error_context(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else
    nullif(jsonb_strip_nulls(jsonb_build_object(
      'op',       public._error_ctx_s(p->'op'),
      'code',     public._error_ctx_s(p->'code'),
      'surface',  public._error_ctx_s(p->'surface'),
      'vis',      public._error_ctx_s(p->'vis'),
      'net',      public._error_ctx_s(p->'net'),
      'tag',      public._error_ctx_s(p->'tag'),
      'host',     public._error_ctx_s(p->'host'),
      'phase',    public._error_ctx_s(p->'phase'),
      'group',    public._error_ctx_s(p->'group'),
      'board_id', case when jsonb_typeof(p->'board_id') = 'string'
                        and (p->>'board_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then lower(p->>'board_id') end,
      'online',   case when jsonb_typeof(p->'online') = 'boolean' then p->'online' end,
      'attempt',  public._error_ctx_int(p->'attempt'),
      'ms',       public._error_ctx_int(p->'ms'),
      'http',     case when jsonb_typeof(p->'http') = 'object' then
                    nullif(jsonb_strip_nulls(jsonb_build_object(
                      'method', public._error_ctx_s(p->'http'->'method'),
                      'svc',    public._error_ctx_s(p->'http'->'svc'),
                      'route',  public._error_ctx_s(p->'http'->'route'),
                      'pg',     public._error_ctx_s(p->'http'->'pg'),
                      'status', public._error_ctx_int(p->'http'->'status'),
                      'ms',     public._error_ctx_int(p->'http'->'ms'))), '{}'::jsonb)
                  end)), '{}'::jsonb)
  end
$$;

-- The last 25 steps, in order: a kind from the fixed set, the time before the
-- error in ms, and a name of 60 characters from a plain alphabet. Link tokens
-- and ids are turned into :token and :id.
create or replace function public._client_error_crumbs(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select case when p is null or jsonb_typeof(p) <> 'array' then null else (
    select nullif(coalesce(jsonb_agg(c.v order by c.ord), '[]'::jsonb), '[]'::jsonb)
      from (
        select x.ord, jsonb_build_object(
                 't', public._error_ctx_int(x.e->'t'),
                 'k', x.e->>'k',
                 'n', left(regexp_replace(regexp_replace(public._redact_link_text(x.e->>'n'),
                        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', 'gi'),
                        '[^A-Za-z0-9_:./ -]', '', 'g'), 60)) as v
          from jsonb_array_elements(p) with ordinality as x(e, ord)
         where jsonb_typeof(x.e) = 'object'
           and x.e->>'k' in ('nav', 'ev', 'toast', 'http', 'net', 'vis', 'err')
           and jsonb_typeof(x.e->'t') = 'number'
           and jsonb_typeof(x.e->'n') = 'string'
         order by x.ord desc
         limit 25
      ) c
  ) end
$$;

-- ── 3. Indexes ───────────────────────────────────────────────────────────────
create index if not exists client_errors_fp_time on public.client_errors (fingerprint, occurred_at desc);
create index if not exists client_errors_session_recv on public.client_errors (session_id, received_at desc)
  where session_id is not null;
create index if not exists client_errors_recv on public.client_errors (received_at);

-- ── 4. Groups ────────────────────────────────────────────────────────────────
create table if not exists public.client_error_groups (
  fingerprint       text primary key,
  source            text not null,
  kind              text,
  severity          text,
  sample_message    text,
  sample_stack      text,
  sample_path       text,
  first_seen        timestamptz not null,
  first_release     text,
  last_seen         timestamptz not null,
  last_release      text,
  occurrences       bigint not null default 0,
  status            text not null default 'open',
  status_at         timestamptz,
  status_by         uuid,
  resolved_releases text[],
  returned_at       timestamptz,
  updated_at        timestamptz not null default now(),
  constraint client_error_groups_status_ck check (status in ('open', 'resolved', 'muted'))
);
create index if not exists client_error_groups_last_seen on public.client_error_groups (last_seen desc);

alter table public.client_error_groups enable row level security;
do $pol$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'client_error_groups'
                    and policyname = 'admin read client_error_groups') then
    create policy "admin read client_error_groups" on public.client_error_groups
      for select using (
        exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.tier = 'admin')
      );
  end if;
end $pol$;
-- Writes go through definer functions only; a signed-in admin reads.
revoke all on public.client_error_groups from anon, authenticated;
grant select on public.client_error_groups to authenticated;

create or replace function public.refresh_error_groups()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_from timestamptz;
  -- A row's received_at is its transaction's start; ten seconds lets every
  -- insert that started inside the window commit before the window is read.
  v_to   timestamptz := now() - interval '10 seconds';
  v_n    integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('refresh_error_groups')) then
    return 0;
  end if;
  select (value->>'at')::timestamptz into v_from
    from public.app_config where key = 'error_groups_refresh';
  v_from := coalesce(v_from, '-infinity'::timestamptz);
  if v_from >= v_to then
    return 0;
  end if;

  -- (a) A resolved group opens again when it turns up on a release it had not
  -- been seen on before the resolve. A row with no release (most servers)
  -- counts once it arrives an hour after the resolve.
  update public.client_error_groups g
     set status = 'open', returned_at = now(), status_at = now(), status_by = null, updated_at = now()
    from (select e.fingerprint,
                 array_agg(distinct e.release) filter (where e.release is not null) as releases,
                 bool_or(e.release is null) as unreleased,
                 max(e.received_at) as last_at
            from public.client_errors e
           where e.received_at > v_from and e.received_at <= v_to and e.fingerprint is not null
           group by e.fingerprint) f
   where g.fingerprint = f.fingerprint
     and g.status = 'resolved'
     and (exists (select 1 from unnest(coalesce(f.releases, '{}')) r
                   where not (r = any(coalesce(g.resolved_releases, '{}'))))
          or (f.unreleased and f.last_at > g.status_at + interval '1 hour'));

  -- (b) Fold the window in.
  insert into public.client_error_groups as g
         (fingerprint, source, kind, severity, sample_message, sample_stack, sample_path,
          first_seen, first_release, last_seen, last_release, occurrences, status, status_at)
  select f.fingerprint, f.source, f.kind, f.severity, f.sample_message, f.sample_stack, f.sample_path,
         f.first_seen, f.first_release, f.last_seen, f.last_release, f.n,
         case when f.muted then 'muted' else 'open' end,
         case when f.muted then now() end
    from (select e.fingerprint,
                 (array_agg(e.source order by e.received_at desc))[1] as source,
                 (array_agg(e.kind order by e.received_at desc))[1] as kind,
                 (array_agg(e.severity order by case e.severity when 'crash' then 0 when 'error' then 1 else 2 end,
                                                e.received_at desc))[1] as severity,
                 (array_agg(e.message order by e.received_at desc))[1] as sample_message,
                 (array_agg(e.stack order by e.received_at desc) filter (where e.stack is not null))[1] as sample_stack,
                 (array_agg(e.path order by e.received_at desc) filter (where e.path is not null))[1] as sample_path,
                 min(e.received_at) as first_seen,
                 (array_agg(e.release order by e.received_at) filter (where e.release is not null))[1] as first_release,
                 max(e.received_at) as last_seen,
                 (array_agg(e.release order by e.received_at desc) filter (where e.release is not null))[1] as last_release,
                 count(*) as n,
                 bool_or(exists (select 1 from public.client_error_mutes m
                                  where m.message_key = public._error_message_key(e.message))) as muted
            from public.client_errors e
           where e.received_at > v_from and e.received_at <= v_to and e.fingerprint is not null
           group by e.fingerprint) f
  on conflict (fingerprint) do update set
    source         = excluded.source,
    kind           = excluded.kind,
    severity       = case when (case excluded.severity when 'crash' then 0 when 'error' then 1 else 2 end)
                             < (case g.severity when 'crash' then 0 when 'error' then 1 else 2 end)
                          then excluded.severity else g.severity end,
    sample_message = excluded.sample_message,
    sample_stack   = coalesce(excluded.sample_stack, g.sample_stack),
    sample_path    = coalesce(excluded.sample_path, g.sample_path),
    first_seen     = least(g.first_seen, excluded.first_seen),
    first_release  = coalesce(g.first_release, excluded.first_release),
    last_seen      = greatest(g.last_seen, excluded.last_seen),
    last_release   = coalesce(excluded.last_release, g.last_release),
    occurrences    = g.occurrences + excluded.occurrences,
    updated_at     = now();
  get diagnostics v_n = row_count;

  insert into public.app_config (key, value, updated_at)
  values ('error_groups_refresh', jsonb_build_object('at', v_to), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_n;
end;
$$;

-- What the 5-minute job runs. 0581 adds the server-health and breaking checks
-- after the refresh.
create or replace function public.error_watch()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.refresh_error_groups();
end;
$$;

-- ── 5. Erasure keeps up with the new identifier ──────────────────────────────
create or replace function public.anonymize_user_client_errors(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions     uuid[];
  v_app_sessions uuid[];
  v_count        integer := 0;
begin
  select array_agg(distinct session_id) filter (where session_id is not null),
         array_agg(distinct app_session_id) filter (where app_session_id is not null)
    into v_sessions, v_app_sessions
    from public.client_errors where user_id = p_user_id;
  update public.client_errors
     set user_id = null, session_id = null, app_session_id = null
   where user_id = p_user_id
      or (v_sessions is not null and session_id = any(v_sessions))
      or (v_app_sessions is not null and app_session_id = any(v_app_sessions));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 6. Grants (0311): every helper is the owner's alone ──────────────────────
revoke all on function public._error_group_key(text) from public, anon, authenticated;
revoke all on function public._error_frame_key(text) from public, anon, authenticated;
revoke all on function public._error_fingerprint(text, text, text, text) from public, anon, authenticated;
revoke all on function public._error_default_severity(text) from public, anon, authenticated;
revoke all on function public._error_ctx_str(text) from public, anon, authenticated;
revoke all on function public._error_ctx_s(jsonb) from public, anon, authenticated;
revoke all on function public._error_ctx_int(jsonb) from public, anon, authenticated;
revoke all on function public._client_error_context(jsonb) from public, anon, authenticated;
revoke all on function public._client_error_crumbs(jsonb) from public, anon, authenticated;
revoke all on function public.refresh_error_groups() from public, anon, authenticated;
revoke all on function public.error_watch() from public, anon, authenticated;
revoke all on function public.anonymize_user_client_errors(uuid) from public, anon, authenticated;
grant execute on function public.refresh_error_groups() to service_role;
grant execute on function public.error_watch() to service_role;
grant execute on function public.anonymize_user_client_errors(uuid) to service_role;

-- ── 7. The insert policy: a client writes client rows only ───────────────────
alter policy "anyone insert client_errors" on public.client_errors
  with check (source = 'client'
              and (kind is null or kind not in ('discovery_pipeline', 'aeo_probe', 'seo_health', 'csp_violation')));

-- ── 8. The trigger ───────────────────────────────────────────────────────────
create or replace function public._tg_client_errors_shape()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recent integer;
begin
  new.source := case
    when new.kind = 'csp_violation' then 'worker'
    when new.kind = 'seo_health' then 'edge'
    when new.kind in ('discovery_pipeline', 'aeo_probe') then 'db'
    else coalesce(new.source, 'client') end;
  new.kind            := left(new.kind, 40);
  new.name            := left(new.name, 200);
  new.message         := left(new.message, 2000);
  new.stack           := left(new.stack, 8000);
  new.component_stack := left(new.component_stack, 8000);
  new.path            := left(new.path, 300);
  new.release         := left(new.release, 40);
  new.user_agent      := left(new.user_agent, 500);
  new.env             := case when new.env in ('prod', 'preview', 'dev') then new.env end;
  new.severity        := case when new.severity in ('crash', 'error', 'warning') then new.severity
                              else public._error_default_severity(new.kind) end;
  new.context         := public._client_error_context(new.context);
  new.breadcrumbs     := public._client_error_crumbs(new.breadcrumbs);
  new.received_at     := now();
  new.fingerprint     := public._error_fingerprint(new.source, new.kind, new.message, new.stack);

  -- Floods. The servers cap themselves. A client row is refused (the insert
  -- still answers 201) once its session has sent 300 in an hour, or, with no
  -- session, once its fingerprint has arrived 60 times in a minute.
  if new.source = 'client' then
    if new.session_id is not null then
      select count(*) into v_recent from (
        select 1 from public.client_errors
         where session_id = new.session_id and received_at > now() - interval '1 hour'
         limit 300) s;
      if v_recent >= 300 then
        return null;
      end if;
    else
      select count(*) into v_recent from (
        select 1 from public.client_errors
         where fingerprint = new.fingerprint and session_id is null
           and received_at > now() - interval '1 minute'
         limit 60) s;
      if v_recent >= 60 then
        return null;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._tg_client_errors_shape() from public, anon, authenticated;

create or replace trigger client_errors_shape
  before insert on public.client_errors
  for each row execute function public._tg_client_errors_shape();

-- ── 9. History, shaped as the trigger shapes new rows; the groups; the job ───
-- After the trigger: this applies in parts on a live table, and a row that
-- arrives in between is shaped by one or the other, never neither.
update public.client_errors e
   set source      = s.source,
       severity    = coalesce(e.severity, public._error_default_severity(e.kind)),
       fingerprint = public._error_fingerprint(s.source, e.kind, e.message, e.stack),
       received_at = coalesce(e.received_at, e.occurred_at)
  from (select id,
               case when kind = 'csp_violation' then 'worker'
                    when kind = 'seo_health' then 'edge'
                    when kind in ('discovery_pipeline', 'aeo_probe') then 'db'
                    else source end as source
          from public.client_errors) s
 where s.id = e.id
   and (e.fingerprint is null or e.received_at is null);

select public.refresh_error_groups();

do $$ begin
  perform cron.unschedule('error-watch');
exception when others then null;
end $$;
select cron.schedule('error-watch', '*/5 * * * *', $$ select public.error_watch(); $$);

-- ── Proof ────────────────────────────────────────────────────────────────────
do $proof$
declare
  v_fn      text;
  v_names   text;
  v_ctx     jsonb;
  v_crumbs  jsonb;
  v_id      uuid := gen_random_uuid();
  v_row     public.client_errors;
  v_refused boolean := false;
begin
  -- The 0311 habit: effective privileges, PUBLIC included.
  foreach v_fn in array array[
    'public._error_group_key(text)', 'public._error_frame_key(text)',
    'public._error_fingerprint(text,text,text,text)', 'public._error_default_severity(text)',
    'public._error_ctx_str(text)', 'public._error_ctx_s(jsonb)', 'public._error_ctx_int(jsonb)',
    'public._client_error_context(jsonb)', 'public._client_error_crumbs(jsonb)',
    'public._tg_client_errors_shape()', 'public.refresh_error_groups()', 'public.error_watch()',
    'public.anonymize_user_client_errors(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0580: a client role can run %', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.refresh_error_groups()', 'public.error_watch()',
                              'public.anonymize_user_client_errors(uuid)'] loop
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0580: service_role cannot run %', v_fn;
    end if;
  end loop;

  -- The shapes.
  if public._error_group_key('invalid input syntax for type uuid: "doc-1792881173421"')
       <> 'invalid input syntax for type uuid: <q>' then
    raise exception '0580: the group key kept a quoted value';
  end if;
  if public._error_fingerprint('client', 'window', 'Position 12 out of range',
       'at t (https://x/assets/CanvasSurface-AbCdEf12.js:1:2)')
     <> public._error_fingerprint('client', 'window', 'Position 99 out of range',
       'at q (https://x/assets/CanvasSurface-Zz-yXx98.js:1:7)') then
    raise exception '0580: a fingerprint moved with a build hash or a number';
  end if;
  v_ctx := public._client_error_context(
    '{"op":"board_state","code":"a@b.c","board_id":"nope","online":false,"ms":12.6,"extra":"x",
      "http":{"route":"rpc/x","status":500,"secret":"s"}}');
  if v_ctx is distinct from '{"op":"board_state","online":false,"ms":13,"http":{"route":"rpc/x","status":500}}'::jsonb then
    raise exception '0580: the context kept %', v_ctx;
  end if;
  v_crumbs := public._client_error_crumbs(
    '[{"t":-5,"k":"nav","n":"/share/3f2b8c1e-1d2a-4b3c-9d8e-7f6a5b4c3d2e"},
      {"t":-2,"k":"bogus","n":"x"},
      {"t":0,"k":"ev","n":"a@b <i>"}]');
  if v_crumbs is distinct from '[{"t":-5,"k":"nav","n":"/share/:token"},{"t":0,"k":"ev","n":"ab i"}]'::jsonb then
    raise exception '0580: the breadcrumbs kept %', v_crumbs;
  end if;

  -- The trigger order: the shape runs after the redaction.
  select string_agg(t.tgname, ',' order by t.tgname) into v_names
    from pg_trigger t
   where t.tgrelid = 'public.client_errors'::regclass and not t.tgisinternal
     and t.tgenabled = 'O' and (t.tgtype & 2) <> 0 and (t.tgtype & 4) <> 0;
  if v_names is distinct from 'client_errors_clamp_time,client_errors_redact_links,client_errors_shape' then
    raise exception '0580: the before-insert triggers on client_errors are %', coalesce(v_names, 'none');
  end if;

  -- As a signed-out caller, a row claiming a server is refused...
  begin
    set local role anon;
    insert into public.client_errors (id, kind, message, source) values (v_id, 'window', '0580 probe', 'worker');
  exception when insufficient_privilege then
    v_refused := true;
  end;
  reset role;
  if not v_refused then
    raise exception '0580: a signed-out caller wrote a server row';
  end if;
  v_refused := false;
  begin
    set local role anon;
    insert into public.client_errors (id, kind, message) values (v_id, 'csp_violation', '0580 probe');
  exception when insufficient_privilege then
    v_refused := true;
  end;
  reset role;
  if not v_refused then
    raise exception '0580: a signed-out caller forged a CSP row';
  end if;

  -- ...and an ordinary one is shaped. The probe row is rolled back with its
  -- sub-block, so nothing is left behind.
  begin
    set local role anon;
    insert into public.client_errors (id, kind, message, context, breadcrumbs)
    values (v_id, 'http', '0580 probe', '{"op":"x","nope":1}', '[{"t":-1,"k":"ev","n":"app_open"}]');
    reset role;
    select * into v_row from public.client_errors where id = v_id;
    raise exception using errcode = 'P0001', message = '0580-probe-rollback';
  exception when sqlstate 'P0001' then
    if sqlerrm <> '0580-probe-rollback' then
      raise;
    end if;
  end;
  reset role;
  if v_row.id is null or v_row.source <> 'client' or v_row.fingerprint is null
     or v_row.severity <> 'error' or v_row.context is distinct from '{"op":"x"}'::jsonb
     or v_row.breadcrumbs is distinct from '[{"t":-1,"k":"ev","n":"app_open"}]'::jsonb
     or v_row.received_at is null then
    raise exception '0580: a signed-out insert was not shaped: %', row_to_json(v_row);
  end if;
  if exists (select 1 from public.client_errors where id = v_id) then
    raise exception '0580: the probe row was left behind';
  end if;

  -- History has groups.
  if exists (select 1 from public.client_errors where fingerprint is null) then
    raise exception '0580: a row has no fingerprint';
  end if;
  if exists (select 1 from public.client_errors)
     and not exists (select 1 from public.client_error_groups) then
    raise exception '0580: refresh_error_groups folded nothing in';
  end if;
end $proof$;

notify pgrst, 'reload schema';
