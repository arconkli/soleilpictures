-- 0332 — the money counters report things that are not true.
--
-- The trial reaches production before any of these are read in anger, and
-- three of them are wrong in ways that only ever move the number in the
-- flattering direction. One of them is on a clock.
--
--   1. admin_conversion_funnel.paid counted BOTH 'checkout_success' and
--      'subscription_started'. checkout_success is a client event latched
--      per PAGELOAD, so every reload of /pricing/success adds one — the
--      inflation is unbounded, not a factor of two. It also counts a $0 trial
--      start as a sale, and carries no attribution.
--
--   2. admin_trial_funnel decided "eligible" from a card count keyed on
--      boards.created_by with count(*), while the cap enforcer counts
--      sum(weight) over the WORKSPACE OWNER. A card placed by a collaborator
--      in your workspace counts against your cap and not against your
--      eligibility. The two answers already disagree, and the gap grows with
--      every shared cluster.
--
--   3. admin_trial_funnel stages 5/6 and admin_stats.trials_converted read
--      subscriptions.status, which is MUTABLE. A trial that converts and is
--      later cancelled silently un-converts: the count can only ever go down,
--      so "trials converted" is really "trials converted and still paying".
--      profiles.first_paid_at is write-once and already exists for this.
--
--   4. metrics_daily.paid_users counts profiles.tier = 'paid', and a trialing
--      subscription IS granted paid tier. metrics_daily is a daily snapshot
--      that is never backfilled, so the first trial cohort would write a
--      fortnight of rows calling free trials paid users, permanently. This is
--      the clock: it has to land before a trial matures.
--
-- Not fixed here, deliberately, and written down so it is not lost: the
-- enforcer counts card_index rows on SOFT-DELETED boards. Deleting a cluster
-- does not give you your cap back for 30 days, until purge_old_deleted_boards
-- hard-deletes the row. That is coherent with restore_board() — freeing the
-- cap immediately would let a restore push an account over its ceiling — but
-- it means a user who prunes a whole cluster to make room is refused anyway,
-- and told "Demo accounts are limited to N cards" while holding far fewer.
-- Several live accounts are in that state right now, one of them with every
-- card it is being charged for sitting in a cluster it deleted. Changing it is
-- a product decision about the paywall, not a counter fix, so it is not in
-- this migration.
--
-- _live_card_counts() below is the ONE definition of "cards held", matching
-- get_my_tier and enforce_demo_card_cap_trg expression for expression,
-- INCLUDING the soft-delete behaviour above. The deck's job is to agree with
-- the enforcer; if the enforcer is wrong it must be fixed there, once, and
-- this follows it.

begin;

