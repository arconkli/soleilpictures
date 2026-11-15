-- 0883 — live health expectations for the twelve search pages nothing watched.
--
-- Why: the six-hourly prober (supabase/functions/seo-health) had no row at all
-- for nine /tools pages and three /vs pages, so one of them could 404, lose its
-- server-rendered head or be served the bare app shell and nothing would say
-- so. Each page gets two rows:
--
--   status — the page answers 200 (a retired or mis-routed page answers 404);
--   title  — the <title> still names the page's subject.
--
-- A title row asserts the SHORTEST distinctive substring, never the whole
-- title (0336's rule), so a retitle that keeps the subject stays green. The
-- 404 page's title ("Page not found …") and the app shell's carry none of
-- them. None contains &, < or > (the served <title> is HTML-escaped) or a
-- typographic apostrophe, which is why /tools/directors-treatment asserts
-- 'Treatment' and plurals are left off ('Shared Reference Board').
--
-- The ids are PINNED to 86-111 with `overriding system value` (0866's shape),
-- so the repo half — the mirror in boards/src/lib/seoProbeContract.js — ships
-- in the same commit. If one of those ids is already held by a different row,
-- the proof below fails loudly instead of mirroring the wrong row. The identity
-- is then moved past them.
--
-- Apply any time: production already serves every status and string asserted
-- here (read live on 2026-11-14), so 0350's apply-after-promoting rule is met.
--
-- Idempotent by (url, check_name) — seo_health_expectations has no unique key
-- but its identity id (0336's note). Data only: no functions, no grant proof.

begin;

insert into public.seo_health_expectations (id, url, check_name, kind, expected, enabled, user_agent)
overriding system value
select v.id::bigint, v.url, v.check_name, v.kind, v.expected, true, null
from (values
  ( 86, 'https://clusters.soleilpictures.com/tools/storyboard-maker',
        'storyboard maker loads', 'status', '200'),
  ( 87, 'https://clusters.soleilpictures.com/tools/storyboard-maker',
        'storyboard maker title', 'title', 'Storyboard Maker'),
  ( 88, 'https://clusters.soleilpictures.com/tools/shot-list-maker',
        'shot list maker loads', 'status', '200'),
  ( 89, 'https://clusters.soleilpictures.com/tools/shot-list-maker',
        'shot list maker title', 'title', 'Shot List Maker'),
  ( 90, 'https://clusters.soleilpictures.com/tools/look-book-maker',
        'look book maker loads', 'status', '200'),
  ( 91, 'https://clusters.soleilpictures.com/tools/look-book-maker',
        'look book maker title', 'title', 'Look Book Maker'),
  ( 92, 'https://clusters.soleilpictures.com/tools/free-mood-board-maker',
        'free mood board maker loads', 'status', '200'),
  ( 93, 'https://clusters.soleilpictures.com/tools/free-mood-board-maker',
        'free mood board maker title', 'title', 'Free Mood Board Maker'),
  ( 94, 'https://clusters.soleilpictures.com/tools/shared-reference-board',
        'shared reference board loads', 'status', '200'),
  ( 95, 'https://clusters.soleilpictures.com/tools/shared-reference-board',
        'shared reference board title', 'title', 'Shared Reference Board'),
  ( 96, 'https://clusters.soleilpictures.com/tools/directors-treatment',
        'directors treatment loads', 'status', '200'),
  ( 97, 'https://clusters.soleilpictures.com/tools/directors-treatment',
        'directors treatment title', 'title', 'Treatment'),
  ( 98, 'https://clusters.soleilpictures.com/tools/production-design-mood-board',
        'production design mood board loads', 'status', '200'),
  ( 99, 'https://clusters.soleilpictures.com/tools/production-design-mood-board',
        'production design mood board title', 'title', 'Production Design Mood Board'),
  (100, 'https://clusters.soleilpictures.com/tools/costume-design-mood-board',
        'costume design mood board loads', 'status', '200'),
  (101, 'https://clusters.soleilpictures.com/tools/costume-design-mood-board',
        'costume design mood board title', 'title', 'Costume Design Mood Board'),
  (102, 'https://clusters.soleilpictures.com/tools/cinematography-lookbook',
        'cinematography lookbook loads', 'status', '200'),
  (103, 'https://clusters.soleilpictures.com/tools/cinematography-lookbook',
        'cinematography lookbook title', 'title', 'Cinematography Lookbook'),
  (104, 'https://clusters.soleilpictures.com/vs/eagle',
        'eagle compare loads', 'status', '200'),
  (105, 'https://clusters.soleilpictures.com/vs/eagle',
        'eagle compare title', 'title', 'Eagle Alternative'),
  (106, 'https://clusters.soleilpictures.com/vs/google-drive',
        'google drive compare loads', 'status', '200'),
  (107, 'https://clusters.soleilpictures.com/vs/google-drive',
        'google drive compare title', 'title', 'Google Drive Alternative'),
  (108, 'https://clusters.soleilpictures.com/vs/miro',
        'miro compare loads', 'status', '200'),
  (109, 'https://clusters.soleilpictures.com/vs/miro',
        'miro compare title', 'title', 'Miro Alternative'),
  (110, 'https://clusters.soleilpictures.com/scout',
        'scout loads', 'status', '200'),
  (111, 'https://clusters.soleilpictures.com/scout',
        'scout title', 'title', 'Soleil Scout')
) as v(id, url, check_name, kind, expected)
where not exists (
  select 1 from public.seo_health_expectations e
   where e.url = v.url and e.check_name = v.check_name
);

-- Move the identity past the pinned ids.
select setval(pg_get_serial_sequence('public.seo_health_expectations', 'id'),
              (select max(id) from public.seo_health_expectations));

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ( 86, 'https://clusters.soleilpictures.com/tools/storyboard-maker',
            'storyboard maker loads', 'status', '200'),
      ( 87, 'https://clusters.soleilpictures.com/tools/storyboard-maker',
            'storyboard maker title', 'title', 'Storyboard Maker'),
      ( 88, 'https://clusters.soleilpictures.com/tools/shot-list-maker',
            'shot list maker loads', 'status', '200'),
      ( 89, 'https://clusters.soleilpictures.com/tools/shot-list-maker',
            'shot list maker title', 'title', 'Shot List Maker'),
      ( 90, 'https://clusters.soleilpictures.com/tools/look-book-maker',
            'look book maker loads', 'status', '200'),
      ( 91, 'https://clusters.soleilpictures.com/tools/look-book-maker',
            'look book maker title', 'title', 'Look Book Maker'),
      ( 92, 'https://clusters.soleilpictures.com/tools/free-mood-board-maker',
            'free mood board maker loads', 'status', '200'),
      ( 93, 'https://clusters.soleilpictures.com/tools/free-mood-board-maker',
            'free mood board maker title', 'title', 'Free Mood Board Maker'),
      ( 94, 'https://clusters.soleilpictures.com/tools/shared-reference-board',
            'shared reference board loads', 'status', '200'),
      ( 95, 'https://clusters.soleilpictures.com/tools/shared-reference-board',
            'shared reference board title', 'title', 'Shared Reference Board'),
      ( 96, 'https://clusters.soleilpictures.com/tools/directors-treatment',
            'directors treatment loads', 'status', '200'),
      ( 97, 'https://clusters.soleilpictures.com/tools/directors-treatment',
            'directors treatment title', 'title', 'Treatment'),
      ( 98, 'https://clusters.soleilpictures.com/tools/production-design-mood-board',
            'production design mood board loads', 'status', '200'),
      ( 99, 'https://clusters.soleilpictures.com/tools/production-design-mood-board',
            'production design mood board title', 'title', 'Production Design Mood Board'),
      (100, 'https://clusters.soleilpictures.com/tools/costume-design-mood-board',
            'costume design mood board loads', 'status', '200'),
      (101, 'https://clusters.soleilpictures.com/tools/costume-design-mood-board',
            'costume design mood board title', 'title', 'Costume Design Mood Board'),
      (102, 'https://clusters.soleilpictures.com/tools/cinematography-lookbook',
            'cinematography lookbook loads', 'status', '200'),
      (103, 'https://clusters.soleilpictures.com/tools/cinematography-lookbook',
            'cinematography lookbook title', 'title', 'Cinematography Lookbook'),
      (104, 'https://clusters.soleilpictures.com/vs/eagle',
            'eagle compare loads', 'status', '200'),
      (105, 'https://clusters.soleilpictures.com/vs/eagle',
            'eagle compare title', 'title', 'Eagle Alternative'),
      (106, 'https://clusters.soleilpictures.com/vs/google-drive',
            'google drive compare loads', 'status', '200'),
      (107, 'https://clusters.soleilpictures.com/vs/google-drive',
            'google drive compare title', 'title', 'Google Drive Alternative'),
      (108, 'https://clusters.soleilpictures.com/vs/miro',
            'miro compare loads', 'status', '200'),
      (109, 'https://clusters.soleilpictures.com/vs/miro',
            'miro compare title', 'title', 'Miro Alternative'),
      (110, 'https://clusters.soleilpictures.com/scout',
            'scout loads', 'status', '200'),
      (111, 'https://clusters.soleilpictures.com/scout',
            'scout title', 'title', 'Soleil Scout')
    ) as t(id, url, check_name, kind, expected)
  loop
    if not exists (
      select 1 from public.seo_health_expectations e
       where e.id = r.id and e.url = r.url and e.check_name = r.check_name
         and e.kind = r.kind and e.expected = r.expected and e.enabled = true
         and e.user_agent is null
    ) then
      raise exception '0883: expectation id % is not the row this migration pins', r.id;
    end if;
  end loop;

  if pg_sequence_last_value(
       pg_get_serial_sequence('public.seo_health_expectations', 'id')::regclass) is null
     or pg_sequence_last_value(
       pg_get_serial_sequence('public.seo_health_expectations', 'id')::regclass) < 111 then
    raise exception '0883: the id sequence did not move past 111';
  end if;
end $$;

commit;
