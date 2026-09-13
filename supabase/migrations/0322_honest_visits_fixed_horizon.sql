-- 0322 — an honest visit, and a return rate that can move.
--
-- Three things were wrong with the read the retention dashboard led with:
--
-- 1. user_active_day is keyed on Postgres current_date, which is UTC. A person
--    in a US evening who works from 23:30 to 00:20 UTC produces two rows and is
--    counted as having made visit one AND visit two — one sitting, two visits.
--    A meaningful slice of every "second visit" on the survival curve was this.
-- 2. A tab left open from yesterday keeps heart-beating today. That day has a
--    user_active_day row and no page load, no click, no card: presence without
--    a person. Another slice of "second visits" was this.
-- 3. The unbounded conditional step pools people whose first visit was three
--    days ago with people whose first visit was three months ago. A real change
--    in behaviour moves it by a fraction of a point per week; it structurally
--    cannot show a result inside the window anyone would act on.
--
-- So: ONE visit definition, in a helper every retention RPC reads from —
--   * days come from analytics_events (which has timestamps), not user_active_day
--   * a day is merged into the previous visit when its first event is under
--     p_merge_hours after the previous day's last event
--   * a visit only counts if it contains at least one event that is not
--     passive telemetry (heartbeat, pause, trace, summary, suppression)
-- and a FIXED-HORIZON return (did visit two begin within N days of visit one)
-- split by device, first source, day-one depth and signup week, which is the
-- number that can be read weekly and compared before/after a deploy.
--
-- The two 0279 RPCs are re-created on the helper. They gain a trailing
-- p_merge_hours parameter, which means DROP + CREATE: `create or replace` with
-- a new parameter list leaves the old function in place, and PostgREST resolves
-- overloads by argument NAME, so a client passing only the shared names gets
-- "function is not unique". Grants are restated because a dropped function
-- takes its ACL with it. The proof block at the end also asserts that exactly
-- one definition of each survived.

