-- 0361 — grade a day-one change on whether people came back to BUILD, and read
-- it the next day instead of a week later.
--
-- Two reads, both shaped (dim, n, returned, pct) like admin_return_fixed_horizon
-- (0322) and admin_engaged_return (0347), so the deck's FixedHorizonTable draws
-- them with no new chart idiom and the three can be read side by side.
--
-- 1. admin_built_return — 0322's question, "did the second visit begin within
--    N days?", answered with a visit that held WORK (0347's `worked`: a
--    WORK_EVENTS event inside it). About half of the people the honest
--    fixed-horizon read counts as returned came back only to look — a
--    restored board on desktop for a few seconds. A change that produces more
--    glances "wins" on the any-visit read; it can only win this one by
--    producing people who make something.
--
-- 2. admin_second_sitting — the share of first visits that hold a second
--    SITTING: real activity resuming after a break of 30+ minutes inside visit 1
--    (usually a couple of hours later, same device, often the same tab, with no
--    referrer — no email or link brought them back). It is the strongest
--    day-one marker of returning we have found, it replicated on an earlier
--    holdout cohort, and it is readable the day after a signup instead of eight
--    days after. The 'link:' rows keep the claim honest by re-measuring it:
--    7-day return with and without a second sitting, inside depth bands, for
--    cohorts old enough to have answered.
--    _admin_visits (0322) merges every sitting on a day into visit k=1 by
--    design, so this is invisible to the honest-return reads — and its
--    first_at/last_at span includes passive telemetry (session_summary fires on
--    every tab hide since 2026-08-31), which made "first-session length" look
--    like the discriminator. Sittings here are counted over NON-passive events
--    only. 0322 itself is not touched: the deck reads it, and a page load is a
--    real fact.
--
-- Day-one depth for these reads is the CARD count (card_placed props.n — an
-- import places many cards in one event), seed/template/system placements
-- excluded, in the 0322 bands. Source buckets are 0347's, copied, so a row here
-- lines up with the same row in the engaged read.

