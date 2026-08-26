-- 0263 — repoint the one health row 0262 could not see.
--
-- 0262 deleted the retired pages' expectations BY URL. This row's url is
-- sitemap.xml — it is the *expected* value that named /vs/storyboarder:
--
--   check_name 'sitemap has new vs pages', kind 'body', expected '/vs/storyboarder'
--
-- added when those three compare pages launched. Retiring them left the row
-- asserting that a 301'd path is still listed in the sitemap, which it correctly
-- is not. Caught by running the prober's comparisons by hand after promoting:
-- 36 pass, this one fail.
--
-- LESSON worth keeping: when retiring a page, grep `expected` as well as `url`.
-- An expectation can name a page it does not point at, and deleting by url alone
-- leaves it behind as a guaranteed red.
--
-- Repointed at the page that absorbed all three, which preserves what the check
-- was actually for: the newest marketing page reaches the sitemap.

update public.seo_health_expectations
   set check_name = 'sitemap has the storyboard guide',
       expected   = '/best/storyboard-software'
 where kind = 'body'
   and url = 'https://clusters.soleilpictures.com/sitemap.xml'
   and expected = '/vs/storyboarder';