-- ── 1. The visit definition ─────────────────────────────────────────────────
create or replace function public._admin_visits(
  p_since date,
  p_exclude_internal boolean,
  p_verified_only boolean,
  p_merge_hours int
)
returns table (
  user_id uuid,
  k int,
  day date,
  first_at timestamptz,
  last_at timestamptz,
  did_work boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with u as (
    select usr.id as user_id
      from auth.users usr
     where usr.created_at >= p_since
       and (not p_verified_only
            or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  -- One row per UTC day per user, with whether anything real happened. The
  -- passive list is telemetry the client emits on its own schedule; a day made
  -- only of these is a tab, not a person.
  days as (
    select e.user_id,
           (e.occurred_at at time zone 'utc')::date as day,
           min(e.occurred_at) as first_at,
           max(e.occurred_at) as last_at,
           bool_or(e.event not in (
             'ps_heartbeat', 'ps_pause', 'ps_trace', 'session_summary', 'up_suppressed',
             'experiment_enrolled', 'ps_tier_resolved', 'lp_trace', 'app_trace', 'up_trace',
             'ps_seed_skip', 'ps_seed_start', 'ps_seed_done', 'instant_entry_skip',
             'lp_dwell', 'landing_dwell', 'pricing_dwell', 'ps_end', 'telemetry_drop'
           )) as real
      from public.analytics_events e
      join u on u.user_id = e.user_id
     group by e.user_id, (e.occurred_at at time zone 'utc')::date
  ),
  -- A day starts a NEW visit unless it begins within p_merge_hours of the
  -- previous day's last event — that is the same sitting crossing midnight.
  marked as (
    select d.*,
           case when d.first_at - lag(d.last_at) over (partition by d.user_id order by d.day)
                     < make_interval(hours => greatest(coalesce(p_merge_hours, 0), 0))
                then 0 else 1 end as nv
      from days d
  ),
  numbered as (
    select m.*, sum(m.nv) over (partition by m.user_id order by m.day) as vn
      from marked m
  ),
  merged as (
    select n.user_id, n.vn,
           min(n.day) as day,
           min(n.first_at) as first_at,
           max(n.last_at) as last_at,
           bool_or(n.real) as real,
           bool_or(exists (
             select 1 from public.user_active_day a
              where a.user_id = n.user_id and a.day = n.day and a.did_work
           )) as did_work
      from numbered n
     group by n.user_id, n.vn
  )
  -- Renumber AFTER dropping phantom visits, so k=2 is the second time a person
  -- actually showed up, not the second calendar day a tab was alive.
  select m.user_id,
         row_number() over (partition by m.user_id order by m.first_at)::int as k,
         m.day, m.first_at, m.last_at, m.did_work
    from merged m
   where m.real
$$;

revoke execute on function public._admin_visits(date, boolean, boolean, int)
  from public, anon, authenticated;

comment on function public._admin_visits(date, boolean, boolean, int) is
  'Internal. The one visit definition every retention RPC reads: UTC days from '
  'analytics_events, merged into the previous visit when they begin within '
  'p_merge_hours of its last event, dropped entirely when they hold only '
  'passive telemetry, then renumbered. Not callable by clients.';

-- ── 2. Conditional survival, re-created on the helper ──────────────────────
drop function if exists public.admin_survival_curve(date, int, int, boolean, boolean, boolean);

create function public.admin_survival_curve(
  p_since date default '2026-06-16',
  p_grace_days int default 14,
  p_max_visits int default 10,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_require_work boolean default false,
  p_merge_hours int default 2
)
returns table (
  visit int,
  reached int,
  continued int,
  pct numeric,
  since date,
  work_floor date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_grace int  := least(greatest(coalesce(p_grace_days, 14), 0), 365);
  v_max   int  := least(greatest(coalesce(p_max_visits, 10), 2), 60);
  v_floor date := case
    when coalesce(p_require_work, false)
      then (select min(a.day) from public.user_active_day a where a.did_work)
    else null
  end;
  -- The clamp described in 0279's header. When work is required, a cohort
  -- start earlier than the floor is moved forward rather than honoured, because
  -- the honoured version returns zeros that look like churn.
  v_since date := greatest(coalesce(p_since, '2026-06-16'::date),
                           coalesce(v_floor, '-infinity'::date));
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
     where (not p_require_work or did_work)
  ),
  -- When work is required, visits are renumbered among WORK visits, so step k
  -- means "the k-th time they did something", not "the k-th time a tab opened".
  vk as (
    select v.user_id, v.day,
           row_number() over (partition by v.user_id order by v.first_at)::int as k
      from v
  ),
  -- At risk for step k only once visit k has had its grace period (0279's
  -- per-visit censoring, unchanged).
  atrisk as (
    select vk.k, vk.user_id,
           exists (select 1 from vk v2 where v2.user_id = vk.user_id and v2.k = vk.k + 1) as continued
      from vk
     where vk.day <= current_date - v_grace
       and vk.k <= v_max
  )
  select a.k,
         count(*)::int,
         sum(a.continued::int)::int,
         round(sum(a.continued::int)::numeric / nullif(count(*), 0), 4),
         v_since,
         v_floor
    from atrisk a
   group by a.k
   order by a.k;
end $$;

revoke all on function public.admin_survival_curve(date, int, int, boolean, boolean, boolean, int)
  from public, anon;
grant execute on function public.admin_survival_curve(date, int, int, boolean, boolean, boolean, int)
  to authenticated;

comment on function public.admin_survival_curve(date, int, int, boolean, boolean, boolean, int) is
  'Conditional survival by VISIT: P(reach visit k+1 | reached visit k), on the '
  '_admin_visits definition (UTC-midnight sittings merged, passive-only days '
  'dropped). Per-visit grace censoring as in 0279. p_require_work renumbers '
  'among work visits and clamps p_since to the did_work floor. Admin only.';

-- ── 3. Gap to the second visit, in hours ───────────────────────────────────
drop function if exists public.admin_return_gap(date, boolean, boolean);

create function public.admin_return_gap(
  p_since date default '2026-06-16',
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2
)
returns table (
  bucket text,
  lo int,
  n int,
  pct numeric,
  cum_pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-06-16'::date);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
  ),
  -- Hours from the END of visit one to the START of visit two. Whole days
  -- rounded the same sitting to "next day"; hours say whether a nudge at T+24h
  -- lands before or after the person has already come back on their own.
  gaps as (
    select extract(epoch from (v2.first_at - v1.last_at)) / 3600.0 as h
      from v v1
      join v v2 on v2.user_id = v1.user_id and v2.k = 2
     where v1.k = 1
  ),
  binned as (
    select case
             when h <= 6   then 'under 6h'
             when h <= 24  then '6-24h'
             when h <= 48  then '1-2 days'
             when h <= 72  then '2-3 days'
             when h <= 168 then '3-7 days'
             when h <= 336 then '1-2 weeks'
             when h <= 720 then '2-4 weeks'
             else '4+ weeks'
           end as bucket,
           case
             when h <= 6 then 0 when h <= 24 then 6 when h <= 48 then 24
             when h <= 72 then 48 when h <= 168 then 72 when h <= 336 then 168
             when h <= 720 then 336 else 720
           end as lo
      from gaps
  ),
  counted as (
    select b.bucket, b.lo, count(*)::int as n from binned b group by b.bucket, b.lo
  )
  select c.bucket, c.lo, c.n,
         round(c.n::numeric / nullif(sum(c.n) over (), 0), 4),
         round(sum(c.n) over (order by c.lo)::numeric / nullif(sum(c.n) over (), 0), 4)
    from counted c
   order by c.lo;
end $$;

revoke all on function public.admin_return_gap(date, boolean, boolean, int)
  from public, anon;
grant execute on function public.admin_return_gap(date, boolean, boolean, int)
  to authenticated;

comment on function public.admin_return_gap(date, boolean, boolean, int) is
  'Distribution of the gap from the end of visit 1 to the start of visit 2, in '
  'hours, among people who made a second visit (_admin_visits definition). lo '
  'is the bucket floor in hours. Admin only.';

-- ── 4. Fixed-horizon return — the number that can move ─────────────────────
create function public.admin_return_fixed_horizon(
  p_since date default '2026-06-16',
  p_horizon_days int default 7,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2,
  p_weeks int default 12
)
returns table (
  dim text,
  n int,
  returned int,
  pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-06-16'::date);
  v_h int      := least(greatest(coalesce(p_horizon_days, 7), 1), 90);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
  ),
  -- At risk: the first visit is at least the horizon old, so everyone counted
  -- has had the full window. Returned: visit two BEGAN inside the window.
  ret as (
    select f.user_id, f.first_at, f.day,
           exists (
             select 1 from v v2
              where v2.user_id = f.user_id and v2.k = 2
                and v2.first_at <= f.first_at + make_interval(days => v_h)
           ) as returned
      from v f
     where f.k = 1
       and f.day <= current_date - v_h
  ),
  -- Day-one depth: genuine card_placed rows in the first 24 hours (the seed's
  -- cards carry a non-user actor and are excluded).
  d1 as (
    select r.user_id, count(e.id)::int as cards
      from ret r
      join auth.users usr on usr.id = r.user_id
      left join public.analytics_events e
        on e.user_id = r.user_id
       and e.event = 'card_placed'
       and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by r.user_id
  ),
  -- Device: the most common device_type the client stamped on day one.
  -- auth_session_ready is too sparse to use for this.
  dev as (
    select r.user_id, mode() within group (order by e.props->>'device_type') as device
      from ret r
      join auth.users usr on usr.id = r.user_id
      join public.analytics_events e
        on e.user_id = r.user_id
       and e.props ? 'device_type'
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by r.user_id
  ),
  -- First source, from the first-touch attribution stamped at sign-in.
  src as (
    select r.user_id,
           case
             when p.first_source->>'referrer_host' ilike '%chatgpt%'
               or p.first_source->>'utm_source' in ('chatgpt.com', 'openai')          then 'chatgpt'
             when p.first_source->>'share_token' is not null
               or p.first_source->>'utm_source' in ('share_link', 'public_board')
               or p.first_source->>'landing_path' like '/share/%'                    then 'share'
             when p.first_source->>'landing_path' like '/vs/%'
               or p.first_source->>'landing_path' like '/best/%'
               or p.first_source->>'landing_path' like '/tools/%'                    then 'seo'
             when p.first_source->>'referrer_host' ilike '%google.%'                then 'google'
             when p.first_source->>'referrer_host' ilike '%reddit%'                 then 'reddit'
             when coalesce(p.first_source->>'referrer_host', '') = ''               then 'direct'
             else 'other'
           end as source
      from ret r
      left join public.profiles p on p.user_id = r.user_id
  ),
  rows_ as (
    select 'all'::text as dim, r.returned from ret r
    union all
    select 'device:' || coalesce(d.device, 'unknown'), r.returned
      from ret r left join dev d on d.user_id = r.user_id
    union all
    select 'source:' || s.source, r.returned
      from ret r join src s on s.user_id = r.user_id
    union all
    select 'band:' || case
             when c.cards = 0 then '0' when c.cards <= 2 then '1-2'
             when c.cards <= 5 then '3-5' when c.cards <= 12 then '6-12' else '13+' end,
           r.returned
      from ret r join d1 c on c.user_id = r.user_id
    union all
    select 'week:' || to_char(date_trunc('week', r.day), 'YYYY-MM-DD'), r.returned
      from ret r
     where r.day >= current_date - (7 * v_weeks)
  )
  select x.dim,
         count(*)::int,
         sum(x.returned::int)::int,
         round(sum(x.returned::int)::numeric / nullif(count(*), 0), 4)
    from rows_ x
   group by x.dim
   order by x.dim;
end $$;

revoke all on function public.admin_return_fixed_horizon(date, int, boolean, boolean, int, int)
  from public, anon;
grant execute on function public.admin_return_fixed_horizon(date, int, boolean, boolean, int, int)
  to authenticated;

comment on function public.admin_return_fixed_horizon(date, int, boolean, boolean, int, int) is
  'Share of first visits (at least p_horizon_days old) whose second visit began '
  'within p_horizon_days, on the _admin_visits definition, split by device, '
  'first source, day-one card band and signup week. The read that can move '
  'inside a fortnight, unlike the unbounded pooled step. Admin only.';

-- ── 5. Prove the grants, and that no overload survived ─────────────────────
do $$
begin
  if has_function_privilege('anon', 'public._admin_visits(date, boolean, boolean, int)', 'execute')
     or has_function_privilege('authenticated', 'public._admin_visits(date, boolean, boolean, int)', 'execute') then
    raise exception '0322: _admin_visits is callable by a client role';
  end if;
  if has_function_privilege('anon', 'public.admin_survival_curve(date, int, int, boolean, boolean, boolean, int)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_survival_curve(date, int, int, boolean, boolean, boolean, int)', 'execute') then
    raise exception '0322: admin_survival_curve grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.admin_return_gap(date, boolean, boolean, int)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_return_gap(date, boolean, boolean, int)', 'execute') then
    raise exception '0322: admin_return_gap grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.admin_return_fixed_horizon(date, int, boolean, boolean, int, int)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_return_fixed_horizon(date, int, boolean, boolean, int, int)', 'execute') then
    raise exception '0322: admin_return_fixed_horizon grants are wrong';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('admin_survival_curve', 'admin_return_gap')
              group by p.proname having count(*) > 1) then
    raise exception '0322: an old overload of admin_survival_curve/admin_return_gap survived';
  end if;
end $$;
