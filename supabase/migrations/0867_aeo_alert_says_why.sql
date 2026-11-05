-- 0867 — the "AEO probe failing" alert says why the sweep failed.
--
-- The alert only counted: "N of M questions errored in the latest sweep". The
-- ChatGPT check failed for weeks (first a revoked key, then an account with no
-- credit) and nothing in the alert said which, so the cause had to be dug out
-- of aeo_retrieval_results by hand. The Worker already records the first line
-- of every failure there (worker-aeo.js askOnce throws "openai <status>: <body>",
-- the sweep keeps it in `error`). The alert now reads the first error of the
-- failing run and appends a plain reason and the fix: a rejected key, no
-- credit, rate limiting, an unknown model, a timeout, or the raw first error.
--
-- check_discovery_pipelines() is restated from 0480 verbatim. Only the
-- AEO-failing branch changes (and its two declarations). create or replace
-- keeps the ACL; the revoke below restates it and the proof checks it.
create or replace function public.check_discovery_pipelines()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_n      int := 0;
  v_gsc    date;
  v_crawl  date;
  v_health timestamptz;
  v_aeo    record;
  v_aeo_err text;
  v_page   record;
  v_mail   record;
  v_vol    record;
  v_last_otp timestamptz;
  v_new_accts int;
  v_ix_day date;
  v_ix     record;
  v_cnt    int;
  v_list   text;
  v_ping   record;
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
  select id, run_at, asked, failed into v_aeo
    from public.aeo_retrieval_runs order by run_at desc limit 1;
  if v_aeo.run_at is null or v_aeo.run_at < now() - interval '8 days' then
    if public._discovery_alert('AEO probe stale',
         'last aeo_retrieval_runs row ' || coalesce(v_aeo.run_at::text, 'none') ||
         ' — the Worker cron did not record a weekly sweep') then v_n := v_n + 1; end if;
  elsif coalesce(v_aeo.asked, 0) > 0 and coalesce(v_aeo.failed, 0) * 2 >= v_aeo.asked then
    -- worker-aeo.js records "openai <status>: <first 200 bytes of the body>";
    -- an AbortSignal.timeout abort reads "The operation was aborted due to timeout".
    select error into v_aeo_err from public.aeo_retrieval_results
     where run_id = v_aeo.id and error is not null order by id limit 1;
    if public._discovery_alert('AEO probe failing',
         v_aeo.failed || ' of ' || v_aeo.asked || ' questions errored in the latest sweep (' ||
         v_aeo.run_at::text || '): ' ||
         case
           when v_aeo_err ~ '^openai 401'
             then 'OpenAI rejected the key (revoked or wrong): replace OPENAI_API_KEY on the soleil-boards Worker in Cloudflare'
           when v_aeo_err ~ '^openai 429' and v_aeo_err ilike '%insufficient_quota%'
             then 'the OpenAI account is out of credit: add credit to the org that owns the key'
           when v_aeo_err ~ '^openai 429'
             then 'OpenAI rate-limited the sweep'
           when v_aeo_err ~ '^openai 404' or v_aeo_err ~* 'model.{0,80}does not exist|model_not_found'
             then 'OpenAI does not know the model: check the model in boards/src/worker-aeo.js (or AEO_PROBE_MODEL on the Worker)'
           when v_aeo_err ~* 'aborted due to timeout|timed out|timeout'
             then 'OpenAI timed out'
           else 'first error: ' || left(coalesce(v_aeo_err, 'none recorded'), 200)
         end) then v_n := v_n + 1; end if;
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

  -- 0480 (1): index coverage, from Google's URL Inspection API (gsc-sync mode
  -- 'inspect', cron gsc-inspect-daily 06:30 UTC). Error rows carry no verdict
  -- and are never read as "not indexed". Each alert keeps a FIXED name and puts
  -- the pages in the message: admin_markers (0372) folds re-fires by name.
  select max(day) into v_ix_day from public.seo_index_status;
  if v_ix_day is null or v_ix_day < current_date - 2 then
    if public._discovery_alert('Index coverage check stale',
         'last seo_index_status day ' || coalesce(v_ix_day::text, 'none') ||
         ' — cron gsc-inspect-daily (06:30 UTC) has not recorded a newer day') then v_n := v_n + 1; end if;
  else
    select count(*) as n,
           count(*) filter (where s.error is not null) as failed,
           min(s.error) as sample
      into v_ix
      from public.seo_index_status s
     where s.day = v_ix_day;
    if v_ix.failed * 2 >= v_ix.n then
      if public._discovery_alert('Index coverage check failing',
           v_ix.failed || ' of ' || v_ix.n || ' URL inspections errored on ' || v_ix_day::text ||
           ', e.g. ' || coalesce(v_ix.sample, '?')) then v_n := v_n + 1; end if;
    else
      -- A page Google had indexed in the past week and no longer does: the
      -- marketing pages, and any other page that earned 50+ page-level web
      -- impressions in the last month. One alert a day names every such page,
      -- grouped under Search Console's reason. The count leads because
      -- _discovery_alert keeps 500 characters of a message.
      select sum(g.n)::int, string_agg(g.state || ': ' || g.paths, '; ' order by g.state)
        into v_cnt, v_list
        from (select coalesce(s.coverage_state, s.verdict, '?') as state, count(*) as n,
                     string_agg(s.path, ', ' order by s.path) as paths
                from public.seo_index_status s
               where s.day = v_ix_day
                 and s.error is null
                 and s.verdict is distinct from 'PASS'
                 and exists (select 1 from public.seo_index_status p
                              where p.path = s.path and p.error is null and p.verdict = 'PASS'
                                and p.day between v_ix_day - 7 and v_ix_day - 1)
                 and (s.path = '/' or s.path ~ '^/(pricing|explore|use-cases|changelog|scout)$'
                      or s.path ~ '^/(tools|vs|best)/'
                      or (select coalesce(sum(d.impressions), 0) from public.seo_page_daily d
                           where d.path = s.path and d.query = '' and d.search_type = 'web'
                             and d.day > current_date - 31) >= 50)
               group by 1) g;
      if v_list is not null then
        if public._discovery_alert('Google de-indexed a page',
             v_cnt || ' page(s) Google had on its index within the past week and no longer does. ' || v_list) then
          v_n := v_n + 1;
        end if;
      end if;

      -- A marketing page on its fourteenth straight inspection day off Google.
      -- Raised on that day only, so each page is named once rather than every
      -- morning it stays out.
      with m as (
        select s.path, s.day, s.verdict, s.coverage_state,
               row_number() over (partition by s.path order by s.day desc) as rn
          from public.seo_index_status s
         where s.error is null and s.day > v_ix_day - 60
           and (s.path = '/' or s.path ~ '^/(pricing|explore|use-cases|changelog|scout)$'
                or s.path ~ '^/(tools|vs|best)/')
      ),
      streak as (
        select path,
               coalesce(min(rn) filter (where verdict = 'PASS'), max(rn) + 1) - 1 as days_out,
               max(coverage_state) filter (where rn = 1) as state,
               max(day) as last_day
          from m
         group by path
      ),
      due as (
        select coalesce(state, '?') as state, count(*) as n, string_agg(path, ', ' order by path) as paths
          from streak
         where days_out = 14 and last_day = v_ix_day
         group by 1
      )
      select sum(n)::int, string_agg(state || ': ' || paths, '; ' order by state)
        into v_cnt, v_list
        from due;
      if v_list is not null then
        if public._discovery_alert('Pages not indexed after 14 days',
             v_cnt || ' marketing page(s) still off Google after 14 daily checks; request indexing in Search Console. ' || v_list) then
          v_n := v_n + 1;
        end if;
      end if;
    end if;
  end if;

  -- 0480 (2): IndexNow. The Worker's hourly cron pings once per new production
  -- build and makes three attempts an hour apart; a build whose attempts all
  -- failed has given up, and Bing never heard what changed in it.
  select p.build_sha, p.status, p.error, p.pinged_at into v_ping
    from public.indexnow_pings p
   where p.pinged_at > now() - interval '7 days'
   order by p.pinged_at desc
   limit 1;
  if v_ping.build_sha is not null
     and not exists (select 1 from public.indexnow_pings p where p.build_sha = v_ping.build_sha and p.ok)
     and (select count(*) from public.indexnow_pings p where p.build_sha = v_ping.build_sha) >= 3 then
    if public._discovery_alert('IndexNow failing',
         'all three IndexNow attempts for build ' || v_ping.build_sha || ' failed (' ||
         coalesce('HTTP ' || v_ping.status::text, v_ping.error, '?') ||
         ') — Bing and Yandex were not told what changed in it') then v_n := v_n + 1; end if;
  end if;

  return v_n;
end $fn$;
revoke execute on function public.check_discovery_pipelines() from public, anon, authenticated;

-- Proof (0311 habit): assert the grants rather than trust the statement.
do $proof$
begin
  if has_function_privilege('anon', 'public.check_discovery_pipelines()', 'execute')
     or has_function_privilege('authenticated', 'public.check_discovery_pipelines()', 'execute') then
    raise exception '0867: check_discovery_pipelines() is executable by a client';
  end if;
end $proof$;
