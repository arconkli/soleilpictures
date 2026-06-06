-- 0120_activation_signal_and_retention_rpcs.sql
--
-- Make retention/activation MEASURABLE and honest. Three problems this fixes,
-- all confirmed against live data (2026-06-06):
--
--   1. The onboarding seed (onb-* starter cards) was being counted as
--      activation: _stamp_first_card stamped profiles.first_card_at on the
--      seed insert, so "first card" fired for users who never placed a real
--      card. Fix: the trigger now ignores onb-* cards (the client now also
--      suppresses card_placed for seeds — see firstValueTrigger.genuineCards +
--      App.jsx). first_card_at now means a GENUINE card.
--
--   2. The chosen activation bar is a POPULATED board (a board holding a few
--      real cards of their own), not a single card. New column
--      profiles.first_populated_board_at + a trigger that stamps it when any
--      board the user owns first reaches POP_BOARD_THRESHOLD (3) genuine cards.
--      Surfaced as a new step in admin_activation_funnel.
--
--   3. The admin Engagement view lacked the views needed to act on churn. Four
--      new read-only RPCs (same conventions as 0117: _require_admin(),
--      _internal_user_ids() exclusion, observable-window clamp, grant
--      authenticated): explicit D1/D7/D30 return rate, a per-user
--      last-seen/dormancy/resurrection roster, retention split by acquisition
--      source, and an event-coverage reconciliation (server truth vs client
--      events) that would have flagged the dead onboarding_first_card north-star
--      as a coverage gap rather than an activation collapse.

------------------------------------------------------------------
-- 1. De-contaminate first_card_at: ignore onboarding seeds
------------------------------------------------------------------
create or replace function public._stamp_first_card()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_owner uuid;
begin
  -- Onboarding starter cards (stable onb-* ids) are not activation.
  if new.card_id like 'onb-%' then return new; end if;
  v_owner := coalesce(auth.uid(),
    (select w.created_by from public.workspaces w where w.id = new.workspace_id));
  if v_owner is not null then
    update public.profiles set first_card_at = coalesce(first_card_at, now())
     where user_id = v_owner and first_card_at is null;
  end if;
  return new;
end $function$;

------------------------------------------------------------------
-- 2. Populated-board activation milestone (the chosen bar)
------------------------------------------------------------------
alter table public.profiles
  add column if not exists first_populated_board_at timestamptz;
create index if not exists profiles_first_populated_board_at_idx
  on public.profiles (first_populated_board_at) where first_populated_board_at is not null;

-- Stamp when a board the user owns first reaches >= 3 GENUINE (non-onb-) cards.
-- Threshold is the "a few real cards" bar; tune here if the definition changes.
create or replace function public._stamp_first_populated_board()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_owner   uuid;
  v_genuine int;
begin
  if new.card_id like 'onb-%' then return new; end if;       -- seeds never populate
  select b.created_by into v_owner from public.boards b where b.id = new.board_id;
  v_owner := coalesce(v_owner, auth.uid(),
    (select w.created_by from public.workspaces w where w.id = new.workspace_id));
  if v_owner is null then return new; end if;
  -- Cheap exit once stamped.
  if exists (select 1 from public.profiles
              where user_id = v_owner and first_populated_board_at is not null) then
    return new;
  end if;
  select count(*) into v_genuine
    from public.card_index ci
   where ci.board_id = new.board_id and ci.card_id not like 'onb-%';
  if v_genuine >= 3 then
    update public.profiles
       set first_populated_board_at = coalesce(first_populated_board_at, now())
     where user_id = v_owner and first_populated_board_at is null;
  end if;
  return new;
end $function$;
drop trigger if exists profiles_first_populated_board on public.card_index;
create trigger profiles_first_populated_board after insert on public.card_index
  for each row execute function public._stamp_first_populated_board();

-- Backfill from existing data (no-op today: max genuine-on-a-board is 2, but
-- correct if any board already qualifies). Approx crossing time = earliest
-- genuine-card updated_at on a qualifying board, min across the user's boards.
update public.profiles p set first_populated_board_at = sub.t
  from (
    select uid, min(board_t) as t from (
      select b.created_by as uid, ci.board_id,
             min(ci.updated_at) as board_t,
             count(*) filter (where ci.card_id not like 'onb-%') as genuine
        from public.card_index ci
        join public.boards b on b.id = ci.board_id
       where b.created_by is not null
       group by b.created_by, ci.board_id
    ) per_board
    where genuine >= 3
    group by uid
  ) sub
 where p.user_id = sub.uid and p.first_populated_board_at is null;

