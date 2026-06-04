-- 0116_admin_fb_funnel_restructure.sql
--
-- Give the Facebook/Instagram segment its OWN funnel shape.
--
-- 0114 sliced the generic signup funnel to fbclid sessions (p_has_fbclid), but
-- that funnel's steps are the waitlist/pricing flow — which FB/IG ad traffic
-- never sees. Fast-tracked ad clicks skip the waitlist entirely: they sign in,
-- get an instant demo account, and land on the AdWelcome price-first offer
-- (the `ad_offer_*` events), where the only two choices are "Try the demo" or
-- "Get Creator". So the old panel showed a phantom 100% drop at "Welcome page"
-- and empty waitlist rows.
--
-- This adds a dedicated admin_fb_funnel that models the actual instant-demo
-- path. The AdWelcome screen IS the price offer (no separate pricing_view), so
-- ad_offer_view is the fork point, and both branches denominate against it:
--
--   Landing view → Email submitted → Account created → Saw the price offer
--                                                            │ forks at the offer
--                                              ◆ Free workspace:  Stepped into the demo (ad_offer_enter)
--                                              ◇ Creator purchase: Opened checkout → Completed payment
--
-- FB/IG attribution is session-level (mirrors admin_signup_funnel): a session
-- counts as FB if any of its events carries props.fbclid/props.fbc (merged into
-- every event client-side) OR its signed-in user has profiles.first_source.fbclid.
-- fbclid is on ALL FB/IG clicks (paid ads AND organic), so this is "FB/IG
-- traffic", not strictly paid. Returns the same (ord, step, label, branch,
-- sessions, users) shape SignupFunnelPanel already renders.
--
-- admin_signup_funnel's p_has_fbclid param (0114) is left in place (harmless);
-- the Acquisition view now points its FB panel at this function instead.

create or replace function public.admin_fb_funnel(
  p_days integer default 30,
  p_exclude_internal boolean default true
)
returns table(ord integer, step text, label text, branch text, sessions bigint, users bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_since timestamptz := now() - (greatest(1, least(p_days, 365)) || ' days')::interval;
begin
  perform public._require_admin();
  return query
  with
  ev as (
    select e.session_id, e.user_id, e.event, e.props, e.occurred_at
    from public.analytics_events e
    where e.occurred_at >= v_since
      and e.session_id is not null
      and (not p_exclude_internal
           or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  sessions_all as (select distinct session_id from ev),
  sess_user as (
    select distinct on (session_id) session_id, user_id
    from ev where user_id is not null order by session_id, occurred_at desc
  ),
  -- FB/IG sessions, as a UNION of two independent signals so anonymous ad clicks
  -- (fbclid in event props, no signed-in user yet) are NOT dropped by a NULL
  -- profile join: (1) any event carries fbclid/fbc — merged into every event's
  -- props client-side, present from the first landing_view; OR (2) the session's
  -- signed-in user has profiles.first_source.fbclid.
  fb_sessions as (
    select distinct s.session_id
    from sessions_all s
    where exists (
      select 1 from ev e
      where e.session_id = s.session_id
        and (e.props->>'fbclid' is not null or e.props->>'fbc' is not null))
    union
    select distinct s.session_id
    from sessions_all s
    join sess_user su on su.session_id = s.session_id
    join public.profiles pr on pr.user_id = su.user_id
    where pr.first_source->>'fbclid' is not null
  ),
  -- The instant-demo ad path. ad_offer_view (the AdWelcome screen) is the fork;
  -- both branches are denominated against it ("of those who saw the offer").
  -- Branches are NOT mutually exclusive: a user who tries the demo and then
  -- upgrades later counts in BOTH (a real demo→buy conversion), so demo + buy
  -- can exceed the fork — same as the waitlist/pricing fork in the main funnel.
  steps(ord, step, label, branch) as (
    values
      (1, 'landing_view',     'Landing view',          'core'),
      (2, 'email_submit',     'Email submitted',       'core'),
      (3, 'otp_verify',       'Account created',       'core'),
      (4, 'ad_offer_view',    'Saw the price offer',   'core'),
      (5, 'ad_offer_enter',   'Stepped into the demo', 'demo'),
      (6, 'checkout_open',    'Opened checkout',       'buy'),
      (7, 'checkout_success', 'Completed payment',     'buy')
  ),
  counts as (
    select e.event, count(distinct e.session_id) as sessions, count(distinct e.user_id) as users
    from ev e join fb_sessions fb on fb.session_id = e.session_id
    group by e.event
  )
  select st.ord, st.step, st.label, st.branch,
         coalesce(c.sessions, 0)::bigint as sessions,
         coalesce(c.users, 0)::bigint as users
  from steps st left join counts c on c.event = st.step
  order by st.ord;
end $function$;

grant execute on function public.admin_fb_funnel(integer, boolean) to authenticated;
