-- 0082_get_my_tier_cancel_at_period_end
--
-- Extends get_my_tier() to surface subscriptions.cancel_at_period_end so the
-- in-app Billing tab can show a "Cancels on <date>" state while the
-- subscription is still active (Stripe's normal cancel flow keeps status='active'
-- with cancel_at_period_end=true until the period rolls over).
--
-- Postgres can't CREATE OR REPLACE a function that changes its return type's
-- column list, so we drop and re-create. Same security/grants as the original
-- in 0065.

drop function if exists public.get_my_tier();

create or replace function public.get_my_tier()
returns table(
  tier text,
  demo_card_count integer,
  subscription_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(p.tier, 'demo')::text,
    coalesce(p.demo_card_count, 0)::integer,
    s.status::text,
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false)
  from auth.users u
  left join public.profiles p      on p.user_id = u.id
  left join public.subscriptions s on s.user_id = u.id
  where u.id = auth.uid()
  limit 1;
$$;
revoke all on function public.get_my_tier() from public;
grant execute on function public.get_my_tier() to authenticated;
