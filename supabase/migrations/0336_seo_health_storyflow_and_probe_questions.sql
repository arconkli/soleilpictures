-- 0336 — health expectations for /vs/storyflow, two AEO probe questions, and
-- the deploy-drift stamp.
--
-- APPLY AFTER PROMOTING, never before (the 0262/0268 rule): every row here
-- asserts on a page production does not serve until the promote lands, so
-- applying first paints the health strip red for the whole gap.
--
-- Idempotent by (url, check_name): seo_health_expectations has no unique key
-- but its identity id, so `on conflict do nothing` is a no-op there and a
-- second apply would duplicate every row (0262 and 0268 carry that wart).
-- aeo_probe_questions DOES carry unique(question).
--
-- The repo half: every kind='body' row below is mirrored into
-- boards/src/lib/seoProbeContract.js in a follow-up commit, keyed by the ids
-- this insert generates (read them back: select id, url, check_name from
-- seo_health_expectations order by id desc limit 6).

begin;

insert into public.seo_health_expectations (url, check_name, kind, expected, enabled, user_agent)
select v.url, v.check_name, v.kind, v.expected, true, null
from (values
  -- 1. The page is up and is the page we think it is. `expected` is a SUBSTRING
  --    of the title so an editorial retitle survives; losing the topic fails.
  ('https://clusters.soleilpictures.com/vs/storyflow',
   'storyflow title', 'title', 'Storyflow Alternative'),
  ('https://clusters.soleilpictures.com/vs/storyflow',
   'storyflow canonical', 'canonical', 'https://clusters.soleilpictures.com/vs/storyflow'),
  -- 2. The .md mirror, matching 0257/0268: assert the h1 the mirror carries,
  --    never the <title> (mirrors carry the h1 and prose, never the title).
  ('https://clusters.soleilpictures.com/vs/storyflow.md',
   'storyflow md mirror', 'body', 'A Storyflow Alternative for Crews That Work Live'),
  -- 3. Discovery: a page that renders but fell out of the sitemap is invisible
  --    in a way no per-page check shows.
  ('https://clusters.soleilpictures.com/sitemap.xml',
   'sitemap has storyflow', 'body', '/vs/storyflow')
) as v(url, check_name, kind, expected)
where not exists (
  select 1 from public.seo_health_expectations e
   where e.url = v.url and e.check_name = v.check_name
);

-- 4. The two probe questions the /vs/storyflow pre-registration names. The
--    Worker's weekly sweep reads enabled=true rows, so these are asked on the
--    next run with no deploy.
insert into public.aeo_probe_questions (question, intent, note)
values
  ('best Storyflow alternative for filmmakers', 'comparison',
   'Pre-registered 2026-09-19 with /vs/storyflow: an uncontested query — only storyflow.so answers it today.'),
  ('Storyflow vs Soleil Clusters', 'comparison',
   'Pre-registered 2026-09-19 with /vs/storyflow: the brand-vs-brand form assistants are asked.')
on conflict (question) do nothing;

-- 5. Deploy-drift stamp: bump to the date the promote actually ships.
update public.seo_health_expectations
   set expected = '2026-09-19'
 where kind = 'build_min';

commit;
