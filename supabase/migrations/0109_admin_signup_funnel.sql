------------------------------------------------------------------
-- 0109_admin_signup_funnel
--
-- Powers the admin "Funnel" tab: per-step signup drop-off, segmentable by
-- ad source / campaign / creative (utm_content) and date range. The existing
-- admin_event_funnel hardcodes 10 steps, computes no drop-off, doesn't fork
-- waitlist-vs-pricing, and can't segment by the event-level utm. These two
-- read-only RPCs fill that gap. Built on public.analytics_events (indexes
-- events_event_time + events_session already exist). Unit = distinct
-- session_id (one funnel attempt; session_id persists across the OTP auth
-- boundary). SECURITY DEFINER + _require_admin(), granted to authenticated.
------------------------------------------------------------------

-- A. Per-step funnel counts, optionally filtered by source/campaign/creative.
create or replace function public.admin_signup_funnel(
  p_days     int  default 30,
  p_source   text default null,
  p_campaign text default null,
  p_content  text default null)
returns table(ord int, step text, label text, branch text, sessions bigint, users bigint)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_since timestamptz := now() - (greatest(1, least(p_days, 365)) || ' days')::interval;
  v_src   text := nullif(trim(coalesce(p_source,   '')), '');
  v_camp  text := nullif(trim(coalesce(p_campaign, '')), '');
  v_cont  text := nullif(trim(coalesce(p_content,  '')), '');
begin
  perform public._require_admin();

  return query
  with
  ev as (
    select e.session_id, e.user_id, e.event, e.props, e.occurred_at
    from public.analytics_events e
    where e.occurred_at >= v_since
      and e.session_id is not null
  ),
  -- universe = every session in the window (incl. pre-auth-only sessions)
  sessions_all as (
    select distinct session_id from ev
  ),
  -- earliest utm-bearing event per session = its first-touch attribution
  attr_src as (
    select distinct on (e.session_id)
      e.session_id,
      e.props->>'utm_source'   as src,
      e.props->>'utm_campaign' as campaign,
      e.props->>'utm_content'  as content
    from ev e
    where e.props->>'utm_source' is not null
    order by e.session_id, e.occurred_at asc
  ),
  -- the session's authenticated user, if any (no max(uuid) — pick latest non-null)
  sess_user as (
    select distinct on (session_id) session_id, user_id
    from ev
    where user_id is not null
    order by session_id, occurred_at desc
  ),
  -- attribution per session: event-level utm, else the user's profile first_source
  attr as (
    select s.session_id,
      coalesce(a.src,      pr.first_source->>'utm_source')   as src,
      coalesce(a.campaign, pr.first_source->>'utm_campaign') as campaign,
      coalesce(a.content,  pr.first_source->>'utm_content')  as content
    from sessions_all s
    left join attr_src a        on a.session_id = s.session_id
    left join sess_user su      on su.session_id = s.session_id
    left join public.profiles pr on pr.user_id = su.user_id
  ),
  -- sessions matching the (optional) segment filters
  sel as (
    select a.session_id
    from attr a
    where (v_src  is null or lower(a.src)      = lower(v_src))
      and (v_camp is null or lower(a.campaign) = lower(v_camp))
      and (v_cont is null or a.content         = v_cont)
  ),
  steps(ord, step, label, branch) as (
    values
      (1,  'landing_view',        'Landing view',           'core'),
      (2,  'email_submit',        'Email submitted',        'core'),
      (3,  'otp_verify',          'OTP verified (account)', 'core'),
      (4,  'welcome_view',        'Welcome page',           'core'),
      (5,  'submit_socials_open', 'Opened waitlist form',   'waitlist'),
      (6,  'submit_socials_done', 'Joined waitlist',        'waitlist'),
      (7,  'pricing_view',        'Viewed pricing',         'pricing'),
      (8,  'checkout_open',       'Opened checkout',        'pricing'),
      (9,  'checkout_success',    'Completed payment',      'pricing'),
      (20, 'email_submit_error',  'Email submit failed',    'leak'),
      (21, 'otp_verify_error',    'OTP verify failed',      'leak'),
      (22, 'waitlist_abandon',    'Abandoned waitlist form','leak'),
      (23, 'pricing_abandon',     'Abandoned pricing',      'leak'),
      (24, 'checkout_error',      'Checkout failed',        'leak')
  ),
  counts as (
    select e.event,
           count(distinct e.session_id) as sessions,
           count(distinct e.user_id)    as users
    from ev e
    join sel on sel.session_id = e.session_id
    group by e.event
  )
  select st.ord, st.step, st.label, st.branch,
         coalesce(c.sessions, 0)::bigint as sessions,
         coalesce(c.users,    0)::bigint as users
  from steps st
  left join counts c on c.event = st.step
  order by st.ord;
end $$;

revoke all on function public.admin_signup_funnel(int, text, text, text) from public;
grant execute on function public.admin_signup_funnel(int, text, text, text) to authenticated;

-- B. Distinct source/campaign/creative values (with session volume) for the
--    segment dropdowns.
create or replace function public.admin_funnel_segments(p_days int default 30)
returns table(dim text, value text, sessions bigint)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_since timestamptz := now() - (greatest(1, least(p_days, 365)) || ' days')::interval;
begin
  perform public._require_admin();
  return query
  with ev as (
    select e.session_id, e.props
    from public.analytics_events e
    where e.occurred_at >= v_since
      and e.session_id is not null
  )
  select 'source'::text,   ev.props->>'utm_source',   count(distinct ev.session_id)::bigint
    from ev where ev.props->>'utm_source'   is not null group by 2
  union all
  select 'campaign'::text, ev.props->>'utm_campaign', count(distinct ev.session_id)::bigint
    from ev where ev.props->>'utm_campaign' is not null group by 2
  union all
  select 'content'::text,  ev.props->>'utm_content',  count(distinct ev.session_id)::bigint
    from ev where ev.props->>'utm_content'  is not null group by 2
  order by 1, 3 desc;
end $$;

revoke all on function public.admin_funnel_segments(int) from public;
grant execute on function public.admin_funnel_segments(int) to authenticated;
