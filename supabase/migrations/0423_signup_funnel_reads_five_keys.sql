-- 0423_signup_funnel_reads_five_keys.sql
--
-- admin_signup_funnel stops carrying every event's whole props JSONB through
-- its CTE, and keeps only the five keys it reads. Nothing else changes.
--
-- WHY
-- The admin dashboard timed out on it (57014, the 8s `authenticated`
-- statement_timeout) twice on 2026-10-18, alongside admin_funnel_segments six
-- times, and a dozen admin RPCs the day before. Warm, alone, each of them
-- finishes well inside the limit. They fail when the dashboard fires them
-- together, and this one is the heaviest neighbour: `ev` is referenced five
-- times, so Postgres materialises it, and it held `e.props` for every event in
-- the window. 0286 gave it work_mem=16MB as a stopgap until this per-function
-- rewrite landed, and warned that analytics_events would outgrow it. It has.
-- Measured on one call, warm:
--
--   p_days   temp written before   temp written after
--   30       5,472 blocks (43 MB)  0
--   90       9,809 blocks (77 MB)  0
--   365     10,732 blocks (84 MB)  1,095 blocks (8.5 MB)
--
-- This is the same fix 0286 applied to admin_funnel_segments: project the
-- keys, don't carry the document. fbclid/fbc collapse to the one boolean that
-- fbc_src tests; the three utm keys stay text.
--
-- PROOF OF EQUIVALENCE (run before applying, as an admin, in one transaction
-- that was then rolled back): the old and new functions returned identical
-- rows, compared with EXCEPT ALL in both directions, for every one of
--   (30), (90), (365), (30, exclude_internal => false),
--   (90, source => the top utm_source), (90, has_fbclid => true),
--   (90, has_fbclid => false), (365, top source, false, true).
-- 0 differing rows in all eight.
--
-- `create or replace` keeps the function's ACL (postgres, authenticated,
-- service_role; no anon, no PUBLIC). The block at the end proves it.

create or replace function public.admin_signup_funnel(
  p_days integer default 30,
  p_source text default null::text,
  p_campaign text default null::text,
  p_content text default null::text,
  p_exclude_internal boolean default true,
  p_has_fbclid boolean default null::boolean
)
returns table(ord integer, step text, label text, branch text, sessions bigint, users bigint)
language plpgsql
stable security definer
set search_path to 'public'
set work_mem to '16MB'
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
    select e.session_id, e.user_id, e.event, e.occurred_at,
           (e.props->>'fbclid' is not null or e.props->>'fbc' is not null) as has_fbc,
           e.props->>'utm_source'   as utm_source,
           e.props->>'utm_campaign' as utm_campaign,
           e.props->>'utm_content'  as utm_content
    from public.analytics_events e
    where e.occurred_at >= v_since
      and e.session_id is not null
      and (not p_exclude_internal
           or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  sessions_all as (select distinct session_id from ev),
  fbc_src as (select distinct e.session_id from ev e where e.has_fbc),
  attr_src as (
    select distinct on (e.session_id)
      e.session_id, e.utm_source as src, e.utm_campaign as campaign, e.utm_content as content
    from ev e where e.utm_source is not null order by e.session_id, e.occurred_at asc
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

do $$
declare
  f constant text := 'public.admin_signup_funnel(integer,text,text,text,boolean,boolean)';
begin
  if has_function_privilege('anon', f, 'execute') then
    raise exception '0423: anon can execute %', f;
  end if;
  if not has_function_privilege('authenticated', f, 'execute') then
    raise exception '0423: authenticated lost execute on %', f;
  end if;
  if not has_function_privilege('service_role', f, 'execute') then
    raise exception '0423: service_role lost execute on %', f;
  end if;
  if (select prosecdef from pg_proc where oid = f::regprocedure) is not true then
    raise exception '0423: % is no longer security definer', f;
  end if;
end $$;
