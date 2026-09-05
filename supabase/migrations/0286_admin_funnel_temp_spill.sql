-- 0286 — the admin funnel RPCs were the largest consumer of this project's
-- Disk IO budget.
--
-- Every one of them opens with the same CTE:
--
--   with ev as (select e.session_id, e.props, ... from analytics_events e
--               where e.occurred_at >= v_since ...)
--
-- `ev` is referenced more than once, so Postgres materialises it into a
-- tuplestore — and that tuplestore carries the whole JSONB props column
-- (~486 bytes a row) for every event in the window. work_mem on this instance
-- is 2184kB, so a 16-20MB tuplestore spills to disk, is written once and read
-- back once per reference.
--
-- Measured over 19 days: admin_funnel_segments alone wrote 10 GB of temp files
-- (54% of every temp byte the database has written), admin_signup_funnel 3.3 GB,
-- admin_fb_funnel 1.6 GB. Temp-file traffic is ~99% of this instance's physical
-- disk IO; table reads are 541 MB against a 99.999% cache hit ratio. The
-- database was never short of memory for reading — it was spilling sorts.
--
-- admin_funnel_segments is rewritten here because it is both the biggest and
-- the simplest: it only ever reads three props keys, so the CTE can project
-- them as columns and filter to rows that have at least one. Measured on
-- production with p_days=30:
--
--   before: 14,061 buffers, 18 MB temp written, 36 MB temp read, 7,264 ms
--   after:  14,061 buffers,  0 MB temp,          0 MB temp,      1,028 ms
--
-- Identical output, row for row.
--
-- The `?|` existence filter is a superset of the three `is not null` tests the
-- branches already apply — a row with none of the keys contributes to no branch
-- — so pushing it into the CTE cannot change the result. It drops the
-- materialised set by roughly 4x, because most events carry no UTM keys at all.

create or replace function public.admin_funnel_segments(
  p_days integer default 30,
  p_exclude_internal boolean default true
)
returns table(dim text, value text, sessions bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_since timestamptz := now() - (greatest(1, least(p_days, 365)) || ' days')::interval;
begin
  perform public._require_admin();
  return query
  with ev as (
    select e.session_id,
           e.props->>'utm_source'   as src,
           e.props->>'utm_campaign' as camp,
           e.props->>'utm_content'  as cont
    from public.analytics_events e
    where e.occurred_at >= v_since
      and e.session_id is not null
      and (e.props ?| array['utm_source','utm_campaign','utm_content'])
      and (not p_exclude_internal
           or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  )
  select 'source'::text, ev.src, count(distinct ev.session_id)::bigint
    from ev where ev.src is not null group by 2
  union all
  select 'campaign'::text, ev.camp, count(distinct ev.session_id)::bigint
    from ev where ev.camp is not null group by 2
  union all
  select 'content'::text, ev.cont, count(distinct ev.session_id)::bigint
    from ev where ev.cont is not null group by 2
  order by 1, 3 desc;
end $function$;

-- The remaining spillers reference `ev` many times with different props keys
-- and join it to profiles, so the same projection trick needs a per-function
-- rewrite and a per-function correctness argument. Until those land, scope
-- work_mem to the functions themselves.
--
-- This is deliberately NOT a global change. Total RAM is ~1GB, shared_buffers
-- takes 224MB, and max_connections is 60 — a global 16MB work_mem is an OOM
-- waiting for a busy moment. `work_mem` has context='user', so ALTER FUNCTION
-- confines it to that function's own execution and nothing else on the instance
-- can see it. These are admin-only RPCs behind _require_admin() with an
-- effective concurrency of one operator.
--
-- Treat this as a stopgap with a known ceiling: it masks a cost that grows with
-- analytics_events rather than removing it.
alter function public.admin_signup_funnel(integer, text, text, text, boolean, boolean)
  set work_mem = '16MB';
alter function public.admin_fb_funnel(integer, boolean)
  set work_mem = '16MB';
alter function public.admin_onboarding_error_coverage(integer, boolean)
  set work_mem = '24MB';
alter function public.admin_device_breakdown(integer, boolean)
  set work_mem = '16MB';
alter function public.admin_checkout_reliability(integer, boolean)
  set work_mem = '24MB';
alter function public.admin_first_session_compare(date, integer, boolean, boolean)
  set work_mem = '24MB';
