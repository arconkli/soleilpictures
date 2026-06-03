-- 0108_client_errors.sql
--
-- First-party client-side error logging (chosen over a third-party SDK like
-- Sentry: $0, no account/DSN/quota, ~0 bundle cost, data stays in our DB).
-- Mirrors the analytics_events conventions (0071) + the retention/GDPR helpers
-- from 0107: anon INSERT / admin SELECT RLS, a nightly purge cron, admin RPCs,
-- anonymize-on-delete, and inclusion in the per-user export.
--
-- Written to by boards/src/lib/errorReporting.js (window error/unhandledrejection
-- + AppErrorBoundary). Surfaced in the admin dashboard "Errors" tab.

create extension if not exists pg_cron;

create table if not exists public.client_errors (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid,                                       -- shared with analytics_events
  user_id         uuid references auth.users on delete set null,
  kind            text,                                       -- 'render' | 'window' | 'unhandledrejection'
  name            text,
  message         text,
  stack           text,
  component_stack text,
  path            text,
  release         text,
  user_agent      text,
  occurred_at     timestamptz not null default now()
);
create index if not exists client_errors_time      on public.client_errors(occurred_at desc);
create index if not exists client_errors_user_time on public.client_errors(user_id, occurred_at desc) where user_id is not null;
create index if not exists client_errors_msg        on public.client_errors(message);

alter table public.client_errors enable row level security;

drop policy if exists "anyone insert client_errors" on public.client_errors;
create policy "anyone insert client_errors" on public.client_errors
  for insert with check (true);

drop policy if exists "admin read client_errors" on public.client_errors;
create policy "admin read client_errors" on public.client_errors
  for select using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.tier = 'admin')
  );

-- ── Retention (90d; errors don't need the 400d analytics window) ─────────────
create or replace function public.purge_old_client_errors(p_retention_days int default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff  timestamptz := now() - make_interval(days => greatest(p_retention_days, 7));
  v_deleted integer := 0;
  v_batch   integer;
begin
  loop
    delete from public.client_errors
     where ctid in (select ctid from public.client_errors where occurred_at < v_cutoff limit 10000);
    get diagnostics v_batch = row_count;
    v_deleted := v_deleted + v_batch;
    exit when v_batch = 0;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.purge_old_client_errors(int) from public;

do $$ begin
  perform cron.unschedule('purge_old_client_errors');
exception when others then null;
end $$;
select cron.schedule('purge_old_client_errors', '35 3 * * *', $$ select public.purge_old_client_errors(90); $$);

-- ── Admin: grouped triage summary (Sentry-lite: group identical messages) ────
create or replace function public.admin_error_summary(p_days int default 7)
returns table(message text, kind text, occurrences bigint, sessions bigint, users bigint,
              first_seen timestamptz, last_seen timestamptz, sample_stack text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
    select e.message,
           min(e.kind)                                              as kind,
           count(*)::bigint                                         as occurrences,
           count(distinct e.session_id)::bigint                     as sessions,
           count(distinct e.user_id)::bigint                        as users,
           min(e.occurred_at)                                       as first_seen,
           max(e.occurred_at)                                       as last_seen,
           (array_agg(e.stack order by e.occurred_at desc))[1]      as sample_stack
      from public.client_errors e
     where e.occurred_at >= now() - make_interval(days => p_days)
     group by e.message
     order by occurrences desc, last_seen desc
     limit 200;
end;
$$;
revoke all on function public.admin_error_summary(int) from public;
grant execute on function public.admin_error_summary(int) to authenticated;

-- ── Admin: recent raw list (full detail for one error) ───────────────────────
create or replace function public.admin_recent_errors(p_days int default 7, p_limit int default 100)
returns table(id uuid, occurred_at timestamptz, kind text, name text, message text, path text,
              release text, user_id uuid, session_id uuid, stack text, component_stack text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  p_days  := greatest(1, least(p_days, 365));
  p_limit := greatest(1, least(p_limit, 500));
  return query
    select e.id, e.occurred_at, e.kind, e.name, e.message, e.path, e.release,
           e.user_id, e.session_id, e.stack, e.component_stack
      from public.client_errors e
     where e.occurred_at >= now() - make_interval(days => p_days)
     order by e.occurred_at desc
     limit p_limit;
end;
$$;
revoke all on function public.admin_recent_errors(int, int) from public;
grant execute on function public.admin_recent_errors(int, int) to authenticated;

-- ── GDPR erasure on user delete (called by admin-account-action edge fn) ─────
create or replace function public.anonymize_user_client_errors(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions uuid[];
  v_count    integer := 0;
begin
  select array_agg(distinct session_id) into v_sessions
    from public.client_errors where user_id = p_user_id and session_id is not null;
  update public.client_errors
     set user_id = null, session_id = null
   where user_id = p_user_id or (v_sessions is not null and session_id = any(v_sessions));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.anonymize_user_client_errors(uuid) from public;
grant execute on function public.anonymize_user_client_errors(uuid) to service_role;

-- ── Extend the per-user export (0107) to include client_errors ───────────────
create or replace function public.admin_export_user_data(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sessions uuid[];
  v_result   jsonb;
begin
  perform public._require_admin();

  select array_agg(distinct session_id)
    into v_sessions
    from public.analytics_events
   where user_id = p_user_id and session_id is not null;

  select jsonb_build_object(
    'exported_at', now(),
    'user_id',     p_user_id,
    'auth', (
      select jsonb_build_object(
               'email',           u.email,
               'created_at',      u.created_at,
               'last_sign_in_at', u.last_sign_in_at)
        from auth.users u where u.id = p_user_id
    ),
    'profile',      (select to_jsonb(p) from public.profiles p      where p.user_id = p_user_id),
    'subscription', (select to_jsonb(s) from public.subscriptions s where s.user_id = p_user_id),
    'feedback',     (select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at), '[]'::jsonb)
                       from public.feedback f where f.user_id = p_user_id),
    'paid_grants',  (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb)
                       from public.paid_grants g where g.user_id = p_user_id),
    'analytics_events', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at), '[]'::jsonb)
        from public.analytics_events e
       where e.user_id = p_user_id
          or (v_sessions is not null and e.session_id = any(v_sessions))
    ),
    'client_errors', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.occurred_at), '[]'::jsonb)
        from public.client_errors c
       where c.user_id = p_user_id
          or (v_sessions is not null and c.session_id = any(v_sessions))
    )
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_export_user_data(uuid) from public;
grant execute on function public.admin_export_user_data(uuid) to authenticated;
