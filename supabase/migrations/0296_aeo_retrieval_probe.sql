-- 0296_aeo_retrieval_probe.sql — measure whether assistants actually cite us.
--
-- WHAT THIS FIXES. The seo-health prober (0180, 0257, 0270) fetches pages with
-- a spoofed GPTBot/ClaudeBot/PerplexityBot user-agent and asserts a substring
-- appears in the HTML. That is a PLUMBING test: it proves our own server hands
-- a crawler real content. It cannot fail in the way that actually costs us,
-- which is being perfectly crawlable and still never mentioned. And 0295's
-- crawler_hits closes the next gap — whether a crawler came — but a crawl is
-- not a citation either.
--
-- The only retrieval evidence this project has ever had is a hand-run spot
-- check from 2026-08-25, recorded in a memory file and in nobody's database: we
-- were present for "best PureRef alternative", absent for "best mood board app
-- for film production teams" and "best storyboard software for filmmakers".
-- Absent from the one channel that converts best. That check has never been
-- repeated, so there is no trend, no alert, and no way to tell whether any of
-- the AEO work since then moved it.
--
-- This is that check, on a schedule, with history.
--
-- DELIBERATELY PROVIDER-AGNOSTIC. Which assistant we ask, and through which
-- API, is a live question — an API's web-search tool is a proxy for the
-- consumer product, not the product itself, and that caveat belongs in the
-- reading of the data rather than baked into its shape. So provider and model
-- are recorded per run, and a run is meaningful only against other runs of the
-- SAME provider. Never pool them.
--
-- WHAT "CITED" MEANS. Our domain appears in the answer text or in the returned
-- source list. Position is the 1-based rank among sources when the provider
-- gives an ordered list, else null. A brand-name mention without a link does
-- NOT count as cited — it is recorded in the excerpt, and that is the honest
-- place for it, because a mention that sends nobody is not retrieval.

