-- 0335 — AI assistants as ONE acquisition vocabulary, and alerts for the
-- discovery pipelines that had none.
--
-- WHY (2026-09-17 audit, live data):
--
--   ChatGPT became the second-largest signup source over one month, and about
--   half of those arrivals carry NO referrer: ChatGPT strips it and appends
--   `utm_source=chatgpt.com` instead. Every reader keyed on referrer_host alone
--   (admin_ai_referrals, the scorecard's referrer classes, admin_seo_referrers,
--   admin_seo_page_stats), so the AI channel read roughly two thirds of its
--   true size. derive_acquisition_channel had no AI arm at all: the same
--   visitor was branded 'chatgpt.com' (utm) or 'chatgpt' (referrer), Gemini
--   fell through to 'google', Copilot to 'bing'.
--
--   seo_referrer_class carried two patterns that could never match — callers
--   pass a bare hostname and `duckduckgo.com/chat` / `kagi.com/assistant` have
--   paths (no referrer_host in 90 days contains one) — and missed hosts that
--   do arrive: duck.ai (→ referral), search.yahoo.com (→ referral), the Gmail
--   Android app com.google.android.gm (→ search), classroom.google.com (→ search).
--
--   The AEO retrieval probe (0296) had failed 16 of 16 questions across both
--   runs it ever made — OpenAI 'insufficient_quota' — and nothing said so:
--   record_aeo_retrieval stored the errors and returned. A probe that fails
--   closed looks exactly like being dropped from every answer. gsc-sync,
--   crawler_hits and seo-health likewise had no staleness signal; only a
--   failing seo-health CHECK wrote an alert, a seo-health that stopped running
--   wrote nothing.
--
-- Contents: (1) seo_referrer_class v3, (2) seo_source_class(host, utm),
-- (3) derive_acquisition_channel v4 with the AI arm FIRST, (4) the four
-- readers re-pointed, (5) record_aeo_retrieval alerts, (6) a daily
-- pipeline-freshness check on pg_cron, (7) grant proofs + behaviour asserts.

-----------------------------------------------------------------------
-- 1. seo_referrer_class v3 — anchored hosts, no path patterns, real hosts.
-----------------------------------------------------------------------
create or replace function public.seo_referrer_class(p_host text)
returns text language sql immutable set search_path = public, extensions as $fn$
  select case
    when p_host is null or p_host = '' then 'direct'
    -- Android app package names arrive as the "host". Only the Google search
    -- app is a search arrival; the Gmail app (com.google.android.gm) is not.
    when p_host ~* '^(android-app://)?com\.google\.android\.googlequicksearchbox' then 'search'
    when p_host ~* '^(android-app://)?com\.' then 'referral'
    when p_host ~* '(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|gemini\.google\.com|notebooklm\.google\.com|aistudio\.google\.com|copilot\.microsoft\.com|copilot\.cloud\.microsoft|m365\.cloud\.microsoft|claude\.ai|claude\.com|you\.com|phind\.com|grok\.com|x\.ai|poe\.com|mistral\.ai|duck\.ai|meta\.ai|deepseek\.com|kimi\.com|qwen\.ai|huggingface\.co|genspark\.ai|felo\.ai|t3\.chat)$' then 'ai'
    -- A Google-owned product that is not search.
    when p_host ~* '^classroom\.google\.com$' then 'referral'
    when p_host ~* '(^|\.)((google|bing|duckduckgo|ecosia|qwant|startpage|yandex|yahoo|kagi)\.[a-z.]+|search\.brave\.com)$' then 'search'
    when p_host ~* '(^|\.)(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|reddit\.com|tiktok\.com|youtube\.com|news\.ycombinator\.com)$'
      or p_host ~* '(^|\.)pinterest\.' then 'social'
    else 'referral'
  end
$fn$;

comment on function public.seo_referrer_class(text) is
  'Referrer HOST → direct|ai|search|social|referral, checked in that order. '
  'Hostname only — a path pattern here can never match (readReferrer strips '
  'the path). DuckDuckGo AI chat and Kagi Assistant are indistinguishable from '
  'their search hosts and land in search on purpose. For utm-tagged arrivals '
  '(ChatGPT strips its referrer and appends utm_source=chatgpt.com) use '
  'seo_source_class(host, utm_source).';

