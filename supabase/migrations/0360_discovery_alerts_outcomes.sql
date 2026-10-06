-- 0360 — the discovery check asks whether things WORKED, not only whether they ran.
--
-- (0353–0359 belong to other 2026-10 sessions; 0358/0359 are the invite-abuse
-- and email-recovery work.)
--
-- check_discovery_pipelines() (0335) asks one question of each pipeline: did it
-- run? In September three things went wrong that it could not see, because each
-- pipeline kept running:
--
-- 1. Google stopped showing /vs/pureref for eight days (2026-09-20..27) and
--    put it back on 09-28 with nothing changed on our side. That page is the
--    first landing of a large share of signups. seo-health stayed green the
--    whole time: it proves our server answers with the right title, not that
--    Google is showing the page. gsc-sync kept writing rows — just near-empty
--    ones for that path.
--    NEW "Google dropped <path>": the five pages with the most page-level web
--    impressions over a 14-day baseline (floor 20/day, so a quiet page's noise
--    can't page anyone) alert when the latest three days average under 30% of
--    it. The newest GSC day is skipped — Google restates the trailing days and
--    gsc-sync re-reads a 10-day tail for that reason. Backtested against the
--    restated series for every day 2026-08-20..09-30: it fires for /vs/pureref
--    on each day of the outage and for nothing else.
--
-- 2. One day of invite abuse (2026-09-20) sent far more mail from the shared
--    sending domain than a normal month, and Gmail then junked our SIGN-IN CODES
--    for most of a week — opens on them fell to almost none while new accounts
--    kept arriving that never got in. The code email is how every account
--    starts, so this is the most expensive mail we send.
--    NEW "Sign-in email opens collapsed": over the last 72 hours (the newest hour
--    skipped, so a code just sent can still be opened), code emails to Gmail —
--    at least 12 of them, internal recipients excluded — opened under 35% of the
--    time. Gmail only: it is where a reputation hit lands, Apple's privacy proxy
--    opens everything, and the rest are too few. Backtested daily
--    2026-08-10..10-05: fires on each day of the junk window and on no other day.
--    NEW "Sign-in email bounces spiked": a quarter or more of at least 8 code
--    emails bounced (a broken sending domain looks like this first).
--    email_sends also stores ANOTHER product's mail (a different sending
--    domain), so every read here is scoped to ours.
--
-- 3. Nothing noticed the abuse itself until people did.
--    NEW "App email volume spike": yesterday's app mail (everything but the code
--    email) above both 200 and ten times the median of the fourteen days before.
--    Normal lifecycle batches stay far under it; the 09-20 day was far over.
--    0358 now caps invites per account; this is the tripwire for whatever the
--    next unexpected sender is.
--
-- Every new branch reads tables that already exist and writes only through
-- _discovery_alert (client_errors kind=discovery_pipeline, deduped 20h — a
-- condition that persists re-alerts daily, like the failing-probe alert). The
-- function keeps its signature, so CREATE OR REPLACE keeps its ACL; the proof
-- block at the end asserts that rather than trusting it.

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
  -- window is the three days ending there, the baseline the fourteen before it.
  if v_gsc is not null then
    for v_page in
      with pg as (
        select path, day, impressions
          from public.seo_page_daily
         where query = '' and search_type = 'web'
           and day between v_gsc - 17 and v_gsc - 1
      ),
      base as (
        select path, sum(impressions)::numeric / 14 as base_mean
          from pg
         where day between v_gsc - 17 and v_gsc - 4
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
             ' against ' || round(v_page.base_mean)::text || '/day in the 14 before. seo-health cannot see this '
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
         and es.sending_domain like '%soleilpictures%'
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
       and es.sending_domain like '%soleilpictures%'
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
             and es.sending_domain like '%soleilpictures%'
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

  return v_n;
end $fn$;

comment on function public.check_discovery_pipelines() is
  'Daily check over the discovery pipelines and what they feed: gsc-sync, AEO probe, '
  'crawler_hits and seo-health freshness (0335); a top page Google stopped showing, '
  'sign-in code email opens/bounces, and an app-mail volume spike (0360). Writes '
  'client_errors kind=discovery_pipeline. Returns the number of NEW alerts raised.';

-- Proofs (0311 habit): CREATE OR REPLACE kept the signature, so it should have
-- kept the ACL — assert it instead of trusting it.
do $proof$
begin
  if has_function_privilege('anon', 'public.check_discovery_pipelines()', 'execute') then
    raise exception 'check_discovery_pipelines() is executable by anon';
  end if;
  if has_function_privilege('authenticated', 'public.check_discovery_pipelines()', 'execute') then
    raise exception 'check_discovery_pipelines() is executable by authenticated';
  end if;
  if not exists (select 1 from cron.job where jobname = 'discovery_pipelines_daily') then
    raise exception 'the discovery_pipelines_daily cron job is missing';
  end if;
end $proof$;
