-- 0399 — The work-gated return rate only counts days on which work was measured
-- (audit ADMIN-2).
--
-- admin_return_rate's grid starts at the first user_active_day row
-- (2026-05-19), but did_work was only recorded from 2026-08-17: every row
-- before that is false. With p_require_work (which the Retention view passes),
-- every signup whose return day fell in that gap counted as "never came back",
-- and D1/D7/D30 read roughly 40-45% low. admin_retention_cohort_matrix already
-- floors at the first did_work day; this does the same, and for "returned
-- within N days" it also requires the whole window to sit inside measured time.
--
-- Same signature, so create or replace keeps the ACL; the block proves it.

begin;

create or replace function public.admin_return_rate(p_exclude_internal boolean default true, p_verified_only boolean default true, p_require_work boolean default false)
returns table(day_offset integer, eligible integer, returned_on integer, on_pct numeric, returned_within integer, within_pct numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_track_start date;
  v_work_floor  date;
begin
  perform public._require_admin();
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  -- 0399: work was only recorded from the first did_work day; before it every
  -- row reads "no work", which is not the same as "didn't come back".
  if p_require_work then
    select min(a.day) into v_work_floor from public.user_active_day a where a.did_work;
    v_track_start := greatest(v_track_start, coalesce(v_work_floor, current_date));
  end if;
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day
      from auth.users usr
     where (not p_verified_only or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  offs(day_offset) as (values (1),(7),(30)),
  grid as (
    select u.user_id, o.day_offset, (u.signup_day + o.day_offset) as cal_day
      from u cross join offs o
     where (u.signup_day + o.day_offset) <= current_date
       and (u.signup_day + o.day_offset) >= v_track_start
       -- "within N days" looks at (signup_day, cal_day]: all of it measured.
       and (not p_require_work or u.signup_day >= v_track_start - 1)
  ),
  marked as (
    select g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day
                     and (not p_require_work or a.did_work)) as on_day,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id
                     and a.day >  (g.cal_day - g.day_offset)
                     and a.day <= g.cal_day
                     and (not p_require_work or a.did_work)) as within_w
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

do $$
begin
  if has_function_privilege('anon', 'public.admin_return_rate(boolean,boolean,boolean)', 'execute') then
    raise exception '0399: grants are wrong';
  end if;
end $$;

commit;