-----------------------------------------------------------------------
-- 2. seo_source_class — the classifier readers should call.
-----------------------------------------------------------------------
create or replace function public.seo_source_class(p_host text, p_utm_source text)
returns text language sql immutable set search_path = public, extensions as $fn$
  select case
    when p_utm_source ~* '(chatgpt|openai|perplexity|gemini|copilot|claude|anthropic|grok|mistral|deepseek|meta\.ai)' then 'ai'
    else public.seo_referrer_class(p_host)
  end
$fn$;
revoke all on function public.seo_source_class(text, text) from public, anon, authenticated;
comment on function public.seo_source_class(text, text) is
  'seo_referrer_class with the utm arm: an assistant that strips its referrer '
  'but tags the URL still counts as ai. Internal helper for the admin readers.';

-----------------------------------------------------------------------
-- 3. derive_acquisition_channel v4 — supersedes 0225. Byte-identical except
--    the AI arms, which run FIRST in the utm step (the meta_organic arm's bare
--    'meta' would otherwise swallow meta.ai) and ahead of google/bing/x in the
--    referrer step (gemini.google.com and copilot.microsoft.com would
--    otherwise brand as their parent search engine).
-----------------------------------------------------------------------
create or replace function public.derive_acquisition_channel(fs jsonb)
returns text language plpgsql immutable set search_path = public as $fn$
declare
  utm_s text := lower(coalesce(nullif(fs->>'utm_source',''), ''));
  ref   text := lower(coalesce(nullif(fs->>'referrer_host',''), nullif(fs->>'referrer',''), ''));
  lp    text := lower(coalesce(nullif(fs->>'landing_path',''), ''));
  paid  boolean := lower(coalesce(fs->>'utm_medium','')) ~ '(cpc|ppc|paid|paidsocial|paid_social|paid-social|^ad$|^ads$|display|sem)';
  hw    text;