-- ── One definition of "cards held" ──────────────────────────────────────────
-- Set-returning rather than scalar-per-user on purpose: the callers below are
-- whole-population counts, and a scalar function would turn each into one
-- aggregate scan per profile.
create or replace function public._live_card_counts()
returns table (user_id uuid, cards integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select w.created_by, sum(ci.weight)::int
    from public.card_index ci
    join public.boards b     on b.id = ci.board_id
    join public.workspaces w on w.id = b.workspace_id
   group by w.created_by;
$$;

comment on function public._live_card_counts() is
  'Cards held per workspace owner, identical to get_my_tier and the cap trigger. Internal: admin readers only.';

-- 0311 habit: a new function is born with EXECUTE for authenticated and
-- service_role. An internal helper keeps neither.
revoke execute on function public._live_card_counts() from public, anon, authenticated;

-- ── 1 + attribution: the conversion funnel ──────────────────────────────────
drop function if exists public.admin_conversion_funnel(date, boolean);
create function public.admin_conversion_funnel(
  p_since date default '2026-06-27'::date,
  p_exclude_internal boolean default true
)
returns table (
  surface text, sort_order integer, exposures bigint, people bigint,
  evaluated bigint, read_feature bigint, toggled_plan bigint, cta bigint,
  intents bigint, checkouts bigint, checkout_errors bigint, config_errors bigint,
  trials bigint, paid bigint, median_dwell_ms numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public._require_admin();
  return query
  with ev as (
    select e.*,
           case
             when coalesce(e.props->>'surface','') = 'public_page' then 'Public pricing page'
             when coalesce(e.props->>'surface','') in ('page')     then 'Pricing page (signed in)'
             when coalesce(e.props->>'header','')  = 'cap-hit'     then 'Cap wall'
             when coalesce(e.props->>'header','')  = 'storage'     then 'File/size gate'
             when coalesce(e.props->>'surface','') = 'first_value'
               or coalesce(e.props->>'header','')  = 'first-value' then 'First-value banner'
             when coalesce(e.props->>'via','')     = 'chip'        then 'Upgrade pill'
             when coalesce(e.props->>'via','')     = 'settings'    then 'Settings'
             else 'Other in-app'
           end as surf
      from public.analytics_events e
     where e.occurred_at >= p_since
       and (not p_exclude_internal or e.user_id is null
            or e.user_id not in (select _internal_user_ids()))
  ),
  agg as (
    select surf,
           count(*) filter (where event = 'up_exposure_summary') as exposures,
           count(distinct user_id) filter (where event = 'up_exposure_summary') as people,
           count(*) filter (where event = 'up_exposure_summary'
                              and (coalesce(props->>'feat_rows','[]') <> '[]'
                                   or coalesce((props->>'toggles_n')::int, 0) > 0)) as evaluated,
           count(*) filter (where event = 'up_exposure_summary'
                              and coalesce(props->>'feat_rows','[]') <> '[]') as read_feature,
           count(*) filter (where event = 'up_exposure_summary'
                              and coalesce((props->>'toggles_n')::int, 0) > 0) as toggled_plan,
           count(*) filter (where event = 'up_exposure_summary'
                              and props->>'outcome' = 'cta') as cta,
           count(*) filter (where event = 'pricing_creator_intent') as intents,
           count(*) filter (where event = 'checkout_open') as checkouts,
           count(*) filter (where event = 'checkout_error') as checkout_errors,
           count(*) filter (where event = 'checkout_error' and props->>'kind' = 'config') as config_errors,
           -- A trial start is not revenue and never counts as one. It is its
           -- own column because a trial that vanishes from the funnel is worse
           -- than one counted wrongly: the surface that produced it would show
           -- an exposure and then nothing at all.
           count(distinct props->>'session_id') filter (
             where event = 'subscription_started' and props->>'trial' = 'true') as trials,
           -- A SALE. Keyed on the Stripe checkout session, which the webhook
           -- already dedupes on, so an operator re-send or a Stripe retry stays
           -- single-counted. checkout_success is deliberately gone: it is a
           -- client event latched per pageload and cannot be a revenue count.
           count(distinct props->>'session_id') filter (
             where event = 'subscription_started'
               and coalesce(props->>'trial','false') <> 'true') as paid,
           percentile_cont(0.5) within group (order by (props->>'dwell_ms')::numeric)
             filter (where event = 'up_exposure_summary'
                       and (props->>'dwell_ms') ~ '^[0-9]+$'
                       and (props->>'dwell_ms')::numeric < 600000) as median_dwell_ms
      from ev group by surf
  )
  select a.surf,
         case a.surf
           when 'Cap wall' then 1 when 'Upgrade pill' then 2 when 'First-value banner' then 3
           when 'File/size gate' then 4 when 'Settings' then 5
           when 'Pricing page (signed in)' then 6 when 'Public pricing page' then 7 else 8 end,
         a.exposures, a.people, a.evaluated, a.read_feature, a.toggled_plan,
         a.cta, a.intents, a.checkouts, a.checkout_errors, a.config_errors,
         a.trials, a.paid,
         round(a.median_dwell_ms::numeric)
    from agg a
   where a.exposures > 0 or a.intents > 0 or a.checkouts > 0
      or a.trials > 0 or a.paid > 0
   order by 2;
end;
$function$;

-- ── 2 + 3: the trial funnel ─────────────────────────────────────────────────
drop function if exists public.admin_trial_funnel(boolean);
create function public.admin_trial_funnel(p_exclude_internal boolean default true)
returns table (stage text, sort_order integer, people bigint, note text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_min_cards constant int := 13;      -- mirrors trialCore.mjs TRIAL_MIN_CARDS
  v_cap_frac  constant numeric := 0.8; -- mirrors trialCore.mjs TRIAL_CAP_FRAC
begin
  perform public._require_admin();
  return query
  with ext as (
    select p.user_id,
           p.tier,
           p.creator_trial_started_at,
           p.first_paid_at,
           coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0) as cap
      from public.profiles p
     where not coalesce(p.is_service, false)
       and (not p_exclude_internal or p.user_id not in (select _internal_user_ids()))
  ),
  j as (
    -- The enforcer's own arithmetic, via the shared definition. The previous
    -- version counted rows keyed on boards.created_by, which is a different
    -- question from the one the cap asks.
    select e.*, coalesce(c.cards, 0) as live_cards, s.status as sub_status
      from ext e
      left join public._live_card_counts() c on c.user_id = e.user_id
      left join public.subscriptions s on s.user_id = e.user_id
  )
  select * from (
    values
      ('Eligible for the trial today', 1,
       (select count(*) from j
         where tier = 'demo' and creator_trial_started_at is null
           and (live_cards >= v_min_cards or live_cards >= v_cap_frac * cap))::bigint,
       'Demo, never trialed, and holding a real body of work'),
      ('Asked for it', 2,
       (select count(distinct a.user_id) from public.analytics_events a
         where a.event = 'pricing_creator_intent' and a.props->>'trial' = 'true'
           and (not p_exclude_internal or a.user_id is null
                or a.user_id not in (select _internal_user_ids())))::bigint,
       'Clicked the trial button'),
      ('Started one', 3,
       (select count(*) from j where creator_trial_started_at is not null)::bigint,
       'A subscription actually reached trialing'),
      ('On trial right now', 4,
       (select count(*) from j where sub_status = 'trialing')::bigint,
       'Paid access, no money yet, never counted as revenue'),
      -- first_paid_at is write-once. status is not: a convert who later
      -- cancels used to un-convert, so this number could only fall.
      ('Converted to paying', 5,
       (select count(*) from j
         where creator_trial_started_at is not null
           and first_paid_at is not null
           and first_paid_at >= creator_trial_started_at)::bigint,
       'Trialed, then a first charge cleared — counted once, forever'),
      ('Ended without paying', 6,
       (select count(*) from j
         where creator_trial_started_at is not null
           and coalesce(sub_status, 'canceled') <> 'trialing'
           and (first_paid_at is null or first_paid_at < creator_trial_started_at))::bigint,
       'Trial is over and no first charge ever cleared')
  ) as t(stage, sort_order, people, note)
  order by 2;
end;
$function$;

-- ── 3: admin_stats.trials_converted ─────────────────────────────────────────
-- Replaced in place; every other key is byte-identical to 0329's version.
create or replace function public.admin_stats(p_verified_only boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
    'demo_users',      (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'demo'
                            and not coalesce(p.is_service, false)
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))),
    'demos_near_cap',  (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          left join public._live_card_counts() l on l.user_id = p.user_id
                          where p.tier = 'demo'
                            and not coalesce(p.is_service, false)
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and coalesce(l.cards, 0)
                                >= 0.8 * (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0))),
    'demos_trial_eligible',
                       (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          left join public._live_card_counts() l on l.user_id = p.user_id
                          where p.tier = 'demo'
                            and not coalesce(p.is_service, false)
                            and p.creator_trial_started_at is null
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and (coalesce(l.cards, 0) >= 13
                                 or coalesce(l.cards, 0)
                                    >= 0.8 * (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)))),
    'trials_started',  (select count(*) from public.profiles p
                          where p.creator_trial_started_at is not null
                            and not coalesce(p.is_service, false)),
    -- first_paid_at, not subscriptions.status: a converted trial that later
    -- cancels is still a conversion that happened, and the old expression
    -- quietly took it back.
    'trials_converted',(select count(*) from public.profiles p
                          where p.creator_trial_started_at is not null
                            and p.first_paid_at is not null
                            and p.first_paid_at >= p.creator_trial_started_at
                            and not coalesce(p.is_service, false)),
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
                          where status = 'active'
                        ), 0),
    'trialing_subs',   (select count(*) from public.subscriptions where status = 'trialing'),
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
$function$;

