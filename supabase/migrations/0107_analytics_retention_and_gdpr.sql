-- 0107_analytics_retention_and_gdpr.sql
--
-- Closes the two analytics-governance gaps on public.analytics_events (0071):
--   (a) Retention — the table was append-only and unbounded. A nightly pg_cron
--       job hard-purges events older than the retention window (default 400d,
--       ~13 months: preserves year-over-year + margin; metrics_daily holds the
--       long-term KPI history regardless).
--   (b) Per-user export — admin_export_user_data() bundles everything we hold on
--       a user (DSAR / data portability), including pre-signup anonymous events
--       stitched to the account by session_id.
--   (c) GDPR erasure — anonymize_user_analytics() drops the identifiers
--       (user_id, session_id) and scrubs attribution PII from props, keeping
--       event/occurred_at/path so aggregate funnels stay intact. Called by the
--       admin-account-action edge fn BEFORE auth.users deletion (today deletion
--       only SET-NULLs user_id, leaving rows correlatable by session_id with
--       referrer/utm PII in props).
--
-- Mirrors existing conventions: security definer + set search_path = public,
-- _require_admin() gating (0070), the cron unschedule/schedule idempotency
-- wrapper (0101), and revoke-from-public + explicit grants.

create extension if not exists pg_cron;

-- ── (a) Retention / TTL ──────────────────────────────────────────────────────
-- Cron-only (NOT _require_admin gated — the cron job runs with no auth.uid()).
-- Batched delete avoids a long lock on a large table. Retention floored at 30d
-- so a bad argument can never nuke recent data.
create or replace function public.purge_old_analytics_events(p_retention_days int default 400)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff  timestamptz := now() - make_interval(days => greatest(p_retention_days, 30));
  v_deleted integer := 0;
  v_batch   integer;
begin
  loop
    delete from public.analytics_events
     where ctid in (
       select ctid from public.analytics_events
        where occurred_at < v_cutoff
        limit 10000
     );
    get diagnostics v_batch = row_count;
    v_deleted := v_deleted + v_batch;
    exit when v_batch = 0;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.purge_old_analytics_events(int) from public;

-- Nightly at 03:30 UTC — the 03:00–03:10 window is taken by the 0052 purge/prune
-- jobs; 03:30 is free and still ahead of the 04:00 Worker R2 sweep.
do $$ begin
  perform cron.unschedule('purge_old_analytics_events');
exception when others then null;   -- not scheduled yet → ignore
end $$;
select cron.schedule('purge_old_analytics_events', '30 3 * * *', $$ select public.purge_old_analytics_events(400); $$);

-- ── (b) Per-user export (DSAR / portability) ─────────────────────────────────
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

  -- Every session id ever tied to this user, so the export also covers the
  -- pre-signup anonymous events that were later stitched to the account.
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
    )
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_export_user_data(uuid) from public;
grant execute on function public.admin_export_user_data(uuid) to authenticated;

-- ── (c) GDPR erasure on user delete ──────────────────────────────────────────
-- Anonymize in place rather than hard-delete: removes identifiability while
-- preserving aggregate funnel counts. Granted to service_role (the
-- admin-account-action edge fn calls it before auth.admin.deleteUser).
create or replace function public.anonymize_user_analytics(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions uuid[];
  v_count    integer := 0;
begin
  -- Collect sessions BEFORE nulling anything, so the anon rows stitched to the
  -- account by session_id are caught too.
  select array_agg(distinct session_id)
    into v_sessions
    from public.analytics_events
   where user_id = p_user_id and session_id is not null;

  update public.analytics_events
     set user_id    = null,
         session_id = null,
         props      = props - array['referrer','utm_source','utm_medium','utm_campaign','utm_content','utm_term']::text[]
   where user_id = p_user_id
      or (v_sessions is not null and session_id = any(v_sessions));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.anonymize_user_analytics(uuid) from public;
grant execute on function public.anonymize_user_analytics(uuid) to service_role;