begin
  if fs is null or fs = '{}'::jsonb then return 'direct'; end if;

  -- 1) Paid click-ids win, network-specific.
  if nullif(fs->>'gclid','') is not null or nullif(fs->>'wbraid','') is not null or nullif(fs->>'gbraid','') is not null then return 'google_ads'; end if;
  if nullif(fs->>'msclkid','')   is not null then return 'bing_ads';      end if;
  if nullif(fs->>'ttclid','')    is not null then return 'tiktok_ads';    end if;
  if nullif(fs->>'twclid','')    is not null then return 'x_ads';         end if;
  if nullif(fs->>'rdt_cid','')   is not null or nullif(fs->>'rdt_uuid','') is not null then return 'reddit_ads'; end if;
  if nullif(fs->>'li_fat_id','') is not null then return 'linkedin_ads';  end if;
  if nullif(fs->>'epik','')      is not null then return 'pinterest_ads'; end if;
  if nullif(fs->>'sccid','')     is not null then return 'snapchat_ads';  end if;
  if nullif(fs->>'fbclid','')    is not null then return 'meta_paid';     end if;

  -- 2) Paid via explicit utm tagging on a known network (no click-id).
  if paid then
    if utm_s ~ '(google|adwords)'                            then return 'google_ads';    end if;
    if utm_s ~ '(bing|microsoft|msn)'                        then return 'bing_ads';      end if;
    if utm_s ~ '(facebook|instagram|meta|^fb$|^ig$|fb_|ig_)' then return 'meta_paid';     end if;
    if utm_s ~ 'tiktok'                                      then return 'tiktok_ads';    end if;
    if utm_s ~ '(twitter|^x$)'                               then return 'x_ads';         end if;
    if utm_s ~ 'reddit'                                      then return 'reddit_ads';    end if;
    if utm_s ~ 'linkedin'                                    then return 'linkedin_ads';  end if;
    if utm_s ~ 'pinterest'                                   then return 'pinterest_ads'; end if;
    if utm_s ~ 'snap'                                        then return 'snapchat_ads';  end if;
  end if;

  -- 3) Internal channels. The connect screen leads: it is the most specific
  --    thing we can know about someone who arrived there — they did not come to
  --    look at the product, they came to attach it to an assistant they use.
  if lp like '/oauth/authorize%' then return 'mcp_connect'; end if;
  if nullif(fs->>'ref','')         is not null                           then return 'referral';     end if;
  if nullif(fs->>'share_token','') is not null or utm_s = 'share_link'   then return 'share_link';   end if;
  if nullif(fs->>'public_slug','') is not null or utm_s = 'public_board' then return 'public_board'; end if;

  -- 4) Organic / referral by explicit utm_source.
  if utm_s <> '' then
    -- 4a) AI assistants FIRST. ChatGPT strips its referrer on about half its
    --     clicks and appends utm_source=chatgpt.com; before this arm that fell
    --     to the verbatim fallback and never grouped with the referrer form.
    --     'meta.ai' must beat the meta_organic arm's bare 'meta' below.
    if utm_s ~ '(chatgpt|openai)'    then return 'chatgpt';    end if;
    if utm_s ~ 'perplexity'          then return 'perplexity'; end if;
    if utm_s ~ 'gemini'              then return 'gemini';     end if;
    if utm_s ~ '(claude|anthropic)'  then return 'claude';     end if;
    if utm_s ~ 'copilot'             then return 'copilot';    end if;
    if utm_s ~ '(grok|^x\.ai$)'      then return 'grok';       end if;
    if utm_s ~ '(mistral|deepseek|meta\.ai|duck\.ai|phind|you\.com|poe\.com|t3\.chat|kagi)' then return 'ai'; end if;
    if utm_s ~ '(facebook|instagram|meta|^fb$|^ig$)' then return 'meta_organic'; end if;
    if utm_s ~ 'tiktok'        then return 'tiktok';    end if;
    if utm_s ~ 'reddit'        then return 'reddit';    end if;
    if utm_s ~ '(twitter|^x$)' then return 'x';         end if;
    if utm_s ~ 'linkedin'      then return 'linkedin';  end if;
    if utm_s ~ 'pinterest'     then return 'pinterest'; end if;
    if utm_s ~ 'snap'          then return 'snapchat';  end if;
    if utm_s ~ 'youtube'       then return 'youtube';   end if;
    if utm_s ~ '(google|adwords)'     then return 'google'; end if;
    if utm_s ~ '(bing|microsoft|msn)' then return 'bing';   end if;
    return utm_s;
  end if;

  -- 5) Organic / referral by external referrer host.
  if ref <> '' then
    -- 5a) AI assistants ahead of the search engines that own their domains.
    if ref ~ '(chatgpt\.com|chat\.openai\.com|openai\.com)' then return 'chatgpt';    end if;
    if ref ~ 'perplexity'                                    then return 'perplexity'; end if;
    if ref ~ 'gemini\.google\.com'                           then return 'gemini';     end if;
    if ref ~ '(claude\.ai|claude\.com)'                      then return 'claude';     end if;
    if ref ~ 'copilot\.(microsoft\.com|cloud\.microsoft)'    then return 'copilot';    end if;
    if ref ~ '(grok\.com|(^|[.])x[.]ai($|[:/]))'             then return 'grok';       end if;
    if ref ~ '(mistral\.ai|deepseek\.com|meta\.ai|duck\.ai|kagi\.com/assistant|phind\.com|you\.com|poe\.com|t3\.chat|notebooklm\.google\.com|aistudio\.google\.com|m365\.cloud\.microsoft)' then return 'ai'; end if;
    if ref ~ '(facebook|instagram|fb[.]com|fb[.]me|l[.]facebook|lm[.]facebook)' then return 'meta_organic'; end if;
    if ref ~ 'tiktok'                                                then return 'tiktok';     end if;
    if ref ~ 'reddit'                                                then return 'reddit';     end if;
    if ref ~ '(twitter|(^|[.])t[.]co($|[:/])|(^|[.])x[.]com($|[:/]))' then return 'x';         end if;
    if ref ~ 'linkedin'                                             then return 'linkedin';   end if;
    if ref ~ 'pinterest'                                            then return 'pinterest';  end if;
    if ref ~ 'snapchat'                                             then return 'snapchat';   end if;
    if ref ~ 'youtube'                                              then return 'youtube';    end if;
    if ref ~ 'google[.]'                                            then return 'google';     end if;
    if ref ~ '(bing[.]|microsoft)'                                  then return 'bing';       end if;
    if ref ~ 'duckduckgo'                                           then return 'duckduckgo'; end if;
    if ref ~ 'yahoo'                                                then return 'yahoo';      end if;
    if ref ~ '(ecosia|baidu|yandex|brave|qwant|startpage)'          then return 'search';     end if;
    hw := split_part(regexp_replace(regexp_replace(ref, '^https?://', '', 'i'), '^www[.]', '', 'i'), '/', 1);
    hw := split_part(hw, ':', 1);
    if position('.' in hw) > 0 then
      hw := split_part(hw, '.', greatest(1, array_length(string_to_array(hw, '.'), 1) - 1));
    end if;
    return coalesce(nullif(hw, ''), 'referral');
  end if;

  return 'direct';
