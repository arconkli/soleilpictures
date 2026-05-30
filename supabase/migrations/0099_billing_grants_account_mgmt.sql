-- 0099_billing_grants_account_mgmt.sql
--
-- Closes four billing-correctness gaps where profiles.tier (access) and Stripe
-- (money) were only loosely coupled:
--
--   A. Grant visibility — get_my_tier() now also reports whether the caller's
--      paid access is an admin grant and when it ends, so the Billing UI can say
--      "Complimentary Creator access" instead of pretending it's a paid sub.
--   B. Downgrade safety — admin_set_tier() refuses to demote a user who still has
--      an active Stripe subscription (the UI cancels it first via the
--      admin-account-action edge fn), and revokes any active grant on downgrade
--      so a comped user isn't silently left with a live grant.
--   C. Ban/Delete — profiles gains banned_at/by/reason; get_my_tier() reports
--      `banned` so the client can hard-block suspended users. (The actual
--      ban/unban/delete + Stripe cancel happen in the admin-account-action edge
--      fn, which needs the service role + Stripe SDK.)
--   D. Honest MRR — subscriptions gains monthly_amount_cents (real net recurring
--      amount, discounts applied) + discount jsonb; admin_stats() sums the real
--      amount (falling back to list price for legacy rows) so 100%-off comps
--      count as $0. Grant-only users already have no subscriptions row, so they
--      were already excluded.
--
-- Drift note: the LIVE admin_list_users returns an extra seconds_in_app column
-- that never made it into 0070's file — this migration preserves it. get_my_tier
-- and admin_list_users change their return shape, so they're DROP+CREATE (you
-- can't CREATE OR REPLACE a function whose OUT columns changed).

------------------------------------------------------------------
-- 0. Schema additions (all additive / idempotent)
------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists monthly_amount_cents integer,        -- net monthly-equivalent, discounts applied
  add column if not exists discount              jsonb;          -- {coupon, percent_off|amount_off, duration} or null

alter table public.profiles
  add column if not exists banned_at     timestamptz,
  add column if not exists banned_by     uuid references auth.users on delete set null,
  add column if not exists banned_reason text;

------------------------------------------------------------------
-- A + C. get_my_tier — add grant_active / grant_expires_at / banned
------------------------------------------------------------------
drop function if exists public.get_my_tier();
create function public.get_my_tier()
returns table(
  tier                 text,
  demo_card_count      integer,
  subscription_status  text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean,
  grant_active         boolean,
  grant_expires_at     timestamptz,
  banned               boolean
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(p.tier, 'demo')::text,
    coalesce(p.demo_card_count, 0)::integer,
    s.status::text,
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false),
    (gr.hit is not null)            as grant_active,
    gr.gexp                         as grant_expires_at,
    (p.banned_at is not null)       as banned
  from auth.users u
  left join public.profiles p      on p.user_id = u.id
  left join public.subscriptions s on s.user_id = u.id
  -- Most-generous active grant: prefer "forever" (null expiry), else furthest out.
  left join lateral (
    select 1 as hit, g.expires_at as gexp
    from public.paid_grants g
    where g.user_id = u.id
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
    order by (g.expires_at is null) desc, g.expires_at desc
    limit 1
  ) gr on true
  where u.id = auth.uid()
  limit 1;
$$;
revoke all on function public.get_my_tier() from public;
grant execute on function public.get_my_tier() to authenticated;

------------------------------------------------------------------
-- B. admin_set_tier — block demoting an actively-billed user; revoke
--    any active grant when downgrading to demo/waitlist.
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

  -- Downgrades: never strand an active Stripe subscription still billing the
  -- customer. The admin Users action cancels billing first (admin-account-action),
  -- which flips status to 'canceled' so this guard then passes.
  if p_tier in ('demo', 'waitlist') then
    if exists (
      select 1 from public.subscriptions
      where user_id = p_user_id and status in ('active', 'trialing')
    ) then
      raise exception 'user has an active Stripe subscription — cancel it first'
        using errcode = '42501';
    end if;
    -- Pull any complimentary grant too, so they don't quietly stay grant-paid.
    update public.paid_grants
       set revoked_at = now(), revoked_by = auth.uid()
     where user_id = p_user_id and revoked_at is null;
  end if;

  insert into public.profiles (user_id, tier)
  values (p_user_id, p_tier)
  on conflict (user_id) do update set tier = excluded.tier;
end;
$$;
revoke all on function public.admin_set_tier(uuid, text) from public;
grant execute on function public.admin_set_tier(uuid, text) to authenticated;

------------------------------------------------------------------
-- C. admin_list_users — add banned + billing detail (keeps the live
--    seconds_in_app column). New columns appended at the end.
------------------------------------------------------------------
drop function if exists public.admin_list_users(integer, integer, text, text);
create function public.admin_list_users(
  p_limit  int default 50,
  p_offset int default 0,
  p_query  text default null,
  p_tier   text default null
)
returns table(
  user_id                  uuid,
  email                    text,
  tier                     text,
  demo_card_count          int,
  seconds_in_app           bigint,
  created_at               timestamptz,
  last_sign_in_at          timestamptz,
  subscription_plan        text,
  subscription_status      text,
  current_period_end       timestamptz,
  subscription_amount_cents int,
  subscription_discounted  boolean,
  banned                   boolean
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
    s.current_period_end                       as current_period_end,
    s.monthly_amount_cents                     as subscription_amount_cents,
    (s.discount is not null)                   as subscription_discounted,
    (p.banned_at is not null)                  as banned
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

------------------------------------------------------------------
-- D. admin_stats — MRR from real net amounts; comped/discounted context
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
    -- MRR = real net monthly revenue. Use the captured net amount (discounts
    -- applied; 100%-off comps = 0); fall back to list price for legacy rows
    -- that predate monthly_amount_cents (refreshed on their next webhook).
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
    -- Paid-tier users with no active paying sub = comped (grant-backed).
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
end;
$$;
revoke all on function public.admin_stats() from public;
grant execute on function public.admin_stats() to authenticated;
