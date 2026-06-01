------------------------------------------------------------------
-- 0102_verified_users_only
--
-- A user is only "real" once they verify their email. signInWithOtp creates
-- an unconfirmed auth.users row the moment a code is requested, so a mistyped
-- email (andrew@andrewconkin.com vs …conklin.com) became a counted "user"
-- everywhere. Gate every user list / count on
-- auth.users.email_confirmed_at IS NOT NULL.
--
-- The login/onboarding flow is unchanged — Supabase still creates the
-- provisional row and ensure_profile_for_new_user still runs; we simply don't
-- show or count it until the email is verified. Bodies below are the current
-- live definitions with only the confirmation predicate added (tier breakdowns
-- filtered too, so totals stay internally consistent).
------------------------------------------------------------------

-- A. Admin Users list ------------------------------------------------------
create or replace function public.admin_list_users(
  p_limit integer default 50, p_offset integer default 0,
  p_query text default null, p_tier text default null)
returns table(user_id uuid, email text, tier text, card_count integer,
  seconds_in_app bigint, created_at timestamptz, last_sign_in_at timestamptz,
  subscription_plan text, subscription_status text, current_period_end timestamptz,
  subscription_amount_cents integer, subscription_discounted boolean, banned boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_t text := nullif(trim(coalesce(p_tier,  '')), '');
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 200));
  p_offset := greatest(0, p_offset);

  return query
  with owner_cards as (
    select b.created_by as uid, count(*)::int as card_count
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
    group by b.created_by
  )
  select
    u.id                                       as user_id,
    u.email::text                              as email,
    coalesce(p.tier, 'demo')::text             as tier,
    coalesce(oc.card_count, 0)::int            as card_count,
    coalesce(p.seconds_in_app, 0)::bigint      as seconds_in_app,
    u.created_at                               as created_at,
    u.last_sign_in_at                          as last_sign_in_at,
    s.plan::text                               as subscription_plan,
    s.status::text                             as subscription_status,
    s.current_period_end                       as current_period_end,
    s.monthly_amount_cents                     as subscription_amount_cents,
    (s.discount is not null)                   as subscription_discounted,
    (p.banned_at is not null)                  as banned
  from auth.users u
  left join public.profiles      p on p.user_id = u.id
  left join public.subscriptions s on s.user_id = u.id
  left join owner_cards          oc on oc.uid   = u.id
  where u.email_confirmed_at is not null
    and (v_q is null or u.email ilike '%' || v_q || '%')
    and (v_t is null or coalesce(p.tier, 'demo') = v_t)
  order by u.created_at desc nulls last
  limit p_limit
  offset p_offset;
end $$;

-- B. Admin Users pagination total -----------------------------------------
create or replace function public.admin_user_count(
  p_query text default null, p_tier text default null)
returns bigint language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_t text := nullif(trim(coalesce(p_tier,  '')), '');
  v_n bigint;
begin
  perform public._require_admin();
  select count(*) into v_n
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.email_confirmed_at is not null
    and (v_q is null or u.email ilike '%' || v_q || '%')
    and (v_t is null or coalesce(p.tier, 'demo') = v_t);
  return v_n;
end $$;

-- C. Overview / Command Center stats ---------------------------------------
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_out jsonb;
begin
  perform public._require_admin();

  select jsonb_build_object(
    'total_users',     (select count(*) from auth.users where email_confirmed_at is not null),
    'new_users_7d',    (select count(*) from auth.users
                          where email_confirmed_at is not null
                            and created_at >= now() - interval '7 days'),
    'tier_counts',     coalesce((select jsonb_object_agg(tier, n) from (
                          select p.tier, count(*) as n
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where u.email_confirmed_at is not null
                          group by p.tier
                        ) t), '{}'::jsonb),
    'sub_counts',      coalesce((select jsonb_object_agg(status, n) from (
                          select status, count(*) as n
                          from public.subscriptions
                          where status is not null
                          group by status
                        ) s), '{}'::jsonb),
    'mrr_cents',       coalesce((
                          select sum(coalesce(
                            monthly_amount_cents,
                            case when plan = 'monthly' then 2500
                                 when plan = 'annual'  then 2000
                                 else 0 end
                          ))::int
                          from public.subscriptions
                          where status in ('active', 'trialing')
                        ), 0),
    'comped_paid',     (select count(*) from public.profiles p
                          where p.tier = 'paid'
                            and not exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    'discounted_subs', (select count(*) from public.subscriptions
                          where status in ('active', 'trialing') and discount is not null),
    'waitlist_pending',(select count(*) from public.waitlist_entries where status = 'pending'),
    'waitlist_total',  (select count(*) from public.waitlist_entries)
  ) into v_out;
  return v_out;
end $$;

-- D. Signups-by-day chart ---------------------------------------------------
create or replace function public.admin_signups_by_day(p_days integer default 30)
returns table(day date, signups integer)
language plpgsql stable security definer set search_path to 'public' as $$
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
    select date_trunc('day', created_at)::date as day, count(*)::int as n
    from auth.users
    where email_confirmed_at is not null
      and created_at >= (current_date - (p_days - 1))::timestamptz
    group by 1
  ) c on c.day = d::date
  order by day asc;
