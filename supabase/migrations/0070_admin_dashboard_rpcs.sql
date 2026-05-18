-- 0070_admin_dashboard_rpcs.sql — RPCs powering /admin's Overview + Users
-- tabs. All are SECURITY DEFINER and gate on profiles.tier='admin'
-- (raising 42501 for non-admins). Also adds an admin-read RLS policy
-- on public.profiles so ad-hoc SQL Editor work as an admin is pleasant.
--
-- Also formalizes user_id_by_email which has been called by code
-- (ShareModal, admin-waitlist-action) for a while but only existed in
-- the live DB via a one-off SQL Editor run — never in a migration.

------------------------------------------------------------------
-- 0. user_id_by_email — formalize the existing helper
------------------------------------------------------------------
create or replace function public.user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where email = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.user_id_by_email(text) from public;
grant execute on function public.user_id_by_email(text) to authenticated;

------------------------------------------------------------------
-- 1. admin-read profiles policy
-- Lets admins SELECT every profile via direct PostgREST queries.
-- (RPCs below are SECURITY DEFINER so they bypass RLS anyway; this
-- policy is the convenience layer for SQL Editor + future ad-hoc reads.)
------------------------------------------------------------------
drop policy if exists "admin read all profiles" on public.profiles;
create policy "admin read all profiles" on public.profiles for select using (
  exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.tier = 'admin')
);

------------------------------------------------------------------
-- 2. Internal helper — assert the caller is admin (raises 42501)
------------------------------------------------------------------
create or replace function public._require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
declare v_tier text;
begin
  select tier into v_tier from public.profiles where user_id = auth.uid();
  if v_tier is null or v_tier <> 'admin' then
    raise exception 'admin only' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public._require_admin() from public;

------------------------------------------------------------------
-- 3. admin_stats — one round trip for the Overview KPI cards
--
-- Returns:
--   {
--     total_users:       int,
--     new_users_7d:      int,                   -- delta vs week ago
--     tier_counts:       { admin, paid, demo, waitlist },
--     sub_counts:        { active, canceled, past_due, ... },
--     mrr_cents:         int,                   -- monthly equivalent
--     waitlist_pending:  int,
--     waitlist_total:    int
--   }
------------------------------------------------------------------
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  perform public._require_admin();

  select jsonb_build_object(
    'total_users',     (select count(*) from auth.users),
    'new_users_7d',    (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'tier_counts',     coalesce((select jsonb_object_agg(tier, n) from (
                          select tier, count(*) as n from public.profiles group by tier
                        ) t), '{}'::jsonb),
    'sub_counts',      coalesce((select jsonb_object_agg(status, n) from (
                          select status, count(*) as n
                          from public.subscriptions
                          where status is not null
                          group by status
                        ) s), '{}'::jsonb),
    -- MRR = monthly-equivalent revenue from active/trialing subs.
    -- Monthly subs contribute $25/mo, annual subs contribute $20/mo (=$240/yr ÷ 12).
    'mrr_cents',       coalesce((
                          select sum(case
                            when plan = 'monthly' then 2500
                            when plan = 'annual'  then 2000
                            else 0
                          end)::int
                          from public.subscriptions
                          where status in ('active', 'trialing')
                        ), 0),
    'waitlist_pending',(select count(*) from public.waitlist_entries where status = 'pending'),
    'waitlist_total',  (select count(*) from public.waitlist_entries)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.admin_stats() from public;
grant execute on function public.admin_stats() to authenticated;

------------------------------------------------------------------
-- 4. admin_signups_by_day — bar-chart data for the last N days
------------------------------------------------------------------
create or replace function public.admin_signups_by_day(p_days int default 30)
returns table(day date, signups int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));   -- clamp 1..365

  return query
  select d::date as day, coalesce(c.n, 0)::int as signups
  from generate_series(
    current_date - (p_days - 1),
    current_date,
    '1 day'::interval
  ) d
  left join (
    select date_trunc('day', created_at)::date as day, count(*)::int as n
    from auth.users
    where created_at >= (current_date - (p_days - 1))::timestamptz
    group by 1
  ) c on c.day = d::date
  order by day asc;
end;
$$;
revoke all on function public.admin_signups_by_day(int) from public;
grant execute on function public.admin_signups_by_day(int) to authenticated;

------------------------------------------------------------------
-- 5. admin_waitlist_funnel — daily (submitted, accepted) pairs
------------------------------------------------------------------
create or replace function public.admin_waitlist_funnel(p_days int default 30)
returns table(day date, submitted int, accepted int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));

  return query
  select d::date as day,
         coalesce(s.n, 0)::int as submitted,
         coalesce(a.n, 0)::int as accepted
  from generate_series(
    current_date - (p_days - 1),
    current_date,
    '1 day'::interval
  ) d
  left join (
    select date_trunc('day', created_at)::date as day, count(*)::int as n
    from public.waitlist_entries
    where created_at >= (current_date - (p_days - 1))::timestamptz
    group by 1
  ) s on s.day = d::date
  left join (
    select date_trunc('day', accepted_at)::date as day, count(*)::int as n
    from public.waitlist_entries
    where accepted_at is not null
      and accepted_at >= (current_date - (p_days - 1))::timestamptz
    group by 1
  ) a on a.day = d::date
  order by day asc;
