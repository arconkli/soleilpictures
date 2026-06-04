-- 0114_admin_fb_funnel.sql
--
-- Add a Facebook/Instagram funnel segment to the admin dashboard.
--
-- Extends admin_signup_funnel with an optional p_has_fbclid filter so the
-- existing funnel can be sliced to sessions that arrived via a Facebook/
-- Instagram click (detected by the `fbclid` we now capture into
-- analytics_events.props.fbclid + profiles.first_source.fbclid). FB ads carry
-- no UTM (changing the ad URL resets Facebook's learning), so fbclid is the
-- only available signal — hence a dedicated boolean rather than a utm value.
--
-- p_has_fbclid DEFAULT NULL = unchanged behavior, so existing callers
-- (AcquisitionView / OverviewView, which pass only the first five params by
-- name) keep working. The has_fbclid flag mirrors the existing UTM attribution:
-- props-first (any session event carrying fbclid), falling back to the user's
-- profiles.first_source.fbclid.
--
-- NOTE: fbclid is on ALL FB/IG clicks (paid ads AND organic posts/shares), so
-- this segment is "FB/IG traffic", not strictly paid ads.

drop function if exists public.admin_signup_funnel(integer, text, text, text, boolean);

create function public.admin_signup_funnel(
  p_days integer default 30,
  p_source text default null,
  p_campaign text default null,
  p_content text default null,
  p_exclude_internal boolean default true,
  p_has_fbclid boolean default null
)
returns table(ord integer, step text, label text, branch text, sessions bigint, users bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_since timestamptz := now() - (greatest(1, least(p_days, 365)) || ' days')::interval;
  v_src   text := nullif(trim(coalesce(p_source,   '')), '');
  v_camp  text := nullif(trim(coalesce(p_campaign, '')), '');
  v_cont  text := nullif(trim(coalesce(p_content,  '')), '');
  v_has_fbclid boolean := p_has_fbclid;
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
  fbc_src as (
    select distinct e.session_id from ev e
    where e.props->>'fbclid' is not null or e.props->>'fbc' is not null
  ),
  attr_src as (
    select distinct on (e.session_id)
      e.session_id, e.props->>'utm_source' as src, e.props->>'utm_campaign' as campaign, e.props->>'utm_content' as content
    from ev e where e.props->>'utm_source' is not null order by e.session_id, e.occurred_at asc
  ),
  sess_user as (
    select distinct on (session_id) session_id, user_id from ev where user_id is not null order by session_id, occurred_at desc
  ),
  attr as (
    select s.session_id,
      coalesce(a.src, pr.first_source->>'utm_source') as src,
      coalesce(a.campaign, pr.first_source->>'utm_campaign') as campaign,
      coalesce(a.content, pr.first_source->>'utm_content') as content,
      (fb.session_id is not null) or (pr.first_source->>'fbclid' is not null) as has_fbclid
    from sessions_all s
    left join attr_src a on a.session_id = s.session_id
    left join sess_user su on su.session_id = s.session_id
    left join public.profiles pr on pr.user_id = su.user_id
    left join fbc_src fb on fb.session_id = s.session_id
  ),
  sel as (
    select a.session_id from attr a
    where (v_src is null or lower(a.src) = lower(v_src))
      and (v_camp is null or lower(a.campaign) = lower(v_camp))
      and (v_cont is null or a.content = v_cont)
      and (v_has_fbclid is null or a.has_fbclid = v_has_fbclid)
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
    select e.event, count(distinct e.session_id) as sessions, count(distinct e.user_id) as users
    from ev e join sel on sel.session_id = e.session_id group by e.event
  )
  select st.ord, st.step, st.label, st.branch,
         coalesce(c.sessions, 0)::bigint as sessions, coalesce(c.users, 0)::bigint as users
  from steps st left join counts c on c.event = st.step order by st.ord;
end $function$;

grant execute on function public.admin_signup_funnel(integer,text,text,text,boolean,boolean) to authenticated;