end;
$fn$;

-----------------------------------------------------------------------
-- 4. Readers re-pointed at seo_source_class(referrer_host, utm_source).
--    lp_view / seo_landing_view rows carry both props (first-touch is merged
--    into every event), as does profiles.first_source.
-----------------------------------------------------------------------
create or replace function public.admin_ai_referrals(p_days int default 90)
returns json language plpgsql security definer set search_path = public as $fn$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, coalesce(p_days, 90)));
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.signups desc, t.ref_host), '[]'::json)
    from (
      select
        -- A referrer-stripped arrival is labelled by the utm it carried, so a
        -- row never reads "(direct) · ai".
        coalesce(nullif(lower(pr.first_source->>'referrer_host'), ''),
                 'utm:' || lower(pr.first_source->>'utm_source'))   as ref_host,
        coalesce(pr.first_source->>'landing_path', '/')             as landing_path,
        count(*)                                                    as signups,
        count(*) filter (where exists (
          select 1 from analytics_events e
          where e.user_id = pr.user_id and e.event like 'card_placed%'
        ))                                                          as activated
      from profiles pr
      join auth.users au on au.id = pr.user_id
      where au.created_at >= v_since
        and seo_source_class(pr.first_source->>'referrer_host', pr.first_source->>'utm_source') = 'ai'
      group by 1, 2
    ) t
  );
end;
$fn$;

create or replace function public.admin_seo_referrers(p_days integer default 30)
returns json language plpgsql security definer set search_path = public as $fn$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, coalesce(p_days, 30)));
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.views desc), '[]'::json)
    from (
      select coalesce(nullif(props->>'referrer_host', ''),
                      case when props->>'utm_source' is not null then 'utm:' || lower(props->>'utm_source') end,
                      '(direct)')                                              as host,
             seo_source_class(props->>'referrer_host', props->>'utm_source')  as class,
             count(*)                                                          as views
      from analytics_events
      where event = 'seo_landing_view' and occurred_at >= v_since
      group by 1, 2
      order by views desc
      limit 20
    ) t
  );
end;
$fn$;

create or replace function public.admin_seo_page_stats(p_days integer default 30)
returns json language plpgsql security definer set search_path = public as $fn$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, coalesce(p_days, 30)));
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    with ev as (
      select props->>'path' as path,
             session_id,
             seo_source_class(props->>'referrer_host', props->>'utm_source') as cls
      from analytics_events
      where event = 'seo_landing_view' and occurred_at >= v_since
    ),
    by_class as (
      select path, cls, count(*) as n from ev group by path, cls
    ),
    classes as (
      select path, jsonb_object_agg(cls, n) as referrers from by_class group by path
    ),
    pages as (
      select path, count(*) as views, count(distinct session_id) as sessions
      from ev group by path
    )
    select coalesce(json_agg(json_build_object(
             'path',      p.path,
             'views',     p.views,
             'sessions',  p.sessions,
             'signups',   (select count(*) from profiles pr
                            join auth.users au on au.id = pr.user_id
                            where pr.first_source->>'landing_path' = p.path
                              and au.created_at >= v_since),
             'referrers', c.referrers
           ) order by p.views desc), '[]'::json)
    from pages p
    left join classes c on c.path = p.path
  );
end;
$fn$;