-----------------------------------------------------------------------
-- 1. The question set. Rows, not code, so it can be tuned without a deploy.
-----------------------------------------------------------------------
create table if not exists public.aeo_probe_questions (
  id         bigint generated always as identity primary key,
  question   text not null unique,
  intent     text not null default 'discovery',  -- 'brand' | 'discovery' | 'comparison'
  note       text,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.aeo_probe_questions enable row level security;
revoke all on public.aeo_probe_questions from anon, authenticated;

comment on table public.aeo_probe_questions is
  'The fixed question set for the AEO retrieval probe (0296). Rows so the set '
  'is tunable without a deploy. Changing a question resets its own history — '
  'the string IS the identity.';

-- Seeded with the questions a buyer actually asks, and deliberately including
-- the two the 2026-08-25 spot check found us ABSENT for. A probe that can only
-- confirm good news is not a probe; these are the rows that can falsify the
-- content thesis.
insert into public.aeo_probe_questions (question, intent, note) values
  ('Soleil Clusters',
   'brand',
   'Control. If this ever goes uncited the problem is indexing, not content.'),
  ('best PureRef alternative 2026',
   'discovery',
   'Present at #5 of 5 on 2026-08-25. Our strongest cluster — the regression canary.'),
  ('best mood board app for film production teams',
   'discovery',
   'ABSENT 2026-08-25. The core positioning query.'),
  ('best storyboard software for filmmakers 2026',
   'discovery',
   'ABSENT 2026-08-25. /best/storyboard-software exists to win this.'),
  ('free alternative to Milanote for mood boards',
   'comparison',
   'Milanote is the second of the only two competitor names with real volume.'),
  ('web based mood board tool that runs in the browser',
   'discovery',
   'The "online" intent that /vs/pureref was retitled to face.'),
  ('mood board app with real time collaboration',
   'discovery',
   'Feature-led rather than competitor-led — tests whether we are retrievable '
   'without a rival brand in the prompt.'),
  ('shot list and storyboard app for a small film crew',
   'discovery',
   'Covers /tools/shot-list-maker and /tools/storyboard-maker, the family AI '
   'already sends more traffic than Google does.')
on conflict (question) do nothing;

-----------------------------------------------------------------------
-- 2. Runs and results. Same runs/checks shape as seo_health, so the admin
--    surface that renders one can render the other.
-----------------------------------------------------------------------
create table if not exists public.aeo_retrieval_runs (
  id          uuid primary key default gen_random_uuid(),
  run_at      timestamptz not null default now(),
  source      text not null default 'worker:aeo-retrieval',
  provider    text not null,             -- 'openai' | 'perplexity' | ...
  model       text,
  asked       integer not null default 0,
  cited       integer not null default 0,
  failed      integer not null default 0
);

create index if not exists aeo_retrieval_runs_at_idx on public.aeo_retrieval_runs (run_at desc);

create table if not exists public.aeo_retrieval_results (
  id          bigint generated always as identity primary key,
  run_id      uuid not null references public.aeo_retrieval_runs(id) on delete cascade,
  question_id bigint references public.aeo_probe_questions(id) on delete set null,
  question    text not null,             -- denormalized: the asked string, frozen
  cited       boolean not null default false,
  position    integer,                   -- 1-based rank among sources, null if unranked
  sources     jsonb not null default '[]'::jsonb,
  excerpt     text,
  error       text,
  ms          integer
);

create index if not exists aeo_retrieval_results_run_idx on public.aeo_retrieval_results (run_id);

alter table public.aeo_retrieval_runs    enable row level security;
alter table public.aeo_retrieval_results enable row level security;
revoke all on public.aeo_retrieval_runs    from anon, authenticated;
revoke all on public.aeo_retrieval_results from anon, authenticated;

comment on table public.aeo_retrieval_runs is
  'One row per AEO retrieval probe sweep (0296). Compare runs only within the '
  'same provider — different assistants use different retrieval stacks.';

-----------------------------------------------------------------------
-- 3. Writer. Service-role only, called by the Worker cron.
--
-- Takes the whole sweep in one call so a run and its results land atomically:
-- a half-written run would read as a citation collapse.
-----------------------------------------------------------------------
create or replace function public.record_aeo_retrieval(
  p_provider text,
  p_model    text,
  p_results  jsonb
) returns uuid
language plpgsql
security definer
set search_path = public as $$
declare
  v_run uuid;
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
   where r.id = v_run;

  return v_run;
end $$;

revoke all on function public.record_aeo_retrieval(text, text, jsonb) from public, anon, authenticated;

comment on function public.record_aeo_retrieval(text, text, jsonb) is
  'Records one AEO retrieval sweep atomically. Service-role only — called by '
  'the Cloudflare Worker cron.';

-----------------------------------------------------------------------
-- 4. Reader.
-----------------------------------------------------------------------
create or replace function public.admin_aeo_retrieval(p_days integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  v_from timestamptz := now() - (greatest(coalesce(p_days, 60), 1) || ' days')::interval;
  v_out  jsonb;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'from', v_from,
    'latest', coalesce((
      select jsonb_agg(x order by x->>'question')
        from (
          select jsonb_build_object(
                   'question', res.question, 'cited', res.cited,
                   'position', res.position, 'sources', res.sources,
                   'excerpt', res.excerpt, 'error', res.error,
                   'provider', run.provider, 'run_at', run.run_at
                 ) x
            from public.aeo_retrieval_runs run
            join public.aeo_retrieval_results res on res.run_id = run.id
           where run.id = (select id from public.aeo_retrieval_runs
                            order by run_at desc limit 1)
        ) s), '[]'::jsonb),
    -- Citation rate per question over the window. This is the series that says
    -- whether any of the AEO work moved anything.
    'by_question', coalesce((
      select jsonb_agg(x order by x->>'cite_rate')
        from (
          select jsonb_build_object(
                   'question', res.question,
                   'provider', run.provider,
                   'asked', count(*)::int,
                   'cited', count(*) filter (where res.cited)::int,
                   'cite_rate', round(100.0 * count(*) filter (where res.cited)
                                      / nullif(count(*), 0), 1)
                 ) x
            from public.aeo_retrieval_runs run
            join public.aeo_retrieval_results res on res.run_id = run.id
           where run.run_at >= v_from
           group by res.question, run.provider
        ) s), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'run_at', run_at, 'provider', provider, 'model', model,
               'asked', asked, 'cited', cited, 'failed', failed) order by run_at desc)
        from public.aeo_retrieval_runs where run_at >= v_from), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

revoke all on function public.admin_aeo_retrieval(integer) from public, anon;
grant execute on function public.admin_aeo_retrieval(integer) to authenticated;

comment on function public.admin_aeo_retrieval(integer) is
  'Admin readout over the AEO retrieval probe: the latest sweep, per-question '
  'citation rate over the window, and the run history.';
