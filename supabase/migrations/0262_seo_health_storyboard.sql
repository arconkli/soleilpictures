-- 0262 — retire the three storyboard /vs/ pages, guard the page that replaced them.
--
-- APPLY THIS *AFTER* PROMOTING, NOT BEFORE — same rule as 0257. Every row below
-- asserts something that only becomes true once the build carrying
-- /best/storyboard-software and the RETIRED_PAGES redirect map reaches
-- production. Applying it early turns seo-health red for the whole gap between
-- migrating and promoting, which is exactly the false alarm the build_min row
-- exists to distinguish from a real regression.
--
-- WHY (2026-08-26): /vs/storyboarder, /vs/boords and /vs/studiobinder ran four
-- weeks each without recording a single impression, while the listicle format
-- overtook its own /vs/ sibling within days of launch. Their (re-verified)
-- competitor research was folded into /best/storyboard-software and the three
-- specs deleted from seoLanding.js. The six expectations below would go red the
-- moment those paths stopped serving their own titles, so they go with them.

begin;

-- 1. The retired pages. Delete by URL rather than id — ids are incidental.
delete from public.seo_health_expectations
 where url in (
   'https://clusters.soleilpictures.com/vs/storyboarder',
   'https://clusters.soleilpictures.com/vs/boords',
   'https://clusters.soleilpictures.com/vs/studiobinder'
 );

-- 2. The page that absorbed them. `expected` is a SUBSTRING of the real title
--    ("10 Best Storyboard Software Tools in 2026 (Studio Tested)") so an
--    editorial retitle does not fail the check, but losing the topic does.
insert into public.seo_health_expectations (url, check_name, kind, expected, enabled, user_agent)
values
  ('https://clusters.soleilpictures.com/best/storyboard-software',
   'listicle storyboard title', 'title', 'Best Storyboard Software', true, null),
  ('https://clusters.soleilpictures.com/best/storyboard-software',
   'listicle storyboard canonical', 'canonical',
   'https://clusters.soleilpictures.com/best/storyboard-software', true, null),

  -- 3. The .md mirror, matching the pattern 0257 established for the corpus.
  --    Assert the CLAIM, not the title: mirrors carry the h1 and prose, never
  --    the <title>. (0257 learned this the hard way on /vs/pureref.md.)
  ('https://clusters.soleilpictures.com/best/storyboard-software.md',
   'storyboard md mirror', 'body', 'The Two Storyboards', true, null),

  -- 4. The redirects actually land on the replacement.
  --    NOTE: the prober fetches with `redirect: "follow"` (seo-health/index.ts),
  --    so a `status` check here would see the final 200, never the 301. Asserting
  --    the BODY is the stronger check anyway — it fails both if the redirect
  --    breaks and if it survives but lands on a 404 or the bare SPA shell.
  ('https://clusters.soleilpictures.com/vs/storyboarder',
   'retired storyboarder lands on the guide', 'body', 'Best Storyboard Software Tools', true, null),
  ('https://clusters.soleilpictures.com/vs/boords',
   'retired boords lands on the guide', 'body', 'Best Storyboard Software Tools', true, null),
  ('https://clusters.soleilpictures.com/vs/studiobinder',
   'retired studiobinder lands on the guide', 'body', 'Best Storyboard Software Tools', true, null)
on conflict do nothing;

-- 5. Deploy-drift stamp: bump to the date this actually ships.
update public.seo_health_expectations
   set expected = '2026-08-26'
 where kind = 'build_min';

commit;