------------------------------------------------------------------
-- 3. admin_activation_funnel — add the populated_board step
------------------------------------------------------------------
create or replace function public.admin_activation_funnel(
  p_days integer, p_exclude_internal boolean default true
)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
#variable_conflict use_column
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  with p as (
    select pr.* from public.profiles pr join auth.users u on u.id = pr.user_id
     where u.email_confirmed_at is not null and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select jsonb_build_object(
    'signed_up',       (select count(*) from p),
    'first_board',     (select count(*) from p where first_board_at           is not null),
    'first_card',      (select count(*) from p where first_card_at            is not null),
    'populated_board', (select count(*) from p where first_populated_board_at is not null),
    'first_share',     (select count(*) from p where first_share_at           is not null),
    'first_backlink',  (select count(*) from p where first_backlink_at        is not null),
    'first_paid',      (select count(*) from p where first_paid_at            is not null)
  ) into v_out;
  return v_out;
end;
$function$;
revoke all on function public.admin_activation_funnel(integer, boolean) from public;
grant execute on function public.admin_activation_funnel(integer, boolean) to authenticated;

------------------------------------------------------------------
-- 4. admin_return_rate — explicit D1/D7/D30, observable-window clamped
--   eligible    : users for whom (signup + N) has elapsed AND was observable
--   returned_on : active on exactly day N  (classic Dn retention)
--   returned_within: active on ANY day in (0, N]  (came back at all by Dn)
-- The frontend greys out an offset whose eligible count is too small to trust
-- (today D7/D30 eligible ~= 1, so only D1 is real).
------------------------------------------------------------------
create or replace function public.admin_return_rate(p_exclude_internal boolean default true)
returns table(day_offset integer, eligible integer, returned_on integer, on_pct numeric,
              returned_within integer, within_pct numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_track_start date;
begin
  perform public._require_admin();
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day
      from auth.users usr
     where usr.email_confirmed_at is not null
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  offs(day_offset) as (values (1),(7),(30)),
  grid as (
    select u.user_id, o.day_offset, (u.signup_day + o.day_offset) as cal_day
      from u cross join offs o
     where (u.signup_day + o.day_offset) <= current_date
       and (u.signup_day + o.day_offset) >= v_track_start
  ),
  marked as (
    select g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day) as on_day,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id
                     and a.day >  (g.cal_day - g.day_offset)
                     and a.day <= g.cal_day) as within_w
      from grid g
  )
  select m.day_offset,
         count(*)::int,
         sum(case when m.on_day then 1 else 0 end)::int,
         round(sum(case when m.on_day then 1 else 0 end)::numeric / nullif(count(*), 0), 4),
         sum(case when m.within_w then 1 else 0 end)::int,
         round(sum(case when m.within_w then 1 else 0 end)::numeric / nullif(count(*), 0), 4)
    from marked m
   group by m.day_offset
   order by m.day_offset;
end $function$;
revoke all on function public.admin_return_rate(boolean) from public;
grant execute on function public.admin_return_rate(boolean) to authenticated;

