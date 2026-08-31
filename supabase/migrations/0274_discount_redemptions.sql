-- 0274 — discount_redemptions: a durable record of who redeemed which code.
--
-- WHY THIS TABLE EXISTS. subscriptions.discount is a SNAPSHOT of the
-- subscription's CURRENT discount, not a ledger. Stripe detaches a
-- `duration: 'once'` coupon once it has been applied to an invoice, so the
-- next customer.subscription.updated webhook recomputes discount as null and
-- overwrites the record. Attribution for a first-month promo therefore
-- survives about one billing period unless it is captured at checkout, which
-- is what stripe-webhook now does.
--
-- Written ONLY by stripe-webhook via the service role. There is deliberately
-- no INSERT/UPDATE/DELETE policy — the service role bypasses RLS, and every
-- other caller is left with nothing to use. Same posture as subscriptions (0065).

create table if not exists public.discount_redemptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid references auth.users on delete cascade,
  stripe_promotion_code_id text,           -- promo_… (the ID, NOT the code string)
  stripe_coupon_id         text,
  stripe_session_id        text unique,    -- idempotency: Stripe retries webhooks
  stripe_subscription_id   text,
  plan                     text check (plan is null or plan in ('monthly','annual')),
  percent_off              numeric,
  amount_off_cents         integer,
  redeemed_at              timestamptz not null default now()
);

create index if not exists discount_redemptions_promo_idx
  on public.discount_redemptions(stripe_promotion_code_id);
create index if not exists discount_redemptions_user_idx
  on public.discount_redemptions(user_id);

alter table public.discount_redemptions enable row level security;

-- Table-level grants are NOT implicit here. `revoke from public` does not cover
-- anon, so both roles are named explicitly; authenticated gets SELECT only and
-- RLS narrows that to admins.
revoke all on public.discount_redemptions from anon, authenticated;
grant select on public.discount_redemptions to authenticated;

drop policy if exists "discount redemptions read admin" on public.discount_redemptions;
create policy "discount redemptions read admin" on public.discount_redemptions
  for select using (public.is_admin());