end $$;

-- E. Universe ticker "+N users today" --------------------------------------
create or replace function public.admin_universe_stats()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_counters jsonb;
  v_today    jsonb;
  v_midnight timestamptz := date_trunc('day', now());
begin
  perform public._require_admin();
  select jsonb_object_agg(key, value) into v_counters from public.platform_counters;
  v_today := jsonb_build_object(
    'users',      (select count(*) from auth.users
                     where email_confirmed_at is not null and created_at >= v_midnight),
    'workspaces', (select count(*) from public.workspaces where created_at >= v_midnight),
    'boards',     (select count(*) from public.boards  where created_at >= v_midnight and deleted_at is null),
    'cards',      (select count(*) from public.card_index where updated_at >= v_midnight),
    'links',      (
      (select count(*) from public.entity_links where created_at >= v_midnight)
    + (select count(*) from public.doc_backlinks where updated_at >= v_midnight)
    )
  );
  return coalesce(v_counters, '{}'::jsonb) || jsonb_build_object('today', v_today);
end $$;

-- F. Daily metrics snapshot -------------------------------------------------
create or replace function public.capture_metrics_daily()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.metrics_daily (
    day, mrr_cents, total_users, paid_users, demo_users, waitlist_users,
    admin_users, signups, active_users, captured_at
  )
  select
    current_date,
    coalesce((
      select sum(coalesce(monthly_amount_cents,
               case when plan = 'monthly' then 2500
                    when plan = 'annual'  then 2000
                    else 0 end))::int
      from public.subscriptions where status in ('active', 'trialing')
    ), 0),
    (select count(*) from auth.users where email_confirmed_at is not null)::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and p.tier = 'paid')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and p.tier = 'demo')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and p.tier = 'waitlist')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and p.tier = 'admin')::int,
    (select count(*) from auth.users
       where email_confirmed_at is not null and created_at >= current_date)::int,
    (select count(*) from public.user_presence where last_seen_at >= current_date)::int,
    now()
  on conflict (day) do update set
    mrr_cents      = excluded.mrr_cents,
    total_users    = excluded.total_users,
    paid_users     = excluded.paid_users,
    demo_users     = excluded.demo_users,
    waitlist_users = excluded.waitlist_users,
    admin_users    = excluded.admin_users,
    signups        = excluded.signups,
    active_users   = excluded.active_users,
    captured_at    = excluded.captured_at;
end $$;

------------------------------------------------------------------
-- G. Live platform_counters.total_users — count CONFIRMED users only.
-- The provisional OTP insert is unconfirmed, so the +1 must happen when the
-- email is verified (the verifyOtp UPDATE that sets email_confirmed_at), not
-- on insert.
------------------------------------------------------------------

-- INSERT: only count rows that arrive already confirmed (rare).
create or replace function public._counter_users_ins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null then
    perform public._bump_counter('total_users', 1);
  end if;
  return new;
end $$;

-- DELETE: only un-count rows that were confirmed.
create or replace function public._counter_users_del()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is not null then
    perform public._bump_counter('total_users', -1);
  end if;
  return old;
end $$;

-- UPDATE: the verify transition (null -> not null) is where most users count.
create or replace function public._counter_users_confirm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public._bump_counter('total_users', 1);
  elsif old.email_confirmed_at is not null and new.email_confirmed_at is null then
    perform public._bump_counter('total_users', -1);
  end if;
  return new;
end $$;

-- Add the UPDATE-on-confirmation trigger (privilege-safe, like 0074's DELETE).
do $$
begin
  drop trigger if exists users_counter_confirm on auth.users;
  create trigger users_counter_confirm
    after update of email_confirmed_at on auth.users
    for each row execute function public._counter_users_confirm();
exception when insufficient_privilege then
  raise notice 'users_counter_confirm trigger skipped (insufficient privilege); nightly reconcile keeps total_users accurate';
end $$;

-- Correct the live counter immediately.
update public.platform_counters
   set value = (select count(*) from auth.users where email_confirmed_at is not null),
       updated_at = now()
 where key = 'total_users';

-- Nightly reconcile: count confirmed users only (rest unchanged).
create or replace function public._reconcile_universe_counters_full()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.platform_counters set value = (select count(*) from public.workspaces),                       updated_at = now() where key = 'total_workspaces';
  update public.platform_counters set value = (select count(*) from public.boards where deleted_at is null),  updated_at = now() where key = 'total_boards';
  update public.platform_counters set value = (select count(*) from public.card_index),                       updated_at = now() where key = 'total_cards';
  update public.platform_counters set value = (
    (select count(*) from public.entity_links) + (select count(*) from public.doc_backlinks)
  ), updated_at = now() where key = 'total_links';
  update public.platform_counters set value = (select count(*) from auth.users where email_confirmed_at is not null), updated_at = now() where key = 'total_users';
  perform public._reconcile_universe_counters();
end $$;