create or replace function public.admin_landing_scorecard(p_days integer default 30, p_exclude_internal boolean default true)
returns json language plpgsql stable security definer set search_path = public as $fn$
declare
  v_days  int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  perform public._require_admin();
  return (
    with ev as (
      select coalesce(e.props->>'page', e.props->>'path') as page,
             e.session_id, e.event, e.props, e.occurred_at
      from analytics_events e
      where e.occurred_at >= v_since
        and e.event in ('lp_view', 'lp_dwell', 'lp_cta_click', 'seo_landing_view')
        and coalesce(e.props->>'page', e.props->>'path') is not null
        and (not p_exclude_internal
             or e.session_id is null
             or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
    ),
    -- A view = lp_view, plus legacy seo_landing_view rows whose session never
    -- emitted lp_view for that page (pre-lp_* clients).
    view_ev as (
      select page, session_id, occurred_at,
             max(props->>'page_kind') over (partition by page) as page_kind
      from ev where event = 'lp_view'
      union all
      select s.page, s.session_id, s.occurred_at, null
      from ev s
      where s.event = 'seo_landing_view'
        and not exists (
          select 1 from ev v
          where v.event = 'lp_view' and v.page = s.page
            and v.session_id is not distinct from s.session_id
        )
    ),
    views as (
      select page,
             count(*)                    as views,
             count(distinct session_id)  as sessions,
             max(page_kind)              as page_kind
      from view_ev group by page
    ),
    dwell as (
      select page,
             count(*) as dwell_n,
             percentile_cont(0.5) within group (order by (props->>'ms')::numeric) as med_dwell_ms,
             percentile_cont(0.5) within group (order by
               case when (props->>'max_depth') ~ '^[0-9]+(\.[0-9]+)?$'
                    then (props->>'max_depth')::numeric end)                      as med_scroll
      from ev
      where event = 'lp_dwell'
        and (props->>'ms') ~ '^[0-9]+(\.[0-9]+)?$'          -- props are anon-writable; never cast junk
      group by page
    ),
    ctas as (
      select page,
             count(*)                   as cta_clicks,
             count(distinct session_id) as cta_sessions
      from ev
      where event = 'lp_cta_click' and coalesce(props->>'intent', 'signup') = 'signup'
      group by page
    ),
    refs as (
      select page, jsonb_object_agg(cls, n) as referrers
      from (
        -- utm-tagged, referrer-stripped assistant arrivals count as ai (0335).
        select page, seo_source_class(props->>'referrer_host', props->>'utm_source') as cls, count(*) as n
        from ev where event in ('lp_view', 'seo_landing_view')
        group by 1, 2
      ) t group by page
    ),
    signups as (
      select pr.first_source->>'landing_path' as page, count(*) as n
      from profiles pr
      join auth.users au on au.id = pr.user_id
      where au.created_at >= v_since
        and au.email_confirmed_at is not null
        and (not p_exclude_internal
             or pr.user_id not in (select iu.user_id from public._internal_user_ids() iu))
      group by 1
    ),
    perday as (
      select page, occurred_at::date as d, count(*) as n
      from view_ev group by 1, 2
    )
    select coalesce(json_agg(json_build_object(
             'page',         v.page,
             'page_kind',    v.page_kind,
             'views',        v.views,
             'sessions',     v.sessions,
             'dwell_n',      coalesce(d.dwell_n, 0),
             'med_dwell_ms', round(d.med_dwell_ms),
             'med_scroll',   round(d.med_scroll::numeric, 2),
             'cta_clicks',   coalesce(c.cta_clicks, 0),
             'cta_sessions', coalesce(c.cta_sessions, 0),
             'signups',      coalesce(s.n, 0),
             'referrers',    coalesce(r.referrers, '{}'::jsonb),
             'spark',        (select json_agg(coalesce(pd.n, 0) order by gs.d)
                              from generate_series(v_since::date, current_date, interval '1 day') gs(d)
                              left join perday pd on pd.page = v.page and pd.d = gs.d::date)
           ) order by v.sessions desc, v.views desc), '[]'::json)
    from views v
    left join dwell d   on d.page = v.page
    left join ctas c    on c.page = v.page
    left join refs r    on r.page = v.page
    left join signups s on s.page = v.page
  );
end;
$fn$;

-----------------------------------------------------------------------
-- 5. record_aeo_retrieval — a run that mostly errored raises an alert, the
--    same four-column client_errors row record_seo_health writes (0180).
--    `asked > 0` guards an empty sweep (0/0 would otherwise alert with a
--    NULL message). Half-or-more, not any: one Worker timeout in eight is
--    weekly noise; a quota or model failure takes the whole sweep.
-----------------------------------------------------------------------
create or replace function public.record_aeo_retrieval(p_provider text, p_model text, p_results jsonb)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_run    uuid;
  v_asked  int;
  v_failed int;
  v_err    text;
begin
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'provider required';
  end if;

  insert into public.aeo_retrieval_runs (provider, model)
  values (left(btrim(p_provider), 40), left(coalesce(p_model, ''), 80))
  returning id into v_run;

  insert into public.aeo_retrieval_results
    (run_id, question_id, question, cited, position, sources, excerpt, error, ms)
  select v_run,
         (r->>'question_id')::bigint,
         left(r->>'question', 300),
         coalesce((r->>'cited')::boolean, false),
         nullif(r->>'position', '')::int,
         coalesce(r->'sources', '[]'::jsonb),
         left(r->>'excerpt', 2000),
         left(r->>'error', 500),
         nullif(r->>'ms', '')::int
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
   where coalesce(r->>'question', '') <> '';

  update public.aeo_retrieval_runs r
     set asked  = s.n, cited = s.c, failed = s.f
    from (select count(*) n,
                 count(*) filter (where cited) c,
                 count(*) filter (where error is not null) f
            from public.aeo_retrieval_results where run_id = v_run) s
   where r.id = v_run
   returning r.asked, r.failed into v_asked, v_failed;

  if coalesce(v_asked, 0) > 0 and coalesce(v_failed, 0) * 2 >= v_asked then
    select left(error, 300) into v_err
      from public.aeo_retrieval_results
     where run_id = v_run and error is not null
     order by id limit 1;
    insert into public.client_errors (kind, name, message, path)
    values ('aeo_probe', 'AEO retrieval probe failed',
            left(v_failed || ' of ' || v_asked || ' questions errored (' || coalesce(p_model, '') || '): ' || coalesce(v_err, ''), 500),
            '/aeo-probe');
  end if;

  return v_run;
end $fn$;

-----------------------------------------------------------------------
-- 6. Pipeline freshness. One SQL function, no secrets, on pg_cron daily at
--    07:20 UTC — after gsc-sync (05:45) and the weekly probe (06:00). Each
--    failing check writes one client_errors row per day (deduped on kind+name
--    over 20h) so the admin Errors tab — the only alert surface — shows it.
-----------------------------------------------------------------------
create or replace function public._discovery_alert(p_name text, p_message text)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.client_errors
              where kind = 'discovery_pipeline' and name = p_name
                and occurred_at > now() - interval '20 hours') then
    return false;
  end if;
  insert into public.client_errors (kind, name, message, path)
  values ('discovery_pipeline', left(p_name, 120), left(p_message, 500), '/discovery-pipelines');
  return true;
