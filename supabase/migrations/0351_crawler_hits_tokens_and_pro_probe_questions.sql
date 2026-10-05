-- 0351 — crawler_hits stops storing capability tokens; the AEO probe learns the
-- money and professional questions.
--
-- SAFE TO APPLY NOW (unlike 0350). Nothing here asserts on a page; it fixes a
-- privacy leak live on production and adds questions the weekly probe will ask
-- the next time it has OpenAI quota.
--
-- 1. THE LEAK. record_crawler_hit stored whatever path the Worker sent, and a
--    /share/<uuid> or /t/<uuid> URL is a capability — anyone holding it opens
--    the board. Assistants fetch those links (a ChatGPT-User row carried one),
--    so 23 rows of crawler_hits held share tokens on 2026-10-01. The Worker
--    now collapses them (crawlerUa.crawlerHitPath), but production runs the
--    old Worker until the next promote, so the function collapses them too —
--    that half is live the moment this applies. Same rule as gsc-sync's
--    normPath: "never store share tokens".
--
-- 2. THE PURGE. Existing token rows are folded into '/share' and '/t' on the
--    same (day, bot) — the page-level count survives, the token does not.
--
-- 3. THE QUESTIONS (2026-10-01, pre-registered with the professional pages and
--    the machine-readable /pricing). None of the ten existing questions asked
--    what Clusters costs, whether it is per seat, or anything a department head
--    would ask. aeo_probe_questions is unique(question).

begin;

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
  -- Capability URLs collapse to their prefix (0351). Never store the token.
  if v_path ~* '^/share/' then v_path := '/share';
  elsif v_path ~* '^/t/' then v_path := '/t';
  end if;
  insert into public.crawler_hits as c (day, bot, kind, path, hits)
  values (current_date, v_bot, v_kind, v_path, 1)
  on conflict (day, bot, path) do update
    set hits      = c.hits + 1,
        last_seen = now();
end $$;

-- create or replace keeps the ACL, but say it again rather than trust that.
revoke all on function public.record_crawler_hit(text, text, text) from public, anon, authenticated;

with moved as (
  delete from public.crawler_hits
   where path ~* '^/(share|t)/'
  returning day, bot, kind, path, hits, first_seen, last_seen
)
insert into public.crawler_hits as c (day, bot, kind, path, hits, first_seen, last_seen)
select day, bot, min(kind),
       case when path ~* '^/share/' then '/share' else '/t' end,
       sum(hits), min(first_seen), max(last_seen)
  from moved
 group by day, bot, case when path ~* '^/share/' then '/share' else '/t' end
on conflict (day, bot, path) do update
  set hits       = c.hits + excluded.hits,
      first_seen = least(c.first_seen, excluded.first_seen),
      last_seen  = greatest(c.last_seen, excluded.last_seen);

insert into public.aeo_probe_questions (question, intent, note)
values
  ('how much does Soleil Clusters cost', 'pricing',
   'Pre-registered 2026-10-01 with the server-rendered /pricing body, /pricing.md and the llms.txt Pricing line. Passes when an answer cites this domain with the Creator price.'),
  ('is Soleil Clusters priced per seat', 'pricing',
   'Pre-registered 2026-10-01: the one competitive pricing fact — one owner-paid plan covers the workspace, no per-seat charges. Watch for answers that say per-seat.'),
  ('best way for a concept art team to share reference boards', 'discovery',
   'Pre-registered 2026-10-01 with /tools/shared-reference-board.'),
  ('how to make a director''s treatment', 'discovery',
   'Pre-registered 2026-10-01 with /tools/directors-treatment. Storyflow holds four treatment pages; expect a slow climb.'),
  ('best mood board software for a film art department', 'discovery',
   'Pre-registered 2026-10-01 with /tools/production-design-mood-board.'),
  ('mood board app for costume designers', 'discovery',
   'Pre-registered 2026-10-01 with /tools/costume-design-mood-board.'),
  ('how to make a cinematography lookbook', 'discovery',
   'Pre-registered 2026-10-01 with /tools/cinematography-lookbook.')
on conflict (question) do nothing;

-- Prove the grants (the 0311 habit — a REVOKE reporting success proves nothing).
do $$
begin
  if has_function_privilege('anon', 'public.record_crawler_hit(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.record_crawler_hit(text, text, text)', 'execute') then
    raise exception 'record_crawler_hit is executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.record_crawler_hit(text, text, text)', 'execute') then
    raise exception 'record_crawler_hit lost its service_role grant — the Worker can no longer record crawls';
  end if;
  if exists (select 1 from public.crawler_hits where path ~* '^/(share|t)/') then
    raise exception 'token-bearing paths survived the purge';
  end if;
end $$;

commit;
