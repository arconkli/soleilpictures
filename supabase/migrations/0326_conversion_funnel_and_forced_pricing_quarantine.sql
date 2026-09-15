-- 0326 — the forced-pricing era leaves the live table, and conversion gets an
-- honest funnel.
--
-- PART 1. QUARANTINE, NOT DELETE.
--
-- Three retired situations put a price in front of people who had not asked to
-- see one, and every conversion read since has been counting them:
--
--   ad_offer_screen    — ad traffic (fbclid) skipped the waitlist and landed on
--                        a PRICE-FIRST screen before touching the product at
--                        all. The screen (AdWelcome) is deleted; its events and
--                        the checkouts opened from it are not. It ran
--                        2026-06-04 to 2026-06-26.
--   waitlist_routing   — while the waitlist was on, TierRouter sent a
--                        waitlist-tier user to the pricing page as a GATE, not
--                        a choice. app_config.waitlist_enabled flipped false at
--                        2026-06-15 04:33:43+00; every `surface: 'page'` row
--                        before that instant is a routing, not a visit.
--   prelaunch_billing_test — the May end-to-end billing tests, which ran
--                        signed-out and so are invisible to the
--                        _internal_user_ids() filter every other read relies
--                        on. They own the majority of the lifetime
--                        `checkout_open` count.
--
-- Together these are a small number of rows that carry MOST of the product's
-- lifetime purchase-intent signal, which is why "we had checkouts once" has
-- been a misleading sentence. They move to analytics_events_synthetic — the
-- same archive the QA-harness and crawler rows go to, and the same one-time
-- move migration 0228 used for the Playwright rows. NOTHING IS DELETED: the
-- rows keep their ids and payloads and can be read back, or moved back, from
-- the archive. They simply stop reaching the ~33 admin RPCs that select from
-- analytics_events without knowing to filter.
--
-- No trigger change: all three surfaces are retired, so no new row of this
-- shape can arrive.
--
-- PART 2. Two read RPCs that answer "does the money funnel work" on what is
-- left, per surface, with denominators that are not lies.

-- ── 1. Move the forced-pricing era to the archive ───────────────────────────
with fam as (
  select *
    from public.analytics_events
   where event like 'pricing\_%' escape '\'
      or event like 'checkout\_%' escape '\'
      or event like 'up\_%' escape '\'
      or event like 'ad\_offer%' escape '\'
),
doomed as (
  select f.*,
         case
           when f.event like 'ad\_offer%' escape '\'                         then 'forced_pricing_ad_offer'
           when coalesce(f.props->>'surface','') in ('ad_offer','waitlist_status')
                                                                             then 'forced_pricing_ad_offer'
           when coalesce(f.props->>'surface','') = 'page'
                and f.occurred_at < timestamptz '2026-06-15 04:33:43+00'     then 'forced_pricing_waitlist'
           when f.occurred_at < timestamptz '2026-06-01 00:00:00+00'
                and f.user_id is null                                        then 'prelaunch_billing_test'
           else null
         end as why
    from fam f
),
picked as (select * from doomed where why is not null),
-- analytics_events_synthetic carries no unique constraint on id (it is an
-- append-only archive, not a keyed table), so the re-run guard is an explicit
-- NOT EXISTS rather than ON CONFLICT. The delete keys on `picked`, not on the
-- insert's RETURNING, so a second run still clears any row that was archived
-- but somehow left behind.
archived as (
  insert into public.analytics_events_synthetic
    (id, session_id, user_id, event, props, path, occurred_at, country, app_session_id, reason)
  select p.id, p.session_id, p.user_id, p.event, p.props, p.path, p.occurred_at, p.country, p.app_session_id, p.why
    from picked p
   where not exists (
     select 1 from public.analytics_events_synthetic s where s.id = p.id
   )
  returning id
)
delete from public.analytics_events a
 where a.id in (select id from picked);

