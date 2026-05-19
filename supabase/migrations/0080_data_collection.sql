-- 0080_data_collection.sql
-- Close the five biggest measurement gaps in one pass:
--   1. Acquisition source (UTM + referrer) on profiles
--   2. Activation columns + triggers (first_{board,card,share,backlink,paid}_at)
--   3. user_active_day for retention-cohort math
--   4. stripe_webhook_events full audit log
--   5. feedback table for the in-app feedback widget
-- Plus admin RPCs to query each: cohorts, acquisition breakdown,
-- activation funnel.

------------------------------------------------------------------
-- 1. profiles — acquisition + activation columns
------------------------------------------------------------------
alter table public.profiles
  add column if not exists first_source       jsonb        not null default '{}'::jsonb,
  add column if not exists first_board_at     timestamptz,
  add column if not exists first_card_at      timestamptz,
  add column if not exists first_share_at     timestamptz,
  add column if not exists first_backlink_at  timestamptz,
  add column if not exists first_paid_at      timestamptz;

create index if not exists profiles_first_paid_at_idx on public.profiles (first_paid_at) where first_paid_at is not null;

------------------------------------------------------------------
-- set_first_source — called from the frontend once per session
-- to stamp acquisition data on the caller's profile. No-op if a
-- non-empty source is already set (first-touch wins).
------------------------------------------------------------------
create or replace function public.set_first_source(p_source jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_source is null or p_source = '{}'::jsonb then return; end if;
  update public.profiles
     set first_source = p_source
   where user_id = v_uid
     and (first_source is null or first_source = '{}'::jsonb);
end $$;
revoke all on function public.set_first_source(jsonb) from public;
grant execute on function public.set_first_source(jsonb) to authenticated;

------------------------------------------------------------------
-- 2. Activation triggers
------------------------------------------------------------------
create or replace function public._stamp_first_board()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    update public.profiles
       set first_board_at = coalesce(first_board_at, now())
     where user_id = new.created_by
       and first_board_at is null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_first_board on public.boards;
create trigger profiles_first_board after insert on public.boards
  for each row execute function public._stamp_first_board();

create or replace function public._stamp_first_card()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  -- Attribute to the inserting user if known (auth.uid() inside RLS
  -- triggers usually is), else to the workspace owner.
  v_owner := coalesce(auth.uid(),
    (select w.created_by from public.workspaces w where w.id = new.workspace_id));
  if v_owner is not null then
    update public.profiles
       set first_card_at = coalesce(first_card_at, now())
     where user_id = v_owner
       and first_card_at is null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_first_card on public.card_index;
create trigger profiles_first_card after insert on public.card_index
  for each row execute function public._stamp_first_card();

create or replace function public._stamp_first_share()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.invited_by is not null then
    update public.profiles
       set first_share_at = coalesce(first_share_at, now())
     where user_id = new.invited_by
       and first_share_at is null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_first_share on public.board_shares;
create trigger profiles_first_share after insert on public.board_shares
  for each row execute function public._stamp_first_share();

create or replace function public._stamp_first_backlink()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  v_owner := coalesce(auth.uid(),
    (select w.created_by from public.workspaces w where w.id = new.source_workspace_id));
  if v_owner is not null then
    update public.profiles
       set first_backlink_at = coalesce(first_backlink_at, now())
     where user_id = v_owner
       and first_backlink_at is null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_first_backlink on public.doc_backlinks;
create trigger profiles_first_backlink after insert on public.doc_backlinks
  for each row execute function public._stamp_first_backlink();

create or replace function public._stamp_first_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    update public.profiles
       set first_paid_at = coalesce(first_paid_at, now())
     where user_id = new.user_id
       and first_paid_at is null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_first_paid on public.subscriptions;
create trigger profiles_first_paid after insert on public.subscriptions
  for each row execute function public._stamp_first_paid();

-- Backfill first-touch columns from existing data so the admin
-- charts have something to plot on day one.
update public.profiles p set first_board_at = sub.t
  from (select created_by, min(created_at) as t from public.boards where created_by is not null group by created_by) sub
 where p.user_id = sub.created_by and p.first_board_at is null;

update public.profiles p set first_card_at = sub.t
  from (
    select w.created_by, min(ci.updated_at) as t
      from public.card_index ci
      join public.workspaces w on w.id = ci.workspace_id
     where w.created_by is not null
     group by w.created_by
  ) sub
 where p.user_id = sub.created_by and p.first_card_at is null;

update public.profiles p set first_share_at = sub.t
  from (select invited_by, min(created_at) as t from public.board_shares where invited_by is not null group by invited_by) sub
 where p.user_id = sub.invited_by and p.first_share_at is null;

update public.profiles p set first_backlink_at = sub.t
  from (
    select w.created_by, min(db.updated_at) as t
      from public.doc_backlinks db
      join public.workspaces w on w.id = db.source_workspace_id
     where w.created_by is not null
     group by w.created_by
  ) sub
 where p.user_id = sub.created_by and p.first_backlink_at is null;

update public.profiles p set first_paid_at = sub.t
  from (
    select user_id, min(updated_at) as t
      from public.subscriptions
     where status in ('active', 'trialing', 'past_due', 'canceled')
       and plan is not null
     group by user_id
  ) sub
 where p.user_id = sub.user_id and p.first_paid_at is null;

------------------------------------------------------------------
-- 3. user_active_day — one row per (user, day) for retention math
------------------------------------------------------------------
create table if not exists public.user_active_day (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
create index if not exists user_active_day_user_idx on public.user_active_day (user_id);
create index if not exists user_active_day_day_idx  on public.user_active_day (day);
alter table public.user_active_day enable row level security;
-- Reads via admin RPCs only. No policies → default deny for direct PostgREST.

-- Extend bump_seconds_in_app to also stamp today's active-day row.
-- Same arg list as 0079; the only diff is the upsert at the end.
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
    if p_user_id is not null then
      update public.profiles
         set seconds_in_app = seconds_in_app + v_credit
       where user_id = p_user_id;
      -- Mark this user active today. Tiny upsert; O(1).
      insert into public.user_active_day (user_id, day)
        values (p_user_id, current_date)
        on conflict (user_id, day) do nothing;
    end if;
  end if;
  return v_credit;
end $$;
revoke all on function public.bump_seconds_in_app(int, uuid, uuid) from public;
grant execute on function public.bump_seconds_in_app(int, uuid, uuid) to anon, authenticated;

------------------------------------------------------------------
-- 4. stripe_webhook_events — durable log of every Stripe event
------------------------------------------------------------------
create table if not exists public.stripe_webhook_events (
  id          uuid primary key default gen_random_uuid(),
  stripe_id   text unique,  -- evt_xxx; null only for synthetic test rows
  type        text not null,
  user_id     uuid references auth.users on delete set null,
  payload     jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists stripe_webhook_events_type_time on public.stripe_webhook_events (type, received_at desc);
create index if not exists stripe_webhook_events_user_time on public.stripe_webhook_events (user_id, received_at desc) where user_id is not null;
alter table public.stripe_webhook_events enable row level security;

------------------------------------------------------------------
-- 5. feedback — in-app feedback widget
------------------------------------------------------------------
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete set null,
  kind        text not null check (kind in ('bug', 'idea', 'praise', 'other')),
  message     text not null,
  url         text,
  viewport    text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists feedback_kind_time on public.feedback (kind, created_at desc);
alter table public.feedback enable row level security;
-- Submission is via the SECURITY DEFINER Edge function; reads are
-- via the admin RPC below. Default deny on direct PostgREST.

create or replace function public.admin_list_feedback(
  p_limit  int default 100,
  p_offset int default 0,
  p_kind   text default null
)
returns table(
  id         uuid,
  user_id    uuid,
  email      text,
  kind       text,
  message    text,
  url        text,
  viewport   text,
  user_agent text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 500));
  p_offset := greatest(0, p_offset);
  return query
  select f.id, f.user_id, u.email::text, f.kind, f.message, f.url, f.viewport, f.user_agent, f.created_at
    from public.feedback f
    left join auth.users u on u.id = f.user_id
   where (p_kind is null or f.kind = p_kind)
   order by f.created_at desc
   limit p_limit offset p_offset;
end $$;
revoke all on function public.admin_list_feedback(int, int, text) from public;
grant execute on function public.admin_list_feedback(int, int, text) to authenticated;

------------------------------------------------------------------
-- 6. admin_retention_cohorts — weekly cohort × days-since-signup grid
--
-- Returns one row per (cohort_week, day_offset). Cohort = signup
-- week (monday-anchored). day_offset = days after signup. value =
-- fraction of cohort users active on that day_offset (0..1).
------------------------------------------------------------------
create or replace function public.admin_retention_cohorts(p_window_days int default 60)
returns table(
  cohort_week date,
  day_offset  int,
  cohort_size int,
  active_n    int,
  active_pct  numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  return query
  with cohorts as (
    select date_trunc('week', u.created_at)::date as cohort_week,
           u.id as user_id
      from auth.users u
     where u.created_at >= now() - (p_window_days || ' days')::interval
  ),
  sizes as (
    select cohort_week, count(*)::int as cohort_size
      from cohorts
     group by cohort_week
  ),
  matrix as (
    select c.cohort_week,
           (a.day - c.cohort_week)::int as day_offset,
           count(distinct c.user_id)::int as active_n
      from cohorts c
      join public.user_active_day a on a.user_id = c.user_id
     where a.day >= c.cohort_week
       and a.day <  c.cohort_week + p_window_days
     group by c.cohort_week, (a.day - c.cohort_week)
  )
  select m.cohort_week,
         m.day_offset,
         s.cohort_size,
         m.active_n,
         round(m.active_n::numeric / nullif(s.cohort_size, 0), 4) as active_pct
    from matrix m
    join sizes s using (cohort_week)
   order by m.cohort_week desc, m.day_offset asc;
end $$;
revoke all on function public.admin_retention_cohorts(int) from public;
grant execute on function public.admin_retention_cohorts(int) to authenticated;

------------------------------------------------------------------
-- 7. admin_acquisition_breakdown — count by first_source.utm_source
------------------------------------------------------------------
create or replace function public.admin_acquisition_breakdown()
returns table(
  source       text,
  signups      int,
  converted    int,
  conversion   numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  with src as (
    select coalesce(nullif(p.first_source->>'utm_source', ''),
                    nullif(p.first_source->>'referrer', ''),
                    'direct') as source,
           p.first_paid_at is not null as paid
      from public.profiles p
  )
  select source,
         count(*)::int as signups,
         sum(case when paid then 1 else 0 end)::int as converted,
         round(sum(case when paid then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as conversion
    from src
   group by source
   order by signups desc;
end $$;
revoke all on function public.admin_acquisition_breakdown() from public;
grant execute on function public.admin_acquisition_breakdown() to authenticated;

------------------------------------------------------------------
-- 8. admin_activation_funnel — count of profiles with each first_X_at set
------------------------------------------------------------------
create or replace function public.admin_activation_funnel()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object(
    'signed_up',        (select count(*) from public.profiles),
    'first_board',      (select count(*) from public.profiles where first_board_at    is not null),
    'first_card',       (select count(*) from public.profiles where first_card_at     is not null),
    'first_share',      (select count(*) from public.profiles where first_share_at    is not null),
    'first_backlink',   (select count(*) from public.profiles where first_backlink_at is not null),
    'first_paid',       (select count(*) from public.profiles where first_paid_at     is not null)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.admin_activation_funnel() from public;
grant execute on function public.admin_activation_funnel() to authenticated;
