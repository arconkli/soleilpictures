-- 0363 — fixes from the adversarial review of 0360/0361 (2026-10-05).
--
-- (0362 is the email session's review fix, renumbered when 0360/0361 landed.)
--
-- 1. The day-one greeting's own impression is passive. resume_greet_shown is
--    logged when a person comes back to a tab on day one; it is not something
--    they did. It joins the passive lists of _admin_visits (0322, body otherwise
--    unchanged) and _admin_day_one_sittings (0361). Without it, a glance that only
--    showed the toast counted as a second sitting — inflating the metric that
--    grades the greeting — and, across UTC midnight, as a visit. The click on its
--    action (resume_greet_action) stays real. No row of the event exists yet, so
--    nothing historical moves.
-- 2. admin_second_sitting summed day-one cards over a LEFT JOIN, and the null row
--    of a user with no placement fell through to ELSE 1: zero-card users scored
--    one card and band 0 never appeared. And a visit that began yesterday can
--    still be running (0322 merges the next UTC day's first hours into visit 1),
--    so finished visits are now first_day <= today - 2.
-- 3. admin_built_return bands by the same card count (sum of props.n, null-safe)
--    as the panel beside it. The any-visit read (0322) keeps its event count.
-- 4. check_discovery_pipelines: a lagged page-drop baseline (see the branch),
--    email reads through _email_domain_is_ours (a failed send never gets a
--    domain, so a LIKE dropped it), and a dead email webhook is its own alert.
--
-- Every function keeps its signature, so CREATE OR REPLACE keeps its ACL; the
-- proof block at the end asserts that rather than trusting it.

create or replace function public._admin_visits(
  p_since date,
  p_exclude_internal boolean,
  p_verified_only boolean,
  p_merge_hours int
)
returns table (
  user_id uuid,
  k int,
  day date,
  first_at timestamptz,
  last_at timestamptz,
  did_work boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with u as (
    select usr.id as user_id
      from auth.users usr
     where usr.created_at >= p_since
       and (not p_verified_only
            or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  -- One row per UTC day per user, with whether anything real happened. The
  -- passive list is telemetry the client emits on its own schedule; a day made
  -- only of these is a tab, not a person.
  days as (
    select e.user_id,
           (e.occurred_at at time zone 'utc')::date as day,
           min(e.occurred_at) as first_at,
           max(e.occurred_at) as last_at,
           bool_or(e.event not in (
             'ps_heartbeat', 'ps_pause', 'ps_trace', 'session_summary', 'up_suppressed',
             'experiment_enrolled', 'ps_tier_resolved', 'lp_trace', 'app_trace', 'up_trace',
             'ps_seed_skip', 'ps_seed_start', 'ps_seed_done', 'instant_entry_skip',
             'lp_dwell', 'landing_dwell', 'pricing_dwell', 'ps_end', 'telemetry_drop',
             'resume_greet_shown'
           )) as real
      from public.analytics_events e
      join u on u.user_id = e.user_id
     group by e.user_id, (e.occurred_at at time zone 'utc')::date
  ),
  -- A day starts a NEW visit unless it begins within p_merge_hours of the
  -- previous day's last event — that is the same sitting crossing midnight.
  marked as (
    select d.*,
           case when d.first_at - lag(d.last_at) over (partition by d.user_id order by d.day)
                     < make_interval(hours => greatest(coalesce(p_merge_hours, 0), 0))
                then 0 else 1 end as nv
      from days d
  ),
  numbered as (
    select m.*, sum(m.nv) over (partition by m.user_id order by m.day) as vn
      from marked m
  ),
  merged as (
    select n.user_id, n.vn,
           min(n.day) as day,
           min(n.first_at) as first_at,
           max(n.last_at) as last_at,
           bool_or(n.real) as real,
           bool_or(exists (
             select 1 from public.user_active_day a
              where a.user_id = n.user_id and a.day = n.day and a.did_work
           )) as did_work
      from numbered n
     group by n.user_id, n.vn
  )
  -- Renumber AFTER dropping phantom visits, so k=2 is the second time a person
  -- actually showed up, not the second calendar day a tab was alive.
  select m.user_id,
         row_number() over (partition by m.user_id order by m.first_at)::int as k,
         m.day, m.first_at, m.last_at, m.did_work
    from merged m
   where m.real
$$;

create or replace function public._admin_day_one_sittings(
  p_since date,
  p_exclude_internal boolean,
  p_verified_only boolean,
  p_merge_hours int,
  p_gap_minutes int
)
returns table (
  user_id uuid,
  first_day date,
  first_at timestamptz,
  sittings int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with v1 as (
    select v.user_id, v.day, v.first_at, v.last_at
      from public._admin_visits(p_since, p_exclude_internal, p_verified_only, p_merge_hours) v
     where v.k = 1
  ),
  -- 0322's passive list, plus the two summaries that also fire on their own
  -- schedule (an upsell exposure summary and a share-page dwell beacon).
  ev as (
    select v1.user_id, e.occurred_at,
           lag(e.occurred_at) over (partition by v1.user_id order by e.occurred_at) as prev_at
      from v1
      join public.analytics_events e
        on e.user_id = v1.user_id
       and e.occurred_at between v1.first_at and v1.last_at
       and e.event not in (
         'ps_heartbeat', 'ps_pause', 'ps_trace', 'session_summary', 'up_suppressed',
         'experiment_enrolled', 'ps_tier_resolved', 'lp_trace', 'app_trace', 'up_trace',
         'ps_seed_skip', 'ps_seed_start', 'ps_seed_done', 'instant_entry_skip',
         'lp_dwell', 'landing_dwell', 'pricing_dwell', 'ps_end', 'telemetry_drop',
         'up_exposure_summary', 'share_dwell', 'resume_greet_shown'
       )
  )
  select v1.user_id, v1.day, v1.first_at,
         (1 + count(ev.prev_at) filter (
                where ev.occurred_at - ev.prev_at > make_interval(mins => greatest(coalesce(p_gap_minutes, 30), 5))
              ))::int as sittings
    from v1
    left join ev on ev.user_id = v1.user_id
   group by v1.user_id, v1.day, v1.first_at
$$;

create or replace function public.admin_second_sitting(
  p_since date default '2026-08-17',
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2,
  p_weeks int default 12,
  p_gap_minutes int default 30
)
returns table (
  dim text,
  n int,
  returned int,
  pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
  v_gap int    := least(greatest(coalesce(p_gap_minutes, 30), 5), 240);
begin
  perform public._require_admin();

  return query
  with s as (
    select * from public._admin_day_one_sittings(v_since, p_exclude_internal, p_verified_only, v_merge, v_gap)
     -- A first visit still in progress could gain a sitting; read finished visits
     -- only. Two days, not one: 0322 merges the next UTC day's first hours into
     -- visit 1, so a visit that began yesterday can still be running today.
     where first_day <= current_date - 2
  ),
  v as (
    select * from public._admin_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
  ),
  base as (
    select s.user_id, s.first_day, (s.sittings >= 2) as two_sit,
           -- 0322's 7-day return, only for first visits at least 8 days old.
           case when s.first_day <= current_date - 8 then
             exists (select 1 from v v2
                      where v2.user_id = s.user_id and v2.k = 2
                        and v2.first_at <= s.first_at + interval '7 days')
           end as ret7
      from s
  ),
  d1 as (
    select b.user_id,
           coalesce(sum(case when e.id is null then 0
                             when e.props->>'n' ~ '^[0-9]{1,6}$' then (e.props->>'n')::int
                             else 1 end), 0)::int as cards
      from base b
      join auth.users usr on usr.id = b.user_id
      left join public.analytics_events e
        on e.user_id = b.user_id
       and e.event = 'card_placed'
       and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by b.user_id
  ),
  dev as (
    select b.user_id, mode() within group (order by e.props->>'device_type') as device
      from base b
      join auth.users usr on usr.id = b.user_id
      join public.analytics_events e
        on e.user_id = b.user_id
       and e.props ? 'device_type'
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by b.user_id
  ),
  src as (
    select b.user_id,
           case
             when p.first_source->>'referrer_host' ilike '%chatgpt%'
               or p.first_source->>'utm_source' in ('chatgpt.com', 'openai')          then 'chatgpt'
             when p.first_source->>'share_token' is not null
               or p.first_source->>'utm_source' in ('share_link', 'public_board')
               or p.first_source->>'landing_path' like '/share/%'                    then 'share'
             when p.first_source->>'landing_path' like '/vs/%'
               or p.first_source->>'landing_path' like '/best/%'
               or p.first_source->>'landing_path' like '/tools/%'                    then 'seo'
             when p.first_source->>'referrer_host' ilike '%google.%'                then 'google'
             when p.first_source->>'referrer_host' ilike '%reddit%'                 then 'reddit'
             when coalesce(p.first_source->>'referrer_host', '') = ''               then 'direct'
             else 'other'
           end as source
      from base b
      left join public.profiles p on p.user_id = b.user_id
  ),
  banded as (
    select b.*,
           case when c.cards = 0 then '0' when c.cards <= 2 then '1-2'
                when c.cards <= 5 then '3-5' when c.cards <= 12 then '6-12' else '13+' end as band,
           case when c.cards <= 2 then '0-2' when c.cards <= 12 then '3-12' else '13+' end as band3
      from base b
      join d1 c on c.user_id = b.user_id
  ),
  rows_ as (
    -- returned = HAD A SECOND SITTING
    select 'all'::text as dim, b.two_sit as hit from base b
    union all
    select 'device:' || coalesce(d.device, 'unknown'), b.two_sit
      from base b left join dev d on d.user_id = b.user_id
    union all
    select 'source:' || s2.source, b.two_sit
      from base b join src s2 on s2.user_id = b.user_id
    union all
    select 'band:' || x.band, x.two_sit from banded x
    union all
    select 'week:' || to_char(date_trunc('week', b.first_day), 'YYYY-MM-DD'), b.two_sit
      from base b
     where b.first_day >= current_date - (7 * v_weeks)
    union all
    -- returned = BACK WITHIN 7 DAYS, split by sittings inside a depth band
    select 'link:' || x.band3 || (case when x.two_sit then ' · two+ sittings' else ' · one sitting' end), x.ret7
      from banded x
     where x.ret7 is not null
  )
  select x.dim,
         count(*)::int,
         sum(x.hit::int)::int,
         round(sum(x.hit::int)::numeric / nullif(count(*), 0), 4)
    from rows_ x
   group by x.dim
   order by x.dim;
end $$;

create or replace function public.admin_built_return(
  p_since date default '2026-08-17',
  p_horizon_days int default 7,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2,
  p_weeks int default 12
)
returns table (
  dim text,
  n int,
  returned int,
  pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_h int      := least(greatest(coalesce(p_horizon_days, 7), 1), 90);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_engaged_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
  ),
  ret as (
    select f.user_id, f.first_at, f.day,
           exists (
             select 1 from v v2
              where v2.user_id = f.user_id and v2.k >= 2 and v2.worked
                and v2.first_at <= f.first_at + make_interval(days => v_h)
           ) as returned
      from v f
     where f.k = 1
       and f.day <= current_date - v_h
  ),
  d1 as (
    select r.user_id,
           coalesce(sum(case when e.id is null then 0
                             when e.props->>'n' ~ '^[0-9]{1,6}$' then (e.props->>'n')::int
                             else 1 end), 0)::int as cards
      from ret r
      join auth.users usr on usr.id = r.user_id
      left join public.analytics_events e
        on e.user_id = r.user_id
       and e.event = 'card_placed'
       and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by r.user_id
  ),
  dev as (
    select r.user_id, mode() within group (order by e.props->>'device_type') as device
      from ret r
      join auth.users usr on usr.id = r.user_id
      join public.analytics_events e
        on e.user_id = r.user_id
       and e.props ? 'device_type'
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by r.user_id
  ),
  src as (
    select r.user_id,
           case
             when p.first_source->>'referrer_host' ilike '%chatgpt%'
               or p.first_source->>'utm_source' in ('chatgpt.com', 'openai')          then 'chatgpt'
             when p.first_source->>'share_token' is not null
               or p.first_source->>'utm_source' in ('share_link', 'public_board')
               or p.first_source->>'landing_path' like '/share/%'                    then 'share'
             when p.first_source->>'landing_path' like '/vs/%'
               or p.first_source->>'landing_path' like '/best/%'
               or p.first_source->>'landing_path' like '/tools/%'                    then 'seo'
             when p.first_source->>'referrer_host' ilike '%google.%'                then 'google'
             when p.first_source->>'referrer_host' ilike '%reddit%'                 then 'reddit'
             when coalesce(p.first_source->>'referrer_host', '') = ''               then 'direct'
             else 'other'
           end as source
      from ret r
      left join public.profiles p on p.user_id = r.user_id
  ),
  rows_ as (
    select 'all'::text as dim, r.returned from ret r
    union all
    select 'device:' || coalesce(d.device, 'unknown'), r.returned
      from ret r left join dev d on d.user_id = r.user_id
    union all
    select 'source:' || s.source, r.returned
      from ret r join src s on s.user_id = r.user_id
    union all
    select 'band:' || case
             when c.cards = 0 then '0' when c.cards <= 2 then '1-2'
             when c.cards <= 5 then '3-5' when c.cards <= 12 then '6-12' else '13+' end,
           r.returned
      from ret r join d1 c on c.user_id = r.user_id
    union all
    select 'week:' || to_char(date_trunc('week', r.day), 'YYYY-MM-DD'), r.returned
      from ret r
     where r.day >= current_date - (7 * v_weeks)
  )
  select x.dim,
         count(*)::int,
         sum(x.returned::int)::int,
         round(sum(x.returned::int)::numeric / nullif(count(*), 0), 4)
    from rows_ x
   group by x.dim
   order by x.dim;
end $$;

create or replace function public.check_discovery_pipelines()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_n      int := 0;
  v_gsc    date;
  v_crawl  date;
  v_health timestamptz;
  v_aeo    record;
  v_page   record;
  v_mail   record;
  v_vol    record;
  v_last_otp timestamptz;
  v_new_accts int;
begin
  -- gsc-sync: GSC lags 2–3 days and the sync re-reads a 10-day tail daily, so
  -- an honest last day is today-3 or today-4. Five tolerates one missed run.
  select max(day) into v_gsc from public.seo_page_daily;
  if v_gsc is null or v_gsc < current_date - 5 then
    if public._discovery_alert('gsc-sync stale',
         'seo_page_daily last day ' || coalesce(v_gsc::text, 'none') ||
         ' — cron gsc-sync-daily (05:45 UTC) has not written a newer day') then v_n := v_n + 1; end if;
  end if;

  -- AEO probe: weekly. Eight days covers one late fire; a run that errored on
  -- half or more of its questions is a failing probe, not a citation collapse.
  select run_at, asked, failed into v_aeo
    from public.aeo_retrieval_runs order by run_at desc limit 1;
  if v_aeo.run_at is null or v_aeo.run_at < now() - interval '8 days' then
    if public._discovery_alert('AEO probe stale',
         'last aeo_retrieval_runs row ' || coalesce(v_aeo.run_at::text, 'none') ||
         ' — the Worker cron did not record a weekly sweep') then v_n := v_n + 1; end if;
  elsif coalesce(v_aeo.asked, 0) > 0 and coalesce(v_aeo.failed, 0) * 2 >= v_aeo.asked then
    if public._discovery_alert('AEO probe failing',
         v_aeo.failed || ' of ' || v_aeo.asked || ' questions errored in the latest sweep (' ||
         v_aeo.run_at::text || ')') then v_n := v_n + 1; end if;
  end if;

  -- Crawlers: OAI-SearchBot, ClaudeBot, PerplexityBot etc. fetch daily. Two
  -- silent days means the Worker stopped recording (or the zone started
  -- blocking AI crawlers), either of which costs the AI channel quietly.
  select max(day) into v_crawl from public.crawler_hits where kind = 'ai';
  if v_crawl is null or v_crawl < current_date - 2 then
    if public._discovery_alert('AI crawler silence',
         'no crawler_hits row with kind=ai since ' || coalesce(v_crawl::text, 'ever')) then v_n := v_n + 1; end if;
  end if;

  -- seo-health: every 6h. Thirteen hours is two consecutive misses.
  select max(run_at) into v_health from public.seo_health_runs;
  if v_health is null or v_health < now() - interval '13 hours' then
    if public._discovery_alert('seo-health prober stale',
         'last seo_health_runs row ' || coalesce(v_health::text, 'none')) then v_n := v_n + 1; end if;
  end if;

  -- 0360 (1): a top page Google stopped showing. Page-level rows only
  -- (query = ''), web only. Anchor = the newest GSC day minus one; the recent
  -- window is the three days ending there. 0363: the baseline is LAGGED — the
  -- fourteen days ending 17 days before the anchor — so a long outage cannot
  -- erode the baseline it is measured against and go quiet while the page is
  -- still gone (it keeps alerting for about two and a half weeks).
  if v_gsc is not null then
    for v_page in
      with pg as (
        select path, day, impressions
          from public.seo_page_daily
         where query = '' and search_type = 'web'
           and day between v_gsc - 31 and v_gsc - 1
      ),
      base as (
        select path, sum(impressions)::numeric / 14 as base_mean
          from pg
         where day between v_gsc - 31 and v_gsc - 18
         group by path
      ),
      top as (
        select path, base_mean
          from base
         where base_mean >= 20
         order by base_mean desc
         limit 5
      )
      select t.path, t.base_mean,
             coalesce((select sum(p.impressions) from pg p
                        where p.path = t.path and p.day between v_gsc - 3 and v_gsc - 1), 0)::numeric / 3
               as recent_mean
        from top t
    loop
      if v_page.recent_mean < 0.3 * v_page.base_mean then
        if public._discovery_alert('Google dropped ' || v_page.path,
             v_page.path || ' averaged ' || round(v_page.recent_mean)::text ||
             ' web impressions/day over the 3 days to ' || (v_gsc - 1)::text ||
             ' against ' || round(v_page.base_mean)::text || '/day in a baseline fortnight a month back. seo-health cannot see this '
             '(it checks our server, not Google) — check Search Console URL Inspection for the page.') then
          v_n := v_n + 1;
        end if;
      end if;
    end loop;
  end if;

  -- 0360 (2): sign-in code email health. category 'external' + our sending
  -- domain = the Supabase Auth code email; internal recipients excluded.
  select count(*) filter (where s.is_gmail)                             as gmail_sends,
         count(*) filter (where s.is_gmail and s.opened_at is not null) as gmail_opened,
         count(*)                                                       as sends,
         count(s.bounced_at)                                            as bounced
    into v_mail
    from (
      select es.opened_at, es.bounced_at,
             split_part(lower(es.recipient_email), '@', 2) in ('gmail.com', 'googlemail.com') as is_gmail
        from public.email_sends es
       where es.category = 'external'
         and public._email_domain_is_ours(es.sending_domain)
         and es.sent_at >= now() - interval '72 hours'
         and es.sent_at <  now() - interval '1 hour'
         and not exists (
           select 1
             from auth.users u
             join public._internal_user_ids() i on i.user_id = u.id
            where lower(u.email) = lower(es.recipient_email)
         )
    ) s;

  if v_mail.gmail_sends >= 12 and v_mail.gmail_opened::numeric / v_mail.gmail_sends < 0.35 then
    if public._discovery_alert('Sign-in email opens collapsed',
         v_mail.gmail_opened || ' of ' || v_mail.gmail_sends ||
         ' sign-in code emails to Gmail were opened in the last 72h. Likely spam placement for the shared '
         'sending domain — check Google Postmaster Tools, and whether app mail spiked.') then v_n := v_n + 1; end if;
  end if;

  if v_mail.sends >= 8 and v_mail.bounced::numeric / v_mail.sends >= 0.25 then
    if public._discovery_alert('Sign-in email bounces spiked',
         v_mail.bounced || ' of ' || v_mail.sends ||
         ' sign-in code emails bounced in the last 72h — check the sending domain and the auth SMTP settings.') then
      v_n := v_n + 1;
    end if;
  end if;

  -- 0360 (3): app mail volume. Yesterday (UTC) against the median of the
  -- fourteen days before it, with empty days counted as zero.
  with daily as (
    select es.sent_at::date as d, count(*) as n
      from public.email_sends es
     where es.category is distinct from 'external'
       and public._email_domain_is_ours(es.sending_domain)
       and es.sent_at >= current_date - 15
       and es.sent_at <  current_date
     group by 1
  ),
  days as (
    select g::date as d, coalesce(daily.n, 0) as n
      from generate_series(current_date - 15, current_date - 1, interval '1 day') g
      left join daily on daily.d = g::date
  )
  select (select n from days where d = current_date - 1) as yday,
         (select percentile_cont(0.5) within group (order by n) from days where d < current_date - 1) as med,
         (select es.template
            from public.email_sends es
           where es.category is distinct from 'external'
             and public._email_domain_is_ours(es.sending_domain)
             and es.sent_at >= current_date - 1 and es.sent_at < current_date
           group by es.template
           order by count(*) desc
           limit 1) as top_template
    into v_vol;

  if coalesce(v_vol.yday, 0) > greatest(200, 10 * coalesce(v_vol.med, 0)) then
    if public._discovery_alert('App email volume spike',
         v_vol.yday || ' app emails sent on ' || (current_date - 1)::text || ' against a median of ' ||
         round(coalesce(v_vol.med, 0))::text || '/day; most were ' || coalesce(v_vol.top_template, '?') ||
         '. Abuse of a user-triggered email spends the domain reputation the sign-in code relies on.') then
      v_n := v_n + 1;
    end if;
  end if;

  -- 0363: the sign-in code rows come only from the Resend webhook. If it
  -- stops (a rotated secret, a failing handler), every email alert above goes
  -- quiet with it — so its silence is an alert of its own: accounts kept being
  -- created for a day and not one code email was recorded.
  select max(es.sent_at) into v_last_otp
    from public.email_sends es
   where es.category = 'external' and public._email_domain_is_ours(es.sending_domain);
  select count(*) into v_new_accts
    from auth.users u
   where u.created_at > now() - interval '24 hours'
     and not exists (select 1 from public._internal_user_ids() i where i.user_id = u.id);
  if v_new_accts >= 3 and (v_last_otp is null or v_last_otp < now() - interval '24 hours') then
    if public._discovery_alert('Sign-in email rows missing',
         v_new_accts || ' accounts were created in the last 24h but no sign-in code email was recorded since ' ||
         coalesce(v_last_otp::text, 'ever') || ' — check the Resend webhook (resend-webhook) and its secret.') then
      v_n := v_n + 1;
    end if;
  end if;

  return v_n;
end $fn$;

do $proof$
declare
  f text;
begin
  foreach f in array array['public._admin_visits(date, boolean, boolean, integer)',
                           'public._admin_day_one_sittings(date, boolean, boolean, integer, integer)',
                           'public.check_discovery_pipelines()'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '% is executable by anon', f; end if;
    if has_function_privilege('authenticated', f, 'execute') then raise exception '% is executable by authenticated', f; end if;
  end loop;
  foreach f in array array['public.admin_second_sitting(date, boolean, boolean, integer, integer, integer)',
                           'public.admin_built_return(date, integer, boolean, boolean, integer, integer)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '% is executable by anon', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception '% is not executable by authenticated', f; end if;
  end loop;
end $proof$;