-- ── 4: the daily series, before a trial can pollute it ──────────────────────
alter table public.metrics_daily add column if not exists trialing_users integer;

comment on column public.metrics_daily.paid_users is
  'Accounts on paid tier that are NOT inside a trial. Trials are trialing_users.';
comment on column public.metrics_daily.trialing_users is
  'Accounts whose subscription is trialing. Paid ACCESS, zero revenue. Added 0332, before the first trial matured, so no historical row is affected.';

create or replace function public.capture_metrics_daily()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.metrics_daily (
    day, mrr_cents, total_users, paid_users, trialing_users, demo_users,
    waitlist_users, admin_users, signups, active_users, captured_at
  )
  select
    current_date,
    coalesce((
      select sum(coalesce(monthly_amount_cents,
               case when plan = 'monthly' then 2500
                    when plan = 'annual'  then 2000
                    else 0 end))::int
      from public.subscriptions where status = 'active'
    ), 0),
    (select count(*) from auth.users
       where email_confirmed_at is not null and last_sign_in_at is not null)::int,
    -- Paid tier MINUS anyone inside a trial. A trialing subscription is granted
    -- paid tier by activateCore, so the old expression called every free trial
    -- a paid user — in a table that is written once a day and never backfilled.
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null
         and p.tier = 'paid'
         and not exists (select 1 from public.subscriptions s
                          where s.user_id = p.user_id and s.status = 'trialing'))::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null
         and exists (select 1 from public.subscriptions s
                      where s.user_id = p.user_id and s.status = 'trialing'))::int,
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
    trialing_users = excluded.trialing_users,
    demo_users     = excluded.demo_users,
    waitlist_users = excluded.waitlist_users,
    admin_users    = excluded.admin_users,
    signups        = excluded.signups,
    active_users   = excluded.active_users,
    captured_at    = excluded.captured_at;
