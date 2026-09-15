-- 0327 — the money numbers learn what a trial is.
--
-- 0325 introduced a fourteen-day Creator trial. A trialing Stripe subscription
-- is a real subscription with a real list price attached and NO money behind
-- it, and four places in this schema were written before that was possible.
-- Each of them treats "has a live subscription" and "is paying" as the same
-- fact. They are not, and the gap is exactly a fortnight wide.
--
--   1. admin_stats.mrr_cents summed every subscription in ('active','trialing'),
--      so the first trial would have reported $25 of monthly recurring revenue
--      that does not exist and may never. The deck's headline revenue number.
--   2. capture_metrics_daily writes the same sum into metrics_daily, which is a
--      DAILY SNAPSHOT TABLE THAT IS NEVER BACKFILLED. A wrong row written today
--      is wrong forever. This is the one that had to land before the first
--      trial starts, not after.
--   3. _stamp_first_paid stamps profiles.first_paid_at on the first
--      subscriptions INSERT regardless of status. A trial inserts as
--      'trialing', so the column that every conversion readout means as "the
--      day they became a customer" would have been set on a day nobody paid.
--      Trial starts have their own honest column now (creator_trial_started_at).
--   4. The same trigger is the referral reward chokepoint, and it is AFTER
--      INSERT only, gated on new.status = 'active'. A trial INSERTs as
--      'trialing' and converts by UPDATE, so a referred friend who came through
--      the trial would never have paid their referrer the reward month — the
--      trigger simply never fires again after the insert it missed.
--
-- Deliberately NOT changed: subscriptions.monthly_amount_cents still records
-- the contracted price during a trial. It is the true price of the plan they
-- are on, stripe-webhook recomputes it on the trial->active transition, and
-- zeroing it at write time would lose the number rather than report it
-- correctly. The fix belongs in the readers, which is where it is.
--
-- Also deliberately NOT changed: comped_paid / subscribed_paid / discounted_subs
-- keep the wider ('active','trialing') set. Those count ACCESS, and a trialing
-- user genuinely has access. Only the money moves.

-- ── 1. first_paid_at means money, and the referral reward survives a trial ──
create or replace function public._stamp_first_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- 'active' is the only status that means a charge cleared. A trial is
  -- 'trialing' and is recorded by profiles.creator_trial_started_at (0325).
  if new.user_id is not null and new.status = 'active' then
    update public.profiles
       set first_paid_at = coalesce(first_paid_at, now())
     where user_id = new.user_id
       and first_paid_at is null;

    -- Edge-triggered so a later unrelated UPDATE does not re-enter, though
    -- _grant_referral_paid_reward is exactly-once on its own
    -- (referrals.paid_reward_granted_at is null), so re-entry is harmless.
    -- Wrapped because referral bookkeeping must never be able to break a
    -- subscription write.
    if tg_op = 'INSERT' or old.status is distinct from 'active' then
      begin
        perform public._grant_referral_paid_reward(new.user_id);
      exception when others then null;
      end;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public._stamp_first_paid() from public, anon, authenticated;

-- The trigger has to see the trial -> active transition, which is an UPDATE.
-- AFTER INSERT alone is why a trial conversion paid no referral reward.
drop trigger if exists profiles_first_paid on public.subscriptions;
create trigger profiles_first_paid
  after insert or update of status on public.subscriptions
  for each row execute function public._stamp_first_paid();

