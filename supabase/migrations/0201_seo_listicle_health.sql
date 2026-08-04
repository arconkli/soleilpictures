-- 0201: seo-health expectations for the /best/* listicle family + the
-- /vs/pureref CTR-experiment retitle, plus the build_min bump for the ship.
--
-- APPLY AFTER the production promotion that ships /best/* — these URLs 404 on
-- prod until then and would sit red in the health strip (only build_min is
-- designed to be the "prod lagging main" indicator).
--
-- /vs/pureref previously had NO title row; its check expects the stable
-- "PureRef Alternative" prefix, which survives future title experiments that
-- keep the leading keyword (the 2026-08 retitle does).

insert into seo_health_expectations (url, check_name, kind, expected) values
  ('https://clusters.soleilpictures.com/best/pureref-alternatives',  'listicle pureref title',   'title',     'PureRef Alternatives'),
  ('https://clusters.soleilpictures.com/best/pureref-alternatives',  'listicle pureref canonical','canonical', 'https://clusters.soleilpictures.com/best/pureref-alternatives'),
  ('https://clusters.soleilpictures.com/best/milanote-alternatives', 'listicle milanote title',  'title',     'Milanote Alternatives'),
  ('https://clusters.soleilpictures.com/best/mood-board-apps',       'listicle moodboard title', 'title',     'Mood Board Apps'),
  ('https://clusters.soleilpictures.com/sitemap.xml',                'sitemap has listicles',    'body',      '/best/pureref-alternatives'),
  ('https://clusters.soleilpictures.com/best/zzz-not-a-real-page',   'unknown listicle 404',     'status',    '404'),
  ('https://clusters.soleilpictures.com/vs/pureref',                 'pureref compare title',    'title',     'PureRef Alternative');

-- Ship gate: a deploy stuck before this date turns the strip red.
update seo_health_expectations
   set expected = '2026-08-04'
 where kind = 'build_min';
