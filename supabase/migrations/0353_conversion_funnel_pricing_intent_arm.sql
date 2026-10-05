-- 0353 — admin_conversion_funnel gets a "Pricing page → in-app offer" arm.
--
-- A signed-out "Get Creator" on /pricing is carried through sign-in
-- (boards/src/lib/creatorIntent.js) and reopens the Creator offer in the app
-- (useCreatorIntentResume) with via = 'pricing_page' and — from 2026-10-02 —
-- its own header, 'pricing-intent'. The funnel had no arm for it, so every
-- exposure, checkout and sale on the one path where a visitor has already said
-- "I want to pay" landed in "Other in-app", beside whatever else fell through.
-- The arm matches on EITHER key: rows written before the header existed carry
-- only the via.
--
-- It sits after the two pricing-page arms on purpose. The public page's own
-- events carry surface = 'public_page' and keep their row; this arm is what
-- happens AFTER that page, inside the app.
--
-- CREATE OR REPLACE with the identical signature and RETURNS TABLE — no DROP —
-- so the function keeps its ACL (a DROP + CREATE discards it). The block at the
-- end proves that rather than trusting it (the 0311 habit: a grant that
-- "succeeded" proves nothing).

create or replace function public.admin_conversion_funnel(
  p_since date default '2026-06-27'::date,
  p_exclude_internal boolean default true
)
returns table(
  surface text, sort_order integer, exposures bigint, people bigint, evaluated bigint,
  read_feature bigint, toggled_plan bigint, cta bigint, intents bigint, checkouts bigint,
  checkout_errors bigint, config_errors bigint, trials bigint, paid bigint, median_dwell_ms numeric
)
language plpgsql
stable security definer
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
             when coalesce(e.props->>'via','')     = 'pricing_page'
               or coalesce(e.props->>'header','')  = 'pricing-intent' then 'Pricing page → in-app offer'
             when coalesce(e.props->>'header','')  = 'cap-hit'     then 'Cap wall'
             when coalesce(e.props->>'header','')  = 'near-cap'    then 'Near-cap toast'
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
           when 'Cap wall' then 1 when 'Near-cap toast' then 2 when 'Upgrade pill' then 3
           when 'First-value banner' then 4 when 'File/size gate' then 5 when 'Settings' then 6
           when 'Pricing page (signed in)' then 7 when 'Public pricing page' then 8
           when 'Pricing page → in-app offer' then 9 else 10 end,
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

-- Grant proof. Admins call this as `authenticated` (the body refuses anyone
-- _require_admin() does not pass); anon must never reach it.
do $$
declare
  fn constant text := 'public.admin_conversion_funnel(date,boolean)';
begin
  if has_function_privilege('anon', fn, 'execute') then
    raise exception '0353: anon can execute %', fn;
  end if;
  if not has_function_privilege('authenticated', fn, 'execute') then
    raise exception '0353: authenticated lost execute on %', fn;
  end if;
  if not has_function_privilege('service_role', fn, 'execute') then
    raise exception '0353: service_role lost execute on %', fn;
  end if;
  if not (select prosecdef from pg_proc where oid = fn::regprocedure) then
    raise exception '0353: % is no longer SECURITY DEFINER', fn;
  end if;
end $$;