-- ── 2. admin_stats: revenue is money, and a trial is visible beside it ──────
create or replace function public.admin_stats(p_verified_only boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_out jsonb;
begin
  perform public._require_admin();

  select jsonb_build_object(
    'total_users',     (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))),
    'new_users_7d',    (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and u.created_at >= now() - interval '7 days'),
    'tier_counts',     coalesce((select jsonb_object_agg(tier, n) from (
                          select p.tier, count(*) as n
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                          group by p.tier
                        ) t), '{}'::jsonb),
    'total_seconds_in_app',
                       (select coalesce(sum(p.seconds_in_app), 0)::bigint
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))),
    'sub_counts',      coalesce((select jsonb_object_agg(status, n) from (
                          select status, count(*) as n
                          from public.subscriptions
                          where status is not null
                          group by status
                        ) s), '{}'::jsonb),
    -- MONEY ONLY. A trialing subscription carries the full list price and has
    -- collected nothing; counting it here reports revenue that has not arrived.
    'mrr_cents',       coalesce((
                          select sum(coalesce(
                            monthly_amount_cents,
                            case when plan = 'monthly' then 2500
                                 when plan = 'annual'  then 2000
                                 else 0 end
                          ))::int
                          from public.subscriptions
                          where status = 'active'
                        ), 0),
    -- …and the trials stay visible next to it, so a $0 month with three trials
    -- running reads as three trials rather than as nothing happening.
    'trialing_subs',   (select count(*) from public.subscriptions where status = 'trialing'),
    -- ACCESS, not money: a trialing user genuinely has the paid product, so
    -- these three keep the wider set.
    'comped_paid',     (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'paid'
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and not exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    'subscribed_paid', (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'paid'
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and exists (
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

revoke all on function public.admin_stats(boolean) from public, anon;
grant execute on function public.admin_stats(boolean) to authenticated, service_role;

-- ── 3. The daily snapshot, which is never backfilled ───────────────────────
create or replace function public.capture_metrics_daily()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.metrics_daily (
    day, mrr_cents, total_users, paid_users, demo_users, waitlist_users,
    admin_users, signups, active_users, captured_at
  )
  select
    current_date,
    -- 'active' only. metrics_daily rows are written once and never revisited,
    -- so a trial counted here would be permanently wrong revenue history.
    coalesce((
      select sum(coalesce(monthly_amount_cents,
               case when plan = 'monthly' then 2500
                    when plan = 'annual'  then 2000
                    else 0 end))::int
      from public.subscriptions where status = 'active'
    ), 0),
    (select count(*) from auth.users
       where email_confirmed_at is not null and last_sign_in_at is not null)::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'paid')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'demo')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'waitlist')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'admin')::int,
    (select count(*) from auth.users
       where email_confirmed_at is not null and last_sign_in_at is not null and created_at >= current_date)::int,
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
end;
$$;

revoke all on function public.capture_metrics_daily() from public, anon;
grant execute on function public.capture_metrics_daily() to service_role;

