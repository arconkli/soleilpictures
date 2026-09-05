-- 0295_crawler_hits.sql — see whether the AI crawlers actually fetch us.
--
-- THE BLIND SPOT. Until now the only AI signal anywhere in this system was
-- props->>'referrer_host' on a landing event — a HUMAN arriving from an
-- assistant. That misses the entire upstream half twice over: assistants that
-- strip their referrer are invisible, and a crawler that fetches a page but
-- never sends anyone is invisible by construction. Meanwhile the seo-health
-- prober (0257, 0270) fetches pages WITH a crawler user-agent to prove a bot
-- COULD read them. Nothing recorded whether one ever DID.
--
-- So the two questions that decide the AEO strategy — is GPTBot crawling us,
-- and which pages does it pull — had no instrument at all. This is that
-- instrument: the Worker recognizes the crawler user-agents it serves and rolls
-- each fetch up here.
--
-- WHY POSTGRES AND NOT CLOUDFLARE ANALYTICS ENGINE. Analytics Engine is the
-- obvious home for high-cardinality request telemetry and was the first plan.
-- It is the wrong one here: its data is only reachable over a separate GraphQL
-- API, and the entire value of this table is joining it to seo_page_daily —
-- "Google gives this page 20 impressions a week, how often does GPTBot pull
-- it?" A number that cannot be joined to the Search Console series cannot
-- answer the question that motivated collecting it.
--
-- WHY A DAILY ROLLUP AND NOT A ROW PER FETCH. Crawlers burst. The grain we
-- actually read at is (day, bot, path), so that is the grain stored — one
-- upsert per fetch against a three-column primary key, instead of an unbounded
-- log nobody would ever read row-wise. Retention stays trivial as a result.

create table if not exists public.crawler_hits (
  day        date        not null,
  bot        text        not null,   -- canonical name, e.g. 'GPTBot' (Worker normalizes)
  kind       text        not null,   -- 'ai' | 'search' | 'other'
  path       text        not null,
  hits       integer     not null default 0,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (day, bot, path)
);

create index if not exists crawler_hits_day_idx  on public.crawler_hits (day desc);
create index if not exists crawler_hits_kind_idx on public.crawler_hits (kind, day desc);
create index if not exists crawler_hits_path_idx on public.crawler_hits (path, day desc);

-- Not a public surface. PostgREST exposes every table in `public`, so lock it
-- down explicitly: RLS on with NO policies denies all ordinary access even if a
-- grant is added later by mistake. Reads go through the admin RPC below.
alter table public.crawler_hits enable row level security;
revoke all on public.crawler_hits from anon, authenticated;

comment on table public.crawler_hits is
  'Daily rollup of AI/search crawler fetches, written by the Worker via '
  'record_crawler_hit (migration 0295). Grain is (day, bot, path). The '
  'companion to seo_page_daily: that table says what Google showed humans, '
  'this one says what the crawlers took.';

-----------------------------------------------------------------------
-- Writer. Called by the Worker with the service-role key, inside
-- ctx.waitUntil — recording a crawl must never be what makes a page slow, and
-- never what fails one.
--
-- Guarded rather than trusting: `bot` and `path` arrive from a request header
-- and a URL, so both are length-capped here as well as at the call site, and an
-- unrecognized kind falls back to 'other' rather than violating the check.
-----------------------------------------------------------------------
create or replace function public.record_crawler_hit(
  p_bot  text,
  p_kind text,
  p_path text
) returns void
language plpgsql
security definer
set search_path = public as $$
declare
  v_bot  text := nullif(left(btrim(p_bot),  40), '');
  v_path text := nullif(left(btrim(p_path), 300), '');
  v_kind text := case when p_kind in ('ai','search','other') then p_kind else 'other' end;
begin
  if v_bot is null or v_path is null then
    return;
  end if;
  insert into public.crawler_hits as c (day, bot, kind, path, hits)
  values (current_date, v_bot, v_kind, v_path, 1)
  on conflict (day, bot, path) do update
    set hits      = c.hits + 1,
        last_seen = now();
end $$;

revoke all on function public.record_crawler_hit(text, text, text) from public, anon, authenticated;

comment on function public.record_crawler_hit(text, text, text) is
  'Increments the (day, bot, path) rollup in crawler_hits. Service-role only — '
  'called by the Cloudflare Worker on every recognized crawler fetch.';

-----------------------------------------------------------------------
-- Reader. Admin-gated like every other admin_* RPC.
-----------------------------------------------------------------------
create or replace function public.admin_crawler_hits(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  v_from date := current_date - greatest(coalesce(p_days, 30), 1);
  v_out  jsonb;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'from', v_from,
    'by_bot', coalesce((
      select jsonb_agg(x order by x->>'hits' desc)
        from (
          select jsonb_build_object(
                   'bot', bot, 'kind', kind,
                   'hits', sum(hits)::int,
                   'paths', count(distinct path)::int,
                   'last_seen', max(last_seen)
                 ) x
            from public.crawler_hits where day >= v_from
           group by bot, kind
        ) s), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(x order by x->>'day')
        from (
          select jsonb_build_object(
                   'day', day,
                   'ai', sum(hits) filter (where kind = 'ai')::int,
                   'search', sum(hits) filter (where kind = 'search')::int,
                   'other', sum(hits) filter (where kind = 'other')::int
                 ) x
            from public.crawler_hits where day >= v_from
           group by day
        ) s), '[]'::jsonb),
    'top_ai_paths', coalesce((
      select jsonb_agg(x order by x->>'hits' desc)
        from (
          select jsonb_build_object(
                   'path', path,
                   'hits', sum(hits)::int,
                   'bots', count(distinct bot)::int
                 ) x
            from public.crawler_hits
           where day >= v_from and kind = 'ai'
           group by path
           order by sum(hits) desc
           limit 50
        ) s), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

revoke all on function public.admin_crawler_hits(integer) from public, anon;
grant execute on function public.admin_crawler_hits(integer) to authenticated;

comment on function public.admin_crawler_hits(integer) is
  'Admin readout over crawler_hits: per-bot totals, a daily ai/search/other '
  'series, and the AI crawlers'' most-fetched paths.';
