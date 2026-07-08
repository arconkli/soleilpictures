-- 0180: SEO measurement (admin landing-page stats + referrer classes) and the
-- SEO health / deploy-drift detector.
--
-- Measurement: seo_landing_view events already carry props.path plus merged
-- first-touch fields (referrer_host, landing_path); signups are attributable
-- via profiles.first_source->>'landing_path' (set_first_source + 0157 backstop).
--
-- Health: expectations live in a TABLE (editable without a deploy — a stuck
-- deploy can't self-certify) and are probed from OUTSIDE the worker (Supabase
-- edge function `seo-health` on pg_cron; a Worker often can't fetch its own
-- custom domain). Failures also write one client_errors row (kind
-- 'seo_health') so the existing admin Errors tab is the alert channel.

-- ── Referrer classification (shared by the stats RPCs) ──────────────────────
create or replace function public.seo_referrer_class(p_host text)
returns text
language sql
immutable
as $$
  select case
    when p_host is null or p_host = '' then 'direct'
    when p_host ~* '(chatgpt\.com|chat\.openai\.com|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|claude\.ai|you\.com|phind\.com)' then 'ai'
    when p_host ~* '(^|\.)((google|bing|duckduckgo|ecosia|qwant|startpage|yandex)\.[a-z.]+|search\.brave\.com)$' then 'search'
    when p_host ~* '(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|reddit\.com|pinterest\.|tiktok\.com|youtube\.com|news\.ycombinator\.com)' then 'social'
    else 'referral'
  end
$$;

-- ── Landing-page stats: views / sessions / signups / referrer classes ───────
create or replace function public.admin_seo_page_stats(p_days integer default 30)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
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
             seo_referrer_class(props->>'referrer_host') as cls
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
$$;

-- ── Top external referrers across landing views ("is AI sending people?") ───
create or replace function public.admin_seo_referrers(p_days integer default 30)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, coalesce(p_days, 30)));
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.views desc), '[]'::json)
    from (
      select coalesce(nullif(props->>'referrer_host', ''), '(direct)') as host,
             seo_referrer_class(props->>'referrer_host')               as class,
             count(*)                                                  as views
      from analytics_events
      where event = 'seo_landing_view' and occurred_at >= v_since
      group by 1, 2
      order by views desc
      limit 20
    ) t
  );
end;
$$;

-- ── SEO health: expectations + runs + checks ─────────────────────────────────
create table if not exists seo_health_expectations (
  id         bigint generated always as identity primary key,
  url        text not null,
  check_name text not null,
  kind       text not null check (kind in ('title','canonical','body','status','build_min')),
  expected   text not null,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists seo_health_runs (
  id         uuid primary key default gen_random_uuid(),
  run_at     timestamptz not null default now(),
  source     text,
  ok_count   int not null default 0,
  fail_count int not null default 0
);

create table if not exists seo_health_checks (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references seo_health_runs(id) on delete cascade,
  url        text not null,
  check_name text not null,
  ok         boolean not null,
  expected   text,
  actual     text,
  ms         int
);
create index if not exists seo_health_checks_run_idx on seo_health_checks (run_id);

alter table seo_health_expectations enable row level security;
alter table seo_health_runs         enable row level security;
alter table seo_health_checks       enable row level security;
-- Admin read; writes only via the SECURITY DEFINER recorder (edge fn / service).
drop policy if exists "seo health admin read" on seo_health_expectations;
create policy "seo health admin read" on seo_health_expectations for select to authenticated using (is_admin());
drop policy if exists "seo health runs admin read" on seo_health_runs;
create policy "seo health runs admin read" on seo_health_runs for select to authenticated using (is_admin());
drop policy if exists "seo health checks admin read" on seo_health_checks;
create policy "seo health checks admin read" on seo_health_checks for select to authenticated using (is_admin());

-- Seed expectations. build_min's `expected` is the minimum acceptable
-- BUILD_DATE from /api/build-info — bump it when shipping SEO changes so a
-- stuck deploy turns the strip red. The 404 row is a regression guard for the
-- soft-404 fix.
insert into seo_health_expectations (url, check_name, kind, expected) values
  ('https://clusters.soleilpictures.com/',                        'home title',            'title',     'Soleil Clusters'),
  ('https://clusters.soleilpictures.com/tools/mood-board-maker',  'landing title',         'title',     'Mood Board Maker'),
  ('https://clusters.soleilpictures.com/tools/mood-board-maker',  'landing canonical',     'canonical', 'https://clusters.soleilpictures.com/tools/mood-board-maker'),
  ('https://clusters.soleilpictures.com/vs/milanote',             'compare title',         'title',     'Milanote Alternative'),
  ('https://clusters.soleilpictures.com/use-cases',               'hub title',             'title',     'What You Can Make'),
  ('https://clusters.soleilpictures.com/explore',                 'explore title',         'title',     'Explore Boards'),
  ('https://clusters.soleilpictures.com/sitemap.xml',             'sitemap has landings',  'body',      '/tools/mood-board-maker'),
  ('https://clusters.soleilpictures.com/tools/zzz-not-a-real-page','unknown landing 404',  'status',    '404'),
  ('https://clusters.soleilpictures.com/api/build-info',          'deploy not stuck',      'build_min', '2026-07-07');

-- Recorder: called by the seo-health edge function (service role). Inserts the
-- run + its checks atomically and mirrors failures into client_errors so the
-- admin Errors tab doubles as the alert channel.
create or replace function public.record_seo_health(p_source text, p_results jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_run uuid;
  v_ok int;
  v_fail int;
  v_failed text;
begin
  select count(*) filter (where (r->>'ok')::boolean),
         count(*) filter (where not (r->>'ok')::boolean)
    into v_ok, v_fail
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r;

  insert into seo_health_runs (source, ok_count, fail_count)
  values (coalesce(p_source, 'edge'), coalesce(v_ok, 0), coalesce(v_fail, 0))
  returning id into v_run;

  insert into seo_health_checks (run_id, url, check_name, ok, expected, actual, ms)
  select v_run,
         r->>'url', r->>'check_name', (r->>'ok')::boolean,
         r->>'expected', left(r->>'actual', 500), nullif(r->>'ms', '')::int
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r;

  if coalesce(v_fail, 0) > 0 then
    select string_agg(r->>'check_name', ', ')
      into v_failed
    from jsonb_array_elements(p_results) r
    where not (r->>'ok')::boolean;
    insert into client_errors (kind, name, message, path)
    values ('seo_health', 'SEO health check failed',
            left(v_fail || ' check(s) failing: ' || coalesce(v_failed, ''), 500),
            '/seo-health');
  end if;

  return v_run;
end;
$$;
revoke all on function public.record_seo_health(text, jsonb) from public, anon, authenticated;

-- Latest run + its checks, for the admin strip.
create or replace function public.admin_seo_health_latest()
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select json_build_object(
      'run',    to_jsonb(r),
      'checks', (select coalesce(json_agg(to_jsonb(c) order by c.ok, c.check_name), '[]'::json)
                 from seo_health_checks c where c.run_id = r.id)
    )
    from seo_health_runs r
    order by r.run_at desc
    limit 1
  );
end;
$$;