-- ── 4. admin_paid_reach counts the cards the CAP counts ────────────────────
--
-- 0324 banded people by count(*) of card_index rows grouped by the board's
-- creator. The wall charges neither of those things: enforce_demo_card_cap_trg
-- and get_my_tier both use sum(weight) grouped by the WORKSPACE owner (a grid
-- fill weighs more than one, and a card on a board you did not create still
-- counts against the workspace owner). A band defined as "at or near the cap"
-- has to be computed from the number the cap enforces or it is naming a
-- different population than the one hitting the wall.
create or replace function public.admin_paid_reach(
  p_since date default '2026-06-16',
  p_exclude_internal boolean default true
)
returns table (
  band text, band_order int, users bigint, saw_price bigint, price_seen bigint,
  saw_wall bigint, saw_banner bigint, saw_toast bigint, clicked bigint,
  blocked bigint, intent bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  with ext as (
    select p.user_id,
           p.card_cap_base + coalesce(p.bonus_card_credits, 0) as cap
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where u.created_at >= p_since
       and p.tier = 'demo'
       and not coalesce(p.is_service, false)
       and (not p_exclude_internal or p.user_id not in (select _internal_user_ids()))
  ),
  ci as (
    -- The enforcer's own expression (0187/0229/0325): weighted, and keyed on
    -- the workspace owner, who is the person the cap actually bills.
    select w.created_by as user_id, sum(c.weight)::int as cards
      from public.card_index c
      join public.boards b     on b.id = c.board_id
      join public.workspaces w on w.id = b.workspace_id
     group by 1
  ),
  ev as (
    select e.user_id,
           bool_or(e.event = 'pricing_view')                                          as saw_price,
           bool_or(e.event = 'price_seen')                                            as price_seen,
           bool_or(e.event = 'pricing_view' and e.props->>'header' = 'cap-hit')        as saw_wall,
           bool_or(e.event = 'first_value_upgrade_view')                              as saw_banner,
           bool_or(e.event = 'up_cap_toast_view')                                     as saw_toast,
           bool_or(e.event in ('up_chip_click', 'up_settings_upgrade_click'))         as clicked,
           -- demo_cap_cell is the grid-fill refusal: the same cap, the same
           -- wall, a different code path. Omitting it under-counted the people
           -- the ceiling actually stopped.
           bool_or(e.event = 'card_create_blocked'
                   and e.props->>'reason' in ('server_cap', 'demo_cap', 'demo_cap_cell')) as blocked,
           bool_or(e.event = 'pricing_creator_intent')                                as intent
      from public.analytics_events e
     where e.user_id is not null
       and e.event in ('pricing_view', 'price_seen', 'first_value_upgrade_view', 'up_cap_toast_view',
                       'up_chip_click', 'up_settings_upgrade_click', 'card_create_blocked',
                       'pricing_creator_intent')
     group by 1
  ),
  banded as (
    select e.user_id,
           case when coalesce(ci.cards, 0) >= 0.8 * e.cap then 'At or near the cap (>=80%)'
                when coalesce(ci.cards, 0) >= 30 then '30+ cards'
                when coalesce(ci.cards, 0) >= 13 then '13-29 cards'
                when coalesce(ci.cards, 0) >= 6  then '6-12 cards'
                else 'Under 6 cards' end as band,
           case when coalesce(ci.cards, 0) >= 0.8 * e.cap then 1
                when coalesce(ci.cards, 0) >= 30 then 2
                when coalesce(ci.cards, 0) >= 13 then 3
                when coalesce(ci.cards, 0) >= 6  then 4
                else 5 end as band_order,
           v.*
      from ext e
      left join ci on ci.user_id = e.user_id
      left join ev v on v.user_id = e.user_id
  )
  select b.band, b.band_order,
         count(*)::bigint,
         count(*) filter (where b.saw_price)::bigint,
         count(*) filter (where b.price_seen)::bigint,
         count(*) filter (where b.saw_wall)::bigint,
         count(*) filter (where b.saw_banner)::bigint,
         count(*) filter (where b.saw_toast)::bigint,
         count(*) filter (where b.clicked)::bigint,
         count(*) filter (where b.blocked)::bigint,
         count(*) filter (where b.intent)::bigint
    from banded b
   group by b.band, b.band_order
   order by b.band_order;
end;
$$;

revoke all on function public.admin_paid_reach(date, boolean) from public, anon;
grant execute on function public.admin_paid_reach(date, boolean) to authenticated, service_role;

-- ── 5. Prove it, per the 0311 habit ────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.admin_stats(boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_paid_reach(date, boolean)', 'execute')
     or has_function_privilege('anon', 'public.capture_metrics_daily()', 'execute')
     or has_function_privilege('authenticated', 'public.capture_metrics_daily()', 'execute')
     or has_function_privilege('authenticated', 'public._stamp_first_paid()', 'execute') then
    raise exception '0327: grants are too wide';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_stats(boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_paid_reach(date, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.capture_metrics_daily()', 'execute') then
    raise exception '0327: grants are too narrow';
  end if;
  -- The trigger must see UPDATEs now, or a trial conversion pays no referral.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.subscriptions'::regclass
       and t.tgname = 'profiles_first_paid'
       and pg_get_triggerdef(t.oid) ilike '%update of status%'
  ) then
    raise exception '0327: profiles_first_paid must fire on UPDATE OF status';
  end if;
end $$;