-- ── 1. Sittings inside the first visit ─────────────────────────────────────
create function public._admin_day_one_sittings(
  p_since date,
  p_exclude_internal boolean,
  p_verified_only boolean,
  p_merge_hours int,
  p_gap_minutes int
)
returns table (
  user_id uuid,
  first_day date,
  first_at timestamptz,
  sittings int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with v1 as (
    select v.user_id, v.day, v.first_at, v.last_at
      from public._admin_visits(p_since, p_exclude_internal, p_verified_only, p_merge_hours) v
     where v.k = 1
  ),
  -- 0322's passive list, plus the two summaries that also fire on their own
  -- schedule (an upsell exposure summary and a share-page dwell beacon).
  ev as (
    select v1.user_id, e.occurred_at,
           lag(e.occurred_at) over (partition by v1.user_id order by e.occurred_at) as prev_at
      from v1
      join public.analytics_events e
        on e.user_id = v1.user_id
       and e.occurred_at between v1.first_at and v1.last_at
       and e.event not in (
         'ps_heartbeat', 'ps_pause', 'ps_trace', 'session_summary', 'up_suppressed',
         'experiment_enrolled', 'ps_tier_resolved', 'lp_trace', 'app_trace', 'up_trace',
         'ps_seed_skip', 'ps_seed_start', 'ps_seed_done', 'instant_entry_skip',
         'lp_dwell', 'landing_dwell', 'pricing_dwell', 'ps_end', 'telemetry_drop',
         'up_exposure_summary', 'share_dwell'
       )
  )
  select v1.user_id, v1.day, v1.first_at,
         (1 + count(ev.prev_at) filter (
                where ev.occurred_at - ev.prev_at > make_interval(mins => greatest(coalesce(p_gap_minutes, 30), 5))
              ))::int as sittings
    from v1
    left join ev on ev.user_id = v1.user_id
   group by v1.user_id, v1.day, v1.first_at
$$;

revoke execute on function public._admin_day_one_sittings(date, boolean, boolean, int, int)
  from public, anon, authenticated;

comment on function public._admin_day_one_sittings(date, boolean, boolean, int, int) is
  'Internal. One row per first visit (_admin_visits k=1) with the number of '
  'sittings in it: 1 + the gaps longer than p_gap_minutes between consecutive '
  'NON-passive events. Not callable by clients.';

-- ── 2. Day-one second sitting ──────────────────────────────────────────────
create function public.admin_second_sitting(
  p_since date default '2026-08-17',
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2,
  p_weeks int default 12,
  p_gap_minutes int default 30
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
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
  v_gap int    := least(greatest(coalesce(p_gap_minutes, 30), 5), 240);
begin
  perform public._require_admin();

  return query
  with s as (
    select * from public._admin_day_one_sittings(v_since, p_exclude_internal, p_verified_only, v_merge, v_gap)
     -- A first visit still in progress could gain a sitting; read finished days only.
     where first_day <= current_date - 1
  ),
  v as (
    select * from public._admin_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
  ),
  base as (
    select s.user_id, s.first_day, (s.sittings >= 2) as two_sit,
           -- 0322's 7-day return, only for first visits at least 8 days old.
           case when s.first_day <= current_date - 8 then
             exists (select 1 from v v2
                      where v2.user_id = s.user_id and v2.k = 2
                        and v2.first_at <= s.first_at + interval '7 days')
           end as ret7
      from s
  ),
  d1 as (
    select b.user_id,
           coalesce(sum(case when e.props->>'n' ~ '^[0-9]{1,6}$' then (e.props->>'n')::int else 1 end), 0)::int as cards
      from base b
      join auth.users usr on usr.id = b.user_id
      left join public.analytics_events e
        on e.user_id = b.user_id
       and e.event = 'card_placed'
       and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by b.user_id
  ),
  dev as (
    select b.user_id, mode() within group (order by e.props->>'device_type') as device
      from base b
      join auth.users usr on usr.id = b.user_id
      join public.analytics_events e
        on e.user_id = b.user_id
       and e.props ? 'device_type'
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by b.user_id
  ),
  src as (
    select b.user_id,
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
      from base b
      left join public.profiles p on p.user_id = b.user_id
  ),
  banded as (
    select b.*,
           case when c.cards = 0 then '0' when c.cards <= 2 then '1-2'
                when c.cards <= 5 then '3-5' when c.cards <= 12 then '6-12' else '13+' end as band,
           case when c.cards <= 2 then '0-2' when c.cards <= 12 then '3-12' else '13+' end as band3
      from base b
      join d1 c on c.user_id = b.user_id
  ),
  rows_ as (
    -- returned = HAD A SECOND SITTING
    select 'all'::text as dim, b.two_sit as hit from base b
    union all
    select 'device:' || coalesce(d.device, 'unknown'), b.two_sit
      from base b left join dev d on d.user_id = b.user_id
    union all
    select 'source:' || s2.source, b.two_sit
      from base b join src s2 on s2.user_id = b.user_id
    union all
    select 'band:' || x.band, x.two_sit from banded x
    union all
    select 'week:' || to_char(date_trunc('week', b.first_day), 'YYYY-MM-DD'), b.two_sit
      from base b
     where b.first_day >= current_date - (7 * v_weeks)
    union all
    -- returned = BACK WITHIN 7 DAYS, split by sittings inside a depth band
    select 'link:' || x.band3 || (case when x.two_sit then ' · two+ sittings' else ' · one sitting' end), x.ret7
      from banded x
     where x.ret7 is not null
  )
  select x.dim,
         count(*)::int,
         sum(x.hit::int)::int,
         round(sum(x.hit::int)::numeric / nullif(count(*), 0), 4)
    from rows_ x
   group by x.dim
   order by x.dim;
end $$;

revoke all on function public.admin_second_sitting(date, boolean, boolean, int, int, int)
  from public, anon;
grant execute on function public.admin_second_sitting(date, boolean, boolean, int, int, int)
  to authenticated;

comment on function public.admin_second_sitting(date, boolean, boolean, int, int, int) is
  'Share of finished first visits holding a second sitting (non-passive activity '
  'resuming after p_gap_minutes). Dims all/device/source/band/week: returned = had '
  'a second sitting. Dims link:<band> · <sittings>: returned = honest 7-day return, '
  'cohorts 8+ days old. Defaults to 2026-08-17. Admin only.';

-- ── 3. Built fixed-horizon return ──────────────────────────────────────────
-- 0322's at-risk set (first visits at least the horizon old), returned only when
-- a LATER visit inside the horizon held work. Same dims as 0322/0347.
create function public.admin_built_return(
  p_since date default '2026-08-17',
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
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_h int      := least(greatest(coalesce(p_horizon_days, 7), 1), 90);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_engaged_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
  ),
  ret as (
    select f.user_id, f.first_at, f.day,
           exists (
             select 1 from v v2
              where v2.user_id = f.user_id and v2.k >= 2 and v2.worked
                and v2.first_at <= f.first_at + make_interval(days => v_h)
           ) as returned
      from v f
     where f.k = 1
       and f.day <= current_date - v_h
  ),
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

revoke all on function public.admin_built_return(date, int, boolean, boolean, int, int)
  from public, anon;
grant execute on function public.admin_built_return(date, int, boolean, boolean, int, int)
  to authenticated;

comment on function public.admin_built_return(date, int, boolean, boolean, int, int) is
  'admin_return_fixed_horizon where only a later visit that held WORK (0347 worked: '
  'a WORK_EVENTS event) counts as a return. Same at-risk set and dims as 0322. '
  'Defaults to 2026-08-17, the usage_session epoch. Admin only.';

-- ── 4. Proofs (0311 habit) ─────────────────────────────────────────────────
do $proof$
declare
  f text;
begin
  f := 'public._admin_day_one_sittings(date, boolean, boolean, integer, integer)';
  if has_function_privilege('anon', f, 'execute') then raise exception '% is executable by anon', f; end if;
  if has_function_privilege('authenticated', f, 'execute') then raise exception '% is executable by authenticated', f; end if;
  foreach f in array array['public.admin_second_sitting(date, boolean, boolean, integer, integer, integer)',
                           'public.admin_built_return(date, integer, boolean, boolean, integer, integer)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '% is executable by anon', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception '% is not executable by authenticated', f; end if;
  end loop;
end $proof$;
