-- 0851_admin_people_skip_service.sql
--
-- Service accounts (profiles.is_service: the identities MCP drafts are built
-- under) aren't people, and admin_stats has always left them out. Two readers
-- counted them anyway: admin_signups_by_day, and _admin_people, the list of
-- people behind admin_kpi_summary, admin_weekly_series, admin_growth_series,
-- admin_lifetime_totals, admin_recent_signups, admin_email_impact and
-- _admin_share_ledger. Both now skip them always, as admin_stats does.
--
-- Only the WHERE clauses change. CREATE OR REPLACE keeps each function's ACL,
-- and the block at the end proves it.

create or replace function public._admin_people(p_exclude_internal boolean, p_verified_only boolean)
 returns table(user_id uuid, created_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select u.id, u.created_at
    from auth.users u
   where (not p_verified_only
          or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
     and (not p_exclude_internal
          or u.id not in (select iu.user_id from public._internal_user_ids() iu))
     and not exists (select 1 from public.profiles sp
                      where sp.user_id = u.id and coalesce(sp.is_service, false));
$function$;

create or replace function public.admin_signups_by_day(p_days integer default 30, p_verified_only boolean default true, p_exclude_internal boolean default false)
 returns table(day date, signups integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  select d::date as day, coalesce(c.n, 0)::int as signups
  from generate_series(
    current_date - (p_days - 1),
    current_date,
    '1 day'::interval
  ) d
  left join (
    select date_trunc('day', u.created_at)::date as day, count(*)::int as n
    from auth.users u
    where (not p_verified_only
           or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
      and (not p_exclude_internal
           or u.id not in (select iu.user_id from public._internal_user_ids() iu))
      and not exists (select 1 from public.profiles sp
                       where sp.user_id = u.id and coalesce(sp.is_service, false))
      and u.created_at >= (current_date - (p_days - 1))::timestamptz
    group by 1
  ) c on c.day = d::date
  order by day asc;
end $function$;

-- The 0311 habit: prove the grants.
do $$
begin
  if has_function_privilege('anon', 'public._admin_people(boolean, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public._admin_people(boolean, boolean)', 'execute') then
    raise exception '0851: _admin_people is callable by a client';
  end if;
  if has_function_privilege('anon', 'public.admin_signups_by_day(integer, boolean, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_signups_by_day(integer, boolean, boolean)', 'execute') then
    raise exception '0851: admin_signups_by_day grants changed (admins call it signed in; it checks _require_admin)';
  end if;
end $$;
