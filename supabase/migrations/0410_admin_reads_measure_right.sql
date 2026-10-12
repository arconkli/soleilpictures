-- 0410 — The Retention view's return curve can measure work-days, as its
-- caption says (audit ADMIN-10).
--
-- The "Return curve" panel is captioned "Work-days, not app-open days", but
-- admin_retention_curve (last defined in 0149) has no work filter: it counts a
-- day as returned when ANY user_active_day row exists, and about half of those
-- rows carry no work event. It sits beside work-gated panels (return rate,
-- habit curve, cohort matrix), so it disagreed with them by construction.
--
-- This adds p_require_work (default false, so the 0149 behaviour is unchanged
-- for any caller that does not ask). With it, a day counts only if it has
-- did_work, and the grid starts at the first did_work day: did_work was only
-- recorded from 2026-08-17, and before that every row reads "no work", which is
-- not the same as "didn't come back" (the 0399 floor, same reason).
--
-- A new argument is a new signature, so the 3-argument function is DROPPED,
-- not replaced: left in place beside a 4-argument one whose last argument has a
-- default, a 3-argument call would be ambiguous to PostgREST. DROP discards the
-- ACL, so the grants are restated and the block at the end proves them. The
-- client asks with p_require_work and falls back to the 3-argument call (and a
-- presence caption) when the function does not know it, so it works on either
-- side of this migration.

begin;

drop function if exists public.admin_retention_curve(integer, boolean, boolean);

create or replace function public.admin_retention_curve(
  p_window_days integer default 30,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_require_work boolean default false
)
returns table(segment text, day_offset integer, eligible integer, active integer, active_pct numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_track_start date;
  v_work_floor  date;
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  -- 0410: work was only recorded from the first did_work day; before it every
  -- row reads "no work", which is not the same as "didn't come back".
  if p_require_work then
    select min(a.day) into v_work_floor from public.user_active_day a where a.did_work;
    v_track_start := greatest(v_track_start, coalesce(v_work_floor, current_date));
  end if;
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day,
           coalesce(p.tier, 'demo') as tier
      from auth.users usr
      left join public.profiles p on p.user_id = usr.id
     where (not p_verified_only or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  grid as (
    select u.user_id, u.tier, d.day_offset, (u.signup_day + d.day_offset) as cal_day
      from u
      cross join generate_series(0, p_window_days) as d(day_offset)
     where u.signup_day + d.day_offset <= current_date
       and u.signup_day + d.day_offset >= v_track_start
  ),
  marked as (
    select g.day_offset, g.tier,
           exists (select 1 from public.user_active_day a
                    where a.user_id = g.user_id and a.day = g.cal_day
                      and (not p_require_work or a.did_work)) as is_active
      from grid g
  ),
  seg as (
    select 'all'::text as segment, m.day_offset, m.is_active from marked m
    union all
    select m.tier, m.day_offset, m.is_active from marked m where m.tier in ('demo', 'paid')
  )
  select s.segment, s.day_offset,
         count(*)::int as eligible,
         sum(case when s.is_active then 1 else 0 end)::int as active,
         round(sum(case when s.is_active then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as active_pct
    from seg s
   group by s.segment, s.day_offset
   order by s.segment, s.day_offset;
end $function$;

revoke execute on function public.admin_retention_curve(integer, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_retention_curve(integer, boolean, boolean, boolean) to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.admin_retention_curve(integer,boolean,boolean)') is not null then
    raise exception '0410: the 3-argument admin_retention_curve is still there';
  end if;
  if has_function_privilege('anon', 'public.admin_retention_curve(integer,boolean,boolean,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_retention_curve(integer,boolean,boolean,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_retention_curve(integer,boolean,boolean,boolean)', 'execute') then
    raise exception '0410: grants are wrong on admin_retention_curve';
  end if;
end $$;

commit;
