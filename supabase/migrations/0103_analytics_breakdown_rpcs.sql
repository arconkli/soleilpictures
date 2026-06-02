-- 0103_analytics_breakdown_rpcs — surface the maximal landing/waitlist/pricing
-- instrumentation in the admin dashboard. Additive only: two new admin RPCs.
-- admin_event_funnel (the linear 10-stage funnel) is left untouched — these
-- cover the branch / error / abandon signals that don't fit a linear funnel.

------------------------------------------------------------------
-- admin_event_breakdown — per-event sessions / users / total for a curated
-- set of the new branch, error, and abandon events. Mirrors the
-- admin_event_funnel shape so the admin UI can reuse its table/bar patterns.
------------------------------------------------------------------
create or replace function public.admin_event_breakdown(p_days int default 30)
returns table(event text, sessions bigint, users bigint, total bigint, ord int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));

  return query
  with ev as (
    select * from public.analytics_events
    where occurred_at >= now() - (p_days || ' days')::interval
  ),
  curated(event, ord) as (
    values
      -- landing failures / friction
      ('email_submit_error',     1),
      ('otp_verify_error',       2),
      ('landing_callback_error', 3),
      ('landing_edit_email',     4),
      ('landing_explore_click',  5),
      -- waitlist path / abandon
      ('welcome_cta',            6),
      ('waitlist_abandon',       7),
      ('waitlist_plan_toggle',   8),
      ('waitlist_subscribe_cta', 9),
      -- pricing path / abandon
      ('pricing_plan_toggle',   10),
      ('pricing_demo_cta',      11),
      ('pricing_creator_intent',12),
      ('pricing_abandon',       13),
      -- checkout failures / reliability
      ('checkout_error',        14),
      ('billing_portal_error',  15),
      ('checkout_stalled',      16),
      ('checkout_verify_retry', 17),
      ('checkout_missing_session',18),
      ('checkout_support_click',19)
  )
  select c.event,
         count(distinct ev.session_id) as sessions,
         count(distinct ev.user_id)    as users,
         count(ev.*)                   as total,
         c.ord
  from curated c
  left join ev on ev.event = c.event
  group by c.event, c.ord
  order by c.ord;
end;
$$;
revoke all on function public.admin_event_breakdown(int) from public;
grant execute on function public.admin_event_breakdown(int) to authenticated;

------------------------------------------------------------------
-- admin_checkout_reliability — how the post-checkout activation flow resolves
-- (the webhook-race surface). Distinct sessions per outcome over the window.
------------------------------------------------------------------
create or replace function public.admin_checkout_reliability(p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));

  with ev as (
    select * from public.analytics_events
    where occurred_at >= now() - (p_days || ' days')::interval
  )
  select jsonb_build_object(
    'success_views',   (select count(distinct session_id) from ev where event = 'checkout_success'),
    'activated',       (select count(distinct session_id) from ev where event = 'checkout_activated_seen'),
    'stalled',         (select count(distinct session_id) from ev where event = 'checkout_stalled'),
    'verify_retry',    (select count(distinct session_id) from ev where event = 'checkout_verify_retry'),
    'missing_session', (select count(distinct session_id) from ev where event = 'checkout_missing_session'),
    'verify_failed',   (select count(distinct session_id) from ev
                          where event = 'checkout_verify_result' and props->>'result' = 'failed'),
    'support_clicks',  (select count(*) from ev where event = 'checkout_support_click')
  ) into v_out;

  return v_out;
end;
$$;
revoke all on function public.admin_checkout_reliability(int) from public;
grant execute on function public.admin_checkout_reliability(int) to authenticated;