-- ── 2. The conversion funnel, per surface ───────────────────────────────────
--
-- Denominators, in the order they must be read:
--
--   exposures  — up_exposure_summary rows. ONE row per pitch actually shown.
--                This is the honest denominator. pricing_view is latched per
--                pageload (logEventOnce), so a modal that re-mounts forty times
--                in one pageload logs ONE view; building a rate on it
--                understates the shows and overstates the rate.
--   evaluated  — exposures where the reader did something that means they read
--                the OFFER rather than the interruption: opened a feature line
--                or toggled the plan. The gap between exposures and evaluated
--                is the difference between being shown a price and considering
--                one, and it is the number this product has been losing on.
--   cta/intent/checkout/paid — the rest of the funnel, attributed to the same
--                surface so a wall and a chip are never averaged together.
--
-- Surfaces are normalised from (surface, header, via) because the same modal
-- component serves five different moments and only the envelope tells them
-- apart.
create or replace function public.admin_conversion_funnel(
  p_since date default '2026-06-27',
  p_exclude_internal boolean default true
)
returns table (
  surface text,
  sort_order int,
  exposures bigint,
  people bigint,
  evaluated bigint,
  read_feature bigint,
  toggled_plan bigint,
  cta bigint,
  intents bigint,
  checkouts bigint,
  checkout_errors bigint,
  config_errors bigint,
  paid bigint,
  median_dwell_ms numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  with ev as (
    select e.*,
           case
             when coalesce(e.props->>'surface','') = 'public_page'                       then 'Public pricing page'
             when coalesce(e.props->>'surface','') in ('page')                           then 'Pricing page (signed in)'
             when coalesce(e.props->>'header','')  = 'cap-hit'                           then 'Cap wall'
             when coalesce(e.props->>'header','')  = 'storage'                           then 'File/size gate'
             when coalesce(e.props->>'surface','') = 'first_value'
               or coalesce(e.props->>'header','')  = 'first-value'                       then 'First-value banner'
             when coalesce(e.props->>'via','')     = 'chip'                              then 'Upgrade pill'
             when coalesce(e.props->>'via','')     = 'settings'                          then 'Settings'
             else 'Other in-app'
           end as surf
      from public.analytics_events e
     where e.occurred_at >= p_since
       and (not p_exclude_internal
            or e.user_id is null
            or e.user_id not in (select _internal_user_ids()))
  ),
  agg as (
    select surf,
           count(*) filter (where event = 'up_exposure_summary')                                   as exposures,
           count(distinct user_id) filter (where event = 'up_exposure_summary')                     as people,
           count(*) filter (where event = 'up_exposure_summary'
                              and (coalesce(props->>'feat_rows','[]') <> '[]'
                                   or coalesce((props->>'toggles_n')::int, 0) > 0))                 as evaluated,
           count(*) filter (where event = 'up_exposure_summary'
                              and coalesce(props->>'feat_rows','[]') <> '[]')                       as read_feature,
           count(*) filter (where event = 'up_exposure_summary'
                              and coalesce((props->>'toggles_n')::int, 0) > 0)                      as toggled_plan,
           count(*) filter (where event = 'up_exposure_summary'
                              and props->>'outcome' = 'cta')                                        as cta,
           count(*) filter (where event = 'pricing_creator_intent')                                 as intents,
           count(*) filter (where event = 'checkout_open')                                          as checkouts,
           count(*) filter (where event = 'checkout_error')                                         as checkout_errors,
           count(*) filter (where event = 'checkout_error' and props->>'kind' = 'config')            as config_errors,
           count(*) filter (where event in ('checkout_success','subscription_started'))              as paid,
           percentile_cont(0.5) within group (
             order by (props->>'dwell_ms')::numeric
           ) filter (where event = 'up_exposure_summary'
                       and (props->>'dwell_ms') ~ '^[0-9]+$'
                       -- a tab parked overnight is not a read
                       and (props->>'dwell_ms')::numeric < 600000)                                   as median_dwell_ms
      from ev
     group by surf
  )
  select a.surf,
         case a.surf
           when 'Cap wall' then 1 when 'Upgrade pill' then 2 when 'First-value banner' then 3
           when 'File/size gate' then 4 when 'Settings' then 5
           when 'Pricing page (signed in)' then 6 when 'Public pricing page' then 7 else 8 end,
         a.exposures, a.people, a.evaluated, a.read_feature, a.toggled_plan,
         a.cta, a.intents, a.checkouts, a.checkout_errors, a.config_errors, a.paid,
         -- percentile_cont has no numeric overload, so it comes back double
         -- precision however the ORDER BY is cast; round() on a double returns a
         -- double and the declared numeric column rejects it.
         round(a.median_dwell_ms::numeric)
    from agg a
   where a.exposures > 0 or a.intents > 0 or a.checkouts > 0 or a.paid > 0
   order by 2;
end;
$$;

revoke all on function public.admin_conversion_funnel(date, boolean) from public, anon;
grant execute on function public.admin_conversion_funnel(date, boolean) to authenticated, service_role;

comment on function public.admin_conversion_funnel(date, boolean) is
  'Admin. Per upgrade surface since p_since: pitches actually shown (up_exposure_summary, '
  'the honest denominator — pricing_view is latched per pageload), how many were EVALUATED '
  '(a feature line read or the plan toggled) rather than merely shown, then CTA, intent, '
  'checkout, checkout errors (config errors called out) and paid. Default p_since is the day '
  'after the last forced-pricing event; those rows are archived out of the live table by 0326.';

-- ── 3. The trial lifecycle ──────────────────────────────────────────────────
--
-- One row per stage, in order, so the deck can render it as a funnel without
-- deciding what the stages are. `eligible` is computed from the SAME rule the
-- edge function enforces (13+ live cards, or at or above 80% of the caller's own
-- cap, demo tier, never trialed) — if this number and the offer ever disagree,
-- one of them has drifted.
--
-- 'trialing' is deliberately its own stage and is NEVER folded into paid: a
-- trialing subscription carries a full list price and would otherwise show up
-- as revenue that has not arrived.
create or replace function public.admin_trial_funnel(
  p_exclude_internal boolean default true
)
returns table (
  stage text,
  sort_order int,
  people bigint,
  note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min_cards constant int := 13;     -- mirrors trialCore.TRIAL_MIN_CARDS
  v_cap_frac  constant numeric := 0.8; -- mirrors trialCore.TRIAL_CAP_FRAC
begin
  perform public._require_admin();
  return query
  with ext as (
    select p.user_id,
           p.tier,
           p.creator_trial_started_at,
           p.card_cap_base + coalesce(p.bonus_card_credits, 0) as cap
      from public.profiles p
     where not coalesce(p.is_service, false)
       and (not p_exclude_internal or p.user_id not in (select _internal_user_ids()))
  ),
  cards as (
    select b.created_by as user_id, count(*)::int as n
      from public.card_index c
      join public.boards b on b.id = c.board_id
     where b.deleted_at is null
     group by 1
  ),
  j as (
    select e.*, coalesce(c.n, 0) as live_cards, s.status as sub_status
      from ext e
      left join cards c on c.user_id = e.user_id
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
       'Paid access, no money yet — never counted as revenue'),
      ('Converted to paying', 5,
       (select count(*) from j
         where creator_trial_started_at is not null and sub_status = 'active')::bigint,
       'Trialed, then the first charge cleared'),
      ('Ended without paying', 6,
       (select count(*) from j
         where creator_trial_started_at is not null
           and coalesce(sub_status, 'canceled') not in ('active','trialing'))::bigint,
       'Cancelled or lapsed before the first charge')
  ) as t(stage, sort_order, people, note)
  order by 2;
end;
$$;

revoke all on function public.admin_trial_funnel(boolean) from public, anon;
grant execute on function public.admin_trial_funnel(boolean) to authenticated, service_role;

comment on function public.admin_trial_funnel(boolean) is
  'Admin. The Creator trial lifecycle as ordered stages: eligible today (computed from the '
  'same rule the edge function enforces), asked, started, on trial now, converted, ended '
  'without paying. A trialing subscription is its own stage and is never counted as revenue.';

-- ── 4. Prove the grants, per the 0311 habit ─────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.admin_conversion_funnel(date, boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_trial_funnel(boolean)', 'execute') then
    raise exception '0326: conversion RPCs must not be anon-callable';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_conversion_funnel(date, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_trial_funnel(boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_conversion_funnel(date, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_trial_funnel(boolean)', 'execute') then
    raise exception '0326: conversion RPC grants are wrong';
  end if;
  -- The quarantine must have actually emptied the live table of these rows.
  if exists (
    select 1 from public.analytics_events
     where event like 'ad\_offer%' escape '\'
        or coalesce(props->>'surface','') in ('ad_offer','waitlist_status')
  ) then
    raise exception '0326: forced-pricing rows still present in analytics_events';
  end if;
end $$;
