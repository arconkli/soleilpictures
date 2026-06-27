-- 0167 — Conversion-gated paid-referrer reward.
--
-- Founder design: a referrer earns a free Creator month ONLY when the friend
-- they invited becomes a PAYING customer (not at signup, not at first card).
-- Self-funding (we only pay out when we gained a payer) and fraud-resistant
-- (fake signups can't pay). The existing +25-card activation reward
-- (grant_referral_reward, fired at first genuine card) is UNCHANGED.
--
-- Hook: _stamp_first_paid() already fires AFTER INSERT on subscriptions (the
-- exactly-once first-payment chokepoint — checkout creates no subscriptions row
-- before payment, so the first insert IS first payment). We add a guarded reward
-- call gated on an active subscription. Reward vehicle: the existing paid_grants
-- machinery, via a new non-admin SECURITY DEFINER wrapper (admin_grant_paid_access
-- is admin-only and REPLACES expiry; the reward must EXTEND). All hot-path calls
-- are wrapped so referral logic can never break the subscription write.
--
-- Applied to PROD via Supabase MCP as two migrations: this body
-- (`referral_paid_conversion_reward`) + `harden_stamp_first_paid_rpc` (the final
-- revoke). Kept together here for the record.

-- Per-referral bookkeeping for the paid reward (exactly-once + months granted).
alter table public.referrals add column if not exists paid_reward_granted_at timestamptz;
alter table public.referrals add column if not exists paid_reward_months int not null default 0;

-- Grant a user N free Creator months by EXTENDING (never shortening) their
-- paid_grants window. A forever grant (null expiry) stays forever. Resolves the
-- target's email (paid_grants is email-PK'd) and flips tier to paid. Callable
-- only from other SECURITY DEFINER code (EXECUTE revoked from clients).
create or replace function public._grant_paid_months(p_user_id uuid, p_months int)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_email text;
  v_days  int := greatest(coalesce(p_months, 1), 1) * 30;
begin
  if p_user_id is null then return; end if;
  select lower(trim(email::text)) into v_email from auth.users where id = p_user_id;
  if v_email is null or v_email = '' then return; end if;

  insert into public.paid_grants
    (email, user_id, expires_at, granted_at, granted_by, granted_by_email, revoked_at, revoked_by, note)
  values
    (v_email, p_user_id, now() + (v_days || ' days')::interval, now(),
     null, null, null, null, 'Referral reward: invited a paying friend')
  on conflict (email) do update set
    user_id    = coalesce(public.paid_grants.user_id, excluded.user_id),
    expires_at = case
                   when public.paid_grants.expires_at is null then null
                   else greatest(public.paid_grants.expires_at, now()) + (v_days || ' days')::interval
                 end,
    granted_at = now(),
    revoked_at = null,
    revoked_by = null,
    note       = 'Referral reward: invited a paying friend';

  update public.profiles set tier = 'paid'
   where user_id = p_user_id and tier <> 'admin';
end $$;
revoke all on function public._grant_paid_months(uuid, int) from public, anon, authenticated;

-- When a referee becomes a paying customer, pay their referrer one free month.
-- Exactly-once per referee via referrals.paid_reward_granted_at. Rolling-30-day
-- cap (10) is an abuse backstop: over it, we record the conversion but grant 0
-- months and flag for admin review instead of auto-granting.
create or replace function public._grant_referral_paid_reward(p_referee uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_referrer uuid;
  v_recent   int;
  v_cap      int := 10;
begin
  update public.referrals
     set paid_reward_granted_at = now()
   where referee_id = p_referee and paid_reward_granted_at is null
  returning referrer_id into v_referrer;

  if v_referrer is null or v_referrer = p_referee then
    return;  -- no referral for this user, already processed, or self
  end if;

  select count(*) into v_recent
    from public.referrals
   where referrer_id = v_referrer
     and paid_reward_granted_at >= now() - interval '30 days';

  if v_recent > v_cap then
    update public.referrals set paid_reward_months = 0 where referee_id = p_referee;
    insert into public.analytics_events (user_id, event, props) values
      (v_referrer, 'referral_paid_reward_capped',
        jsonb_build_object('referee', p_referee, 'window_count', v_recent, 'cap', v_cap));
    return;
  end if;

  perform public._grant_paid_months(v_referrer, 1);
  update public.referrals set paid_reward_months = 1 where referee_id = p_referee;

  insert into public.analytics_events (user_id, event, props) values
    (p_referee,  'referral_referee_paid',        jsonb_build_object('referrer', v_referrer)),
    (v_referrer, 'referral_paid_reward_granted', jsonb_build_object('referee', p_referee, 'months', 1));
end $$;
revoke all on function public._grant_referral_paid_reward(uuid) from public, anon, authenticated;

-- Hook the reward into the first-payment chokepoint. Gated on an active
-- subscription; guarded so referral failure can never break payment activation.
create or replace function public._stamp_first_paid()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.user_id is not null then
    update public.profiles set first_paid_at = coalesce(first_paid_at, now())
     where user_id = new.user_id and first_paid_at is null;
    if new.status = 'active' then
      begin
        perform public._grant_referral_paid_reward(new.user_id);
      exception when others then null;
      end;
    end if;
  end if;
  return new;
end $$;

-- Surface the paid-reward funnel to the Invite & earn tab. TABLE-returning, so
-- DROP+recreate+regrant (can't add columns via CREATE OR REPLACE).
drop function if exists public.get_my_referral_stats();
create function public.get_my_referral_stats()
returns table(code text, friends_joined integer, friends_activated integer, pending integer,
              cards_earned integer, friends_paid integer, months_earned integer)
language sql stable security definer set search_path to 'public' as $$
  select
    (select referral_code from public.profiles where user_id = auth.uid()),
    count(*)::integer,
    count(*) filter (where status = 'activated')::integer,
    count(*) filter (where status = 'pending')::integer,
    (count(*) filter (where status = 'activated') * 25)::integer,
    count(*) filter (where paid_reward_granted_at is not null)::integer,
    coalesce(sum(paid_reward_months), 0)::integer
  from public.referrals where referrer_id = auth.uid();
$$;
grant execute on function public.get_my_referral_stats() to authenticated, anon, service_role;

-- harden_stamp_first_paid_rpc: _stamp_first_paid() is a trigger function (now
-- reward-sensitive). Trigger functions should never be RPC-callable; revoking
-- EXECUTE does NOT affect trigger firing (triggers run with the table owner's
-- rights, independent of the function EXECUTE ACL).
revoke all on function public._stamp_first_paid() from public, anon, authenticated;
