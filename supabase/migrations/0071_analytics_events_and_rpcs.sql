-- 0071_analytics_events_and_rpcs.sql — funnel + usage analytics layer.
--
-- Adds a lightweight append-only event log and 5 admin-only RPCs that
-- power the /admin Analytics tab (funnel, card usage, tier comparison,
-- top users by card count).
--
-- The events table is anon-INSERT to capture unauthed funnel steps
-- (landing_view, email_submit), and admin-only SELECT.

------------------------------------------------------------------
-- 1. analytics_events
------------------------------------------------------------------
create table if not exists public.analytics_events (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid,                                       -- client-generated, persists in localStorage
  user_id      uuid references auth.users on delete set null,
  event        text not null,
  props        jsonb not null default '{}'::jsonb,
  path         text,
  occurred_at  timestamptz not null default now()
);
create index if not exists events_event_time on public.analytics_events(event, occurred_at desc);
create index if not exists events_session    on public.analytics_events(session_id);
create index if not exists events_user_time  on public.analytics_events(user_id, occurred_at desc)
  where user_id is not null;

alter table public.analytics_events enable row level security;

drop policy if exists "anyone insert events" on public.analytics_events;
create policy "anyone insert events" on public.analytics_events
  for insert with check (true);

drop policy if exists "admin read events" on public.analytics_events;
create policy "admin read events" on public.analytics_events
  for select using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.tier = 'admin')
  );

------------------------------------------------------------------
-- 2. admin_event_funnel — counts per stage in the window
------------------------------------------------------------------
create or replace function public.admin_event_funnel(p_days int default 30)
returns table(event text, sessions bigint, users bigint, ord int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));

  return query
  with ev as (
    select * from public.analytics_events
    where occurred_at >= now() - (p_days || ' days')::interval
  ),
  stages(event, ord) as (
    values
      ('landing_view',         1),
      ('email_submit',         2),
      ('otp_verify',           3),
      ('welcome_view',         4),
      ('submit_socials_open',  5),
      ('submit_socials_done',  6),
      ('pricing_view',         7),
      ('checkout_open',        8),
      ('checkout_success',     9),
      ('app_open',            10)
  )
  select s.event,
         count(distinct ev.session_id) as sessions,
         count(distinct ev.user_id)    as users,
         s.ord
  from stages s
  left join ev on ev.event = s.event
  group by s.event, s.ord
  order by s.ord;
end;
$$;
revoke all on function public.admin_event_funnel(int) from public;
grant execute on function public.admin_event_funnel(int) to authenticated;

------------------------------------------------------------------
-- 3. admin_card_stats — total + breakdown by kind / tier
--
-- Returns:
--   {
--     total:        int,
--     by_kind:      { kind: n, ... },
--     by_tier:      { tier: n, ... },
--     kind_by_tier: { kind: { tier: n, ... }, ... }
--   }
------------------------------------------------------------------
create or replace function public.admin_card_stats(p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));

  with c as (
    select ci.kind, coalesce(p.tier, 'demo')::text as tier
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
    left join public.profiles p on p.user_id = b.created_by
    where ci.updated_at >= now() - (p_days || ' days')::interval
  )
  select jsonb_build_object(
    'total',        (select count(*) from c),
    'by_kind',      coalesce((select jsonb_object_agg(kind, n) from (
                       select kind, count(*) as n
                       from c group by kind
                     ) k), '{}'::jsonb),
    'by_tier',      coalesce((select jsonb_object_agg(tier, n) from (
                       select tier, count(*) as n
                       from c group by tier
                     ) t), '{}'::jsonb),
    'kind_by_tier', coalesce((select jsonb_object_agg(kind, by_t) from (
                       select kind, jsonb_object_agg(tier, n) as by_t
                       from (
                         select kind, tier, count(*) as n
                         from c group by kind, tier
                       ) inner_q
                       group by kind
                     ) kt), '{}'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.admin_card_stats(int) from public;
grant execute on function public.admin_card_stats(int) to authenticated;

------------------------------------------------------------------
-- 4. admin_cards_per_day — bar/line chart data
------------------------------------------------------------------
create or replace function public.admin_cards_per_day(p_days int default 30)
returns table(day date, cards int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));

  return query
  select d::date as day, coalesce(c.n, 0)::int as cards
  from generate_series(
    current_date - (p_days - 1),
    current_date,
    '1 day'::interval
  ) d
  left join (
    select date_trunc('day', updated_at)::date as day, count(*)::int as n
    from public.card_index
    where updated_at >= (current_date - (p_days - 1))::timestamptz
    group by 1
  ) c on c.day = d::date
  order by day asc;
end;
$$;
revoke all on function public.admin_cards_per_day(int) from public;
grant execute on function public.admin_cards_per_day(int) to authenticated;

------------------------------------------------------------------
-- 5. admin_tier_usage_compare — per-tier averages + totals
------------------------------------------------------------------
create or replace function public.admin_tier_usage_compare()
returns table(
  tier         text,
  users        bigint,
  avg_cards    numeric,
  avg_boards   numeric,
  total_cards  bigint,
  total_boards bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();

  return query
  with user_stats as (
    select
      coalesce(p.tier, 'demo')::text as tier,
      u.id as user_id,
      coalesce(
        (select count(*) from public.boards b where b.created_by = u.id),
        0
      )::bigint as board_count,
      coalesce(
        (select count(*) from public.card_index ci
         join public.boards b on b.id = ci.board_id
         where b.created_by = u.id),
        0
      )::bigint as card_count
    from auth.users u
    left join public.profiles p on p.user_id = u.id
  )
  select
    tier,
    count(*)::bigint as users,
    round(avg(card_count)::numeric, 1) as avg_cards,
    round(avg(board_count)::numeric, 1) as avg_boards,
    sum(card_count)::bigint as total_cards,
    sum(board_count)::bigint as total_boards
  from user_stats
  group by tier
  order by case tier
    when 'admin'    then 1
    when 'paid'     then 2
    when 'demo'     then 3
    when 'waitlist' then 4
    else 5
  end;
end;
$$;
revoke all on function public.admin_tier_usage_compare() from public;
grant execute on function public.admin_tier_usage_compare() to authenticated;

------------------------------------------------------------------
-- 6. admin_top_users — top N by card count, optional tier filter
------------------------------------------------------------------
create or replace function public.admin_top_users(
  p_tier  text default null,
  p_limit int  default 20
)
returns table(
  user_id          uuid,
  email            text,
  tier             text,
  card_count       bigint,
  board_count      bigint,
  created_at       timestamptz,
  last_sign_in_at  timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_t text := nullif(trim(coalesce(p_tier, '')), '');
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 100));

  return query
  select
    u.id                                    as user_id,
    u.email::text                           as email,
    coalesce(p.tier, 'demo')::text          as tier,
    coalesce(stats.card_count, 0)::bigint   as card_count,
    coalesce(stats.board_count, 0)::bigint  as board_count,
    u.created_at                            as created_at,
    u.last_sign_in_at                       as last_sign_in_at
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  left join lateral (
    select
      (select count(*) from public.boards b where b.created_by = u.id) as board_count,
      (select count(*) from public.card_index ci
         join public.boards b on b.id = ci.board_id
         where b.created_by = u.id) as card_count
  ) stats on true
  where (v_t is null or coalesce(p.tier, 'demo') = v_t)
  order by stats.card_count desc nulls last
  limit p_limit;
end;
$$;
revoke all on function public.admin_top_users(text, int) from public;
grant execute on function public.admin_top_users(text, int) to authenticated;
