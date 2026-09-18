-- 0268 — seo-health guards for /templates, the grid-template gallery.
--
-- APPLY THIS *AFTER* PROMOTING, NOT BEFORE — same rule as 0257 and 0262. Every
-- row below asserts something that only becomes true once the build carrying
-- the /templates landing spec reaches production. Applying it early turns
-- seo-health red for the whole gap between migrating and promoting, which is
-- exactly the false alarm the build_min row exists to distinguish from a real
-- regression.
--
-- WHY: /templates is a self-authored landing page targeting "grid template" /
-- "storyboard template" — a query class we have never had a page for. It also
-- carries the one live gallery strip on the marketing surface, so it has a
-- failure mode the other landings do not: the static copy can render perfectly
-- while the strip silently returns nothing. The title/canonical rows catch the
-- page disappearing; the sitemap row catches it dropping out of discovery.
-- Nothing here asserts the strip's CONTENTS, deliberately — an empty gallery is
-- a legitimate state on day one and must not read as an outage.

begin;

-- 1. The page is up and is the page we think it is. `expected` is a SUBSTRING of
--    the real title ("Grid Templates — Storyboard, Contact Sheet, Shot List") so
--    an editorial retitle does not fail the check, but losing the topic does.
insert into public.seo_health_expectations (url, check_name, kind, expected, enabled, user_agent)
values
  ('https://clusters.soleilpictures.com/templates',
   'templates title', 'title', 'Grid Templates', true, null),
  ('https://clusters.soleilpictures.com/templates',
   'templates canonical', 'canonical',
   'https://clusters.soleilpictures.com/templates', true, null),

  -- 2. The crawlable body, not just the meta. The Worker injects the landing's
  --    static sections into #seo-fallback; asserting a phrase from the prose
  --    fails if the page degrades to the bare SPA shell, which the title check
  --    alone would not catch.
  ('https://clusters.soleilpictures.com/templates',
   'templates crawlable body', 'body', 'A template is a shape, not a document', true, null),

  -- 3. The .md mirror, matching the pattern 0257 established for the corpus.
  --    Assert the CLAIM, not the title: mirrors carry the h1 and prose, never
  --    the <title>. (0257 learned this the hard way on /vs/pureref.md.)
  ('https://clusters.soleilpictures.com/templates.md',
   'templates md mirror', 'body', 'Grid templates', true, null),

  -- 4. Discovery. Mirrors the existing 'sitemap has landings' row: a page that
  --    renders but has fallen out of the sitemap is invisible in a way no
  --    per-page check would ever show.
  ('https://clusters.soleilpictures.com/sitemap.xml',
   'sitemap has templates', 'body', '/templates', true, null)
on conflict do nothing;

-- 5. Deploy-drift stamp: bump to the date this actually ships.
update public.seo_health_expectations
   set expected = '2026-08-27'
 where kind = 'build_min';

commit;