------------------------------------------------------------------
-- 5. admin_user_dormancy — per-user last-seen / dormancy / resurrection roster
------------------------------------------------------------------
create or replace function public.admin_user_dormancy(p_exclude_internal boolean default true)
returns table(user_id uuid, email text, tier text, signup date, last_active_day date,
              days_dormant integer, active_day_count integer, did_card boolean,
              did_populated_board boolean, resurrected boolean)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public._require_admin();
  return query
  with base as (
    select u.id as uid, u.email::text as email, coalesce(p.tier, 'demo') as tier,
           u.created_at::date as signup,
           p.first_card_at is not null as did_card,
           p.first_populated_board_at is not null as did_pop
      from auth.users u
      left join public.profiles p on p.user_id = u.id
     where u.email_confirmed_at is not null
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  agg as (
    select a.user_id as uid, max(a.day) as last_day, count(distinct a.day)::int as ndays
      from public.user_active_day a group by a.user_id
  ),
  gaps as (
    select uid, bool_or(gap >= 7) as resurrected from (
      select a.user_id as uid,
             (a.day - lag(a.day) over (partition by a.user_id order by a.day)) as gap
        from public.user_active_day a
    ) s group by uid
  )
  select b.uid, b.email, b.tier, b.signup,
         ag.last_day,
         case when ag.last_day is not null then (current_date - ag.last_day) end,
         coalesce(ag.ndays, 0),
         b.did_card, b.did_pop,
         coalesce(g.resurrected, false)
    from base b
    left join agg ag on ag.uid = b.uid
    left join gaps g on g.uid = b.uid
   order by (case when ag.last_day is not null then (current_date - ag.last_day) end) desc nulls last, b.signup;
end $function$;
revoke all on function public.admin_user_dormancy(boolean) from public;
grant execute on function public.admin_user_dormancy(boolean) to authenticated;

------------------------------------------------------------------
-- 6. admin_retention_by_source — pooled retention curve grouped by acquisition
--    bucket (ad / referral / organic) from profiles.first_source.
------------------------------------------------------------------
create or replace function public.admin_retention_by_source(
  p_window_days integer default 30, p_exclude_internal boolean default true
)
returns table(source text, day_offset integer, eligible integer, active integer, active_pct numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_track_start date;
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day,
           case
             when (p.first_source->>'fbclid') is not null
                  or lower(coalesce(p.first_source->>'utm_source','')) ~ '(facebook|instagram|meta|fb|ig)'
                  or lower(coalesce(p.first_source->>'utm_medium','')) ~ '(cpc|paid|ad|social)'
               then 'ad'
             when coalesce(nullif(p.first_source->>'utm_source',''), nullif(p.first_source->>'referrer','')) is not null
               then 'referral'
             else 'organic'
           end as source
      from auth.users usr
      left join public.profiles p on p.user_id = usr.id
     where usr.email_confirmed_at is not null
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  grid as (
    select u.source, u.user_id, d.day_offset, (u.signup_day + d.day_offset) as cal_day
      from u cross join generate_series(0, p_window_days) as d(day_offset)
     where u.signup_day + d.day_offset <= current_date
       and u.signup_day + d.day_offset >= v_track_start
  ),
  marked as (
    select g.source, g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day) as is_active
      from grid g
  )
  select m.source, m.day_offset,
         count(*)::int,
         sum(case when m.is_active then 1 else 0 end)::int,
         round(sum(case when m.is_active then 1 else 0 end)::numeric / nullif(count(*), 0), 4)
    from marked m
   group by m.source, m.day_offset
   order by m.source, m.day_offset;
end $function$;
revoke all on function public.admin_retention_by_source(integer, boolean) from public;
grant execute on function public.admin_retention_by_source(integer, boolean) to authenticated;

------------------------------------------------------------------
-- 7. admin_event_coverage — reconcile server-side activation truth against
--    client analytics events, so a dead/lossy event reads as a COVERAGE gap
--    (not a real collapse). coverage_pct = client distinct-users / server truth.
------------------------------------------------------------------
create or replace function public.admin_event_coverage(
  p_days integer default 90, p_exclude_internal boolean default true
)
returns table(milestone text, server_truth integer, client_event integer, coverage_pct numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_since timestamptz;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  v_since := now() - (p_days || ' days')::interval;
  return query
  with eligible as (
    select u.id as uid from auth.users u
     where u.email_confirmed_at is not null and u.created_at >= v_since
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  prof as (select p.* from public.profiles p where p.user_id in (select uid from eligible)),
  ev as (
    select event, count(distinct user_id) as users
      from public.analytics_events
     where user_id in (select uid from eligible) and occurred_at >= v_since
     group by event
  ),
  m as (
    select 'first_card'::text as milestone,
           (select count(*) from prof where first_card_at is not null)::int as server_truth,
           'onboarding_first_card'::text as ev_name
    union all
    select 'populated_board',
           (select count(*) from prof where first_populated_board_at is not null)::int, 'activated'
    union all
    select 'first_share',
           (select count(*) from prof where first_share_at is not null)::int, 'share_open'
    union all
    select 'first_paid',
           (select count(*) from prof where first_paid_at is not null)::int, 'checkout_success'
  )
  select m.milestone, m.server_truth,
         coalesce((select e.users from ev e where e.event = m.ev_name), 0)::int as client_event,
         round(coalesce((select e.users from ev e where e.event = m.ev_name), 0)::numeric
               / nullif(m.server_truth, 0), 4) as coverage_pct
    from m
   order by m.milestone;
end $function$;
revoke all on function public.admin_event_coverage(integer, boolean) from public;
grant execute on function public.admin_event_coverage(integer, boolean) to authenticated;