end;
$function$;

-- ── Grants, proved rather than asserted ─────────────────────────────────────
-- The 0311 habit: a REVOKE reporting success proves nothing. Every function
-- this migration creates states what it expects and fails the migration if the
-- catalog disagrees.
do $$
declare
  v_bad text := '';
begin
  -- Internal helper: nobody but a definer caller.
  if has_function_privilege('public', 'public._live_card_counts()', 'execute')
     or has_function_privilege('anon', 'public._live_card_counts()', 'execute')
     or has_function_privilege('authenticated', 'public._live_card_counts()', 'execute') then
    v_bad := v_bad || ' _live_card_counts is reachable by a non-definer caller;';
  end if;

  -- Admin readers: signed-in only (they gate on _require_admin internally),
  -- never anon.
  if not has_function_privilege('authenticated', 'public.admin_conversion_funnel(date, boolean)', 'execute') then
    v_bad := v_bad || ' admin_conversion_funnel not executable by authenticated;';
  end if;
  if has_function_privilege('anon', 'public.admin_conversion_funnel(date, boolean)', 'execute') then
    v_bad := v_bad || ' admin_conversion_funnel is reachable by anon;';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_trial_funnel(boolean)', 'execute') then
    v_bad := v_bad || ' admin_trial_funnel not executable by authenticated;';
  end if;
  if has_function_privilege('anon', 'public.admin_trial_funnel(boolean)', 'execute') then
    v_bad := v_bad || ' admin_trial_funnel is reachable by anon;';
  end if;

  -- capture_metrics_daily is a cron job, not a user surface.
  if has_function_privilege('anon', 'public.capture_metrics_daily()', 'execute') then
    v_bad := v_bad || ' capture_metrics_daily is reachable by anon;';
  end if;

  if v_bad <> '' then
    raise exception '0332 grant proof failed:%', v_bad;
  end if;
end $$;

commit;
