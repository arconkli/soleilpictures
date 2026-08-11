-- 0231_event_breakdown_output_events.sql — surface the output events in the
-- admin Event breakdown panel.
--
-- 0230 made the analytics table readable again; this makes the newly-instrumented
-- events readable WITHOUT building a new panel. admin_event_breakdown drives the
-- existing Events section off a curated list, and that list already carries usage
-- events (referral_link_copied, invite_link_created), not just errors — so the
-- export/download counters belong in it.
--
-- Why these five specifically: export, download and share-link creation are the
-- moments where a board stops being private work and becomes something handed to
-- someone else. Every one of them was dark, which is why "should output be a paid
-- gate?" could only be argued from intuition. Now it can be counted.
--
-- Body verbatim from the live definition; only the curated VALUES list grows.

create or replace function public.admin_event_breakdown(p_days integer default 30, p_exclude_internal boolean default true)
returns table(event text, sessions bigint, users bigint, total bigint, ord integer)
language plpgsql stable security definer
set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  with ev as (
    select * from public.analytics_events
    where occurred_at >= now() - (p_days || ' days')::interval
      and (not p_exclude_internal or session_id is null or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  curated(event, ord) as (
    values ('email_submit_error',1),('otp_verify_error',2),('landing_callback_error',3),('landing_edit_email',4),
           ('landing_explore_click',5),('welcome_cta',6),('waitlist_abandon',7),('waitlist_plan_toggle',8),
           ('waitlist_subscribe_cta',9),('pricing_plan_toggle',10),('pricing_demo_cta',11),('pricing_creator_intent',12),
           ('pricing_abandon',13),('checkout_error',14),('billing_portal_error',15),('checkout_stalled',16),
           ('checkout_verify_retry',17),('checkout_missing_session',18),('checkout_support_click',19),
           ('referral_open',20),('referral_tab_view',21),('referral_link_copied',22),('referral_link_shared',23),
           ('referral_nudge_view',24),('referral_nudge_cta',25),('referral_nudge_dismiss',26),
           ('referral_signup',27),('referral_activated',28),('referral_reward_granted',29),
           ('invite_nudge_view',30),('invite_nudge_cta',31),('invite_nudge_dismiss',32),('invite_sent',33),
           ('invite_link_created',34),('invite_link_view',35),('invite_link_join_click',36),('invite_link_claimed',37),
           -- Output / delivery (instrumented 2026-08-11; dark before that)
           ('share_open',38),('share_link_copied',39),
           ('export_run',40),('export_error',41),('file_download',42)
  )
  select c.event, count(distinct ev.session_id) as sessions, count(distinct ev.user_id) as users, count(ev.*) as total, c.ord
  from curated c left join ev on ev.event = c.event group by c.event, c.ord order by c.ord;
end;
$$;
