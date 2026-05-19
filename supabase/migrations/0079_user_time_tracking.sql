-- 0079_user_time_tracking.sql
-- Per-user "time spent on platform" accounting.
--
-- The existing bump_seconds_in_app(p_seconds, p_session_id) RPC only
-- updates the global platform_counters.total_seconds_in_app counter.
-- Extending it with an optional p_user_id so the same heartbeat call
-- can ALSO credit the user's own column. Adds a seconds_in_app column
-- on profiles for that, and exposes the value to the admin Users tab
-- via admin_list_users.
--
-- Note: this is going-forward only. Until each user's tab makes its
-- first authenticated heartbeat after this deploys, their column
-- stays at 0. No backfill is possible — we have no historical data
-- at per-user granularity.

------------------------------------------------------------------
-- 1. profiles.seconds_in_app
------------------------------------------------------------------
alter table public.profiles
  add column if not exists seconds_in_app bigint not null default 0;

------------------------------------------------------------------
-- 2. bump_seconds_in_app — same shape as before, with optional user_id
------------------------------------------------------------------
create or replace function public.bump_seconds_in_app(
  p_seconds    int,
  p_session_id uuid default null,
  p_user_id    uuid default null
)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamptz := now();
  v_sess   record;
  v_credit int;
  v_age    interval;
begin
  if p_seconds is null or p_seconds <= 0 then return 0; end if;
  p_seconds := least(p_seconds, 60);

  if p_session_id is null then
    v_credit := least(p_seconds, 5);
  else
    insert into public.heartbeat_session (session_id, window_start, seconds_used, last_bumped_at)
      values (p_session_id, v_now, 0, v_now)
      on conflict (session_id) do nothing;
    select window_start, seconds_used into v_sess
      from public.heartbeat_session
     where session_id = p_session_id
     for update;
    v_age := v_now - v_sess.window_start;
    if v_age > interval '60 seconds' then
      v_credit := p_seconds;
      update public.heartbeat_session
         set window_start = v_now, seconds_used = v_credit, last_bumped_at = v_now
       where session_id = p_session_id;
    else
      v_credit := greatest(0, least(p_seconds, 60 - v_sess.seconds_used));
      if v_credit > 0 then
        update public.heartbeat_session
           set seconds_used = seconds_used + v_credit, last_bumped_at = v_now
         where session_id = p_session_id;
      end if;
    end if;
  end if;

  if v_credit > 0 then
    update public.platform_counters
       set value = value + v_credit, updated_at = v_now
     where key = 'total_seconds_in_app';
    -- Credit the user's column too if we know who they are.
    if p_user_id is not null then
      update public.profiles
         set seconds_in_app = seconds_in_app + v_credit
       where user_id = p_user_id;
    end if;
  end if;
  return v_credit;
end $$;
revoke all on function public.bump_seconds_in_app(int, uuid, uuid) from public;
grant execute on function public.bump_seconds_in_app(int, uuid, uuid) to anon, authenticated;

-- Drop the v3 two-arg signature so the old overload doesn't silently
-- bypass per-user crediting.
do $$ begin
  perform 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bump_seconds_in_app'
      and pg_get_function_identity_arguments(p.oid) = 'p_seconds integer, p_session_id uuid';
  if found then
    execute 'drop function public.bump_seconds_in_app(int, uuid)';
  end if;
exception when others then null; end $$;

------------------------------------------------------------------
-- 3. admin_list_users — add seconds_in_app to the returned shape
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
  seconds_in_app       bigint,
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
    coalesce(p.seconds_in_app, 0)::bigint      as seconds_in_app,
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
end $$;
revoke all on function public.admin_list_users(int, int, text, text) from public;
grant execute on function public.admin_list_users(int, int, text, text) to authenticated;