end $fn$;
revoke all on function public._discovery_alert(text, text) from public, anon, authenticated;

create or replace function public.check_discovery_pipelines()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_n      int := 0;
  v_gsc    date;
  v_crawl  date;
  v_health timestamptz;
  v_aeo    record;
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

  return v_n;
end $fn$;
revoke all on function public.check_discovery_pipelines() from public, anon, authenticated;
comment on function public.check_discovery_pipelines() is
  'Daily freshness check over the discovery pipelines (gsc-sync, AEO probe, '
  'crawler_hits, seo-health). Writes client_errors kind=discovery_pipeline. '
  'Returns the number of NEW alerts raised.';

select cron.schedule('discovery_pipelines_daily', '20 7 * * *', $$ select public.check_discovery_pipelines(); $$)
  where not exists (select 1 from cron.job where jobname = 'discovery_pipelines_daily');

-----------------------------------------------------------------------
-- 7. Proofs. A REVOKE reporting success proves nothing (0311 habit); assert
--    the grants, then assert the behaviour this migration exists for.
-----------------------------------------------------------------------
do $do$
declare
  f text;
begin
  foreach f in array array['public.seo_source_class(text, text)',
                           'public._discovery_alert(text, text)',
                           'public.check_discovery_pipelines()'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '% is executable by anon', f;
    end if;
    if has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is executable by authenticated', f;
    end if;
  end loop;
  -- The admin RPCs are client-called: CREATE OR REPLACE must have kept their ACL.
  foreach f in array array['public.admin_ai_referrals(integer)',
                           'public.admin_seo_referrers(integer)',
                           'public.admin_seo_page_stats(integer)',
                           'public.admin_landing_scorecard(integer, boolean)'] loop
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '% lost EXECUTE for authenticated', f;
    end if;
  end loop;

  -- Channel normalizer: the utm form and the referrer form of one assistant
  -- brand identically, and the AI arm beats the arms that used to swallow it.
  assert public.derive_acquisition_channel('{"utm_source":"chatgpt.com"}'::jsonb)          = 'chatgpt',      'utm chatgpt.com';
  assert public.derive_acquisition_channel('{"referrer_host":"chatgpt.com"}'::jsonb)       = 'chatgpt',      'ref chatgpt.com';
  assert public.derive_acquisition_channel('{"utm_source":"openai"}'::jsonb)               = 'chatgpt',      'utm openai';
  assert public.derive_acquisition_channel('{"utm_source":"meta.ai"}'::jsonb)              = 'ai',           'utm meta.ai beats meta_organic';
  assert public.derive_acquisition_channel('{"utm_source":"meta"}'::jsonb)                 = 'meta_organic', 'utm meta still meta_organic';
  assert public.derive_acquisition_channel('{"referrer_host":"gemini.google.com"}'::jsonb) = 'gemini',       'ref gemini beats google';
  assert public.derive_acquisition_channel('{"referrer_host":"www.google.com"}'::jsonb)    = 'google',       'ref google';
  assert public.derive_acquisition_channel('{"referrer_host":"copilot.microsoft.com"}'::jsonb) = 'copilot',  'ref copilot beats bing';
  assert public.derive_acquisition_channel('{"referrer_host":"www.bing.com"}'::jsonb)      = 'bing',         'ref bing';
  assert public.derive_acquisition_channel('{"referrer_host":"www.perplexity.ai"}'::jsonb) = 'perplexity',   'ref perplexity';
  assert public.derive_acquisition_channel('{"utm_source":"seo"}'::jsonb)                  = 'seo',          'internal utm stays verbatim';
  assert public.derive_acquisition_channel('{"referrer_host":"www.reddit.com"}'::jsonb)    = 'reddit',       'ref reddit';
  assert public.derive_acquisition_channel('{}'::jsonb)                                    = 'direct',       'empty bag';
  assert public.derive_acquisition_channel('{"landing_path":"/oauth/authorize","utm_source":"chatgpt.com"}'::jsonb) = 'mcp_connect', 'connect screen still leads';

  -- Referrer classifier.
  assert public.seo_referrer_class('chatgpt.com')                = 'ai',       'chatgpt.com';
  assert public.seo_referrer_class('duck.ai')                    = 'ai',       'duck.ai';
  assert public.seo_referrer_class('www.perplexity.ai')          = 'ai',       'www.perplexity.ai';
  assert public.seo_referrer_class('gemini.google.com')          = 'ai',       'gemini';
  assert public.seo_referrer_class('www.google.com')             = 'search',   'google';
  assert public.seo_referrer_class('www.google.com.hk')          = 'search',   'google.com.hk';
  assert public.seo_referrer_class('search.yahoo.com')           = 'search',   'yahoo';
  assert public.seo_referrer_class('r.search.yahoo.com')         = 'search',   'r.search.yahoo';
  assert public.seo_referrer_class('kagi.com')                   = 'search',   'kagi';
  assert public.seo_referrer_class('classroom.google.com')       = 'referral', 'classroom';
  assert public.seo_referrer_class('com.google.android.gm')      = 'referral', 'gmail app';
  assert public.seo_referrer_class('com.google.android.googlequicksearchbox') = 'search', 'google app';
  assert public.seo_referrer_class('com.reddit.frontpage')       = 'referral', 'reddit app package';
  assert public.seo_referrer_class('www.reddit.com')             = 'social',   'reddit';
  assert public.seo_referrer_class('l.instagram.com')            = 'social',   'instagram';
  assert public.seo_referrer_class('phoenix.airlines.example')   = 'referral', 'unanchored x.ai must not match';
  assert public.seo_referrer_class('')                           = 'direct',   'empty';
  assert public.seo_source_class(null, 'chatgpt.com')            = 'ai',       'utm-only chatgpt';
  assert public.seo_source_class('www.google.com', null)         = 'search',   'source falls through';
  assert public.seo_source_class('www.google.com', 'seo')        = 'search',   'internal utm does not make ai';
end $do$;