end;
$$;
revoke all on function public.admin_waitlist_funnel(int) from public;
grant execute on function public.admin_waitlist_funnel(int) to authenticated;

------------------------------------------------------------------
-- 6. admin_list_users — paginated, filterable user list
--
-- Joins auth.users + public.profiles + public.subscriptions.
-- Sorted by created_at desc (newest first).
------------------------------------------------------------------
create or replace function public.admin_list_users(
  p_limit  int default 50,
  p_offset int default 0,
  p_query  text default null,
  p_tier   text default null
)
returns table(
  user_id              uuid,
  email                text,
  tier                 text,
  demo_card_count      int,
  created_at           timestamptz,
  last_sign_in_at      timestamptz,
  subscription_plan    text,
  subscription_status  text,
  current_period_end   timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_t text := nullif(trim(coalesce(p_tier,  '')), '');
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 200));
  p_offset := greatest(0, p_offset);

  return query
  select
    u.id                                       as user_id,
    u.email::text                              as email,
    coalesce(p.tier, 'demo')::text             as tier,
    coalesce(p.demo_card_count, 0)::int        as demo_card_count,
    u.created_at                               as created_at,
    u.last_sign_in_at                          as last_sign_in_at,
    s.plan::text                               as subscription_plan,
    s.status::text                             as subscription_status,
    s.current_period_end                       as current_period_end
  from auth.users u
  left join public.profiles      p on p.user_id = u.id
  left join public.subscriptions s on s.user_id = u.id
  where (v_q is null or u.email ilike '%' || v_q || '%')
    and (v_t is null or coalesce(p.tier, 'demo') = v_t)
  order by u.created_at desc nulls last
  limit p_limit
  offset p_offset;
end;
$$;
revoke all on function public.admin_list_users(int, int, text, text) from public;
grant execute on function public.admin_list_users(int, int, text, text) to authenticated;

------------------------------------------------------------------
-- 7. admin_user_count — total rows matching the same filters
------------------------------------------------------------------
create or replace function public.admin_user_count(
  p_query text default null,
  p_tier  text default null
)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_t text := nullif(trim(coalesce(p_tier,  '')), '');
  v_n bigint;
begin
  perform public._require_admin();

  select count(*) into v_n
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where (v_q is null or u.email ilike '%' || v_q || '%')
    and (v_t is null or coalesce(p.tier, 'demo') = v_t);
  return v_n;
end;
$$;
revoke all on function public.admin_user_count(text, text) from public;
grant execute on function public.admin_user_count(text, text) to authenticated;

------------------------------------------------------------------
-- 8. admin_set_tier — flip a user's tier
--
-- Self-demotion is blocked at the server so admins can't accidentally
-- lock themselves out. Upserts the profile row if it's missing (rare,
-- only happens if ensure_profile_for_new_user ever fails).
------------------------------------------------------------------
create or replace function public.admin_set_tier(p_user_id uuid, p_tier text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();

  if p_user_id = auth.uid() then
    raise exception 'you cannot change your own tier' using errcode = '42501';
  end if;
  if p_tier not in ('admin', 'paid', 'demo', 'waitlist') then
    raise exception 'invalid tier %', p_tier using errcode = '22023';
  end if;

  insert into public.profiles (user_id, tier)
  values (p_user_id, p_tier)
  on conflict (user_id) do update set tier = excluded.tier;
end;
$$;
revoke all on function public.admin_set_tier(uuid, text) from public;
grant execute on function public.admin_set_tier(uuid, text) to authenticated;
