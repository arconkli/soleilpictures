-- 0866 — live health expectations for /tools/video-reference-board.
--
-- Why: every other search page carries title / canonical / .md mirror /
-- sitemap rows (see /vs/storyflow, 0336), but the video reference board page
-- had none, so nothing watched it.
--
-- The ids are PINNED to 82-85 with `overriding system value`, so the repo half
-- (the contract mirror in boards/src/lib/seoProbeContract.js) ships in the same
-- commit instead of after applying. If any of those ids is already held by a
-- different row, the insert or the proof below fails loudly rather than
-- mirroring the wrong row. The identity is then moved past them.
--
-- Apply any time: production already serves every string asserted here, so
-- 0350's apply-after-promoting rule is already met.
--
-- Idempotent by (url, check_name) — seo_health_expectations has no unique key
-- but its identity id (0336's note).

begin;

insert into public.seo_health_expectations (id, url, check_name, kind, expected, enabled, user_agent)
overriding system value
select v.id::bigint, v.url, v.check_name, v.kind, v.expected, true, null
from (values
  (82, 'https://clusters.soleilpictures.com/tools/video-reference-board',
   'video reference board title', 'title', 'Video Reference Board'),
  (83, 'https://clusters.soleilpictures.com/tools/video-reference-board',
   'video reference board canonical', 'canonical',
   'https://clusters.soleilpictures.com/tools/video-reference-board'),
  (84, 'https://clusters.soleilpictures.com/tools/video-reference-board.md',
   'video reference board md mirror', 'body', 'A Reference Board That Plays Video'),
  (85, 'https://clusters.soleilpictures.com/sitemap.xml',
   'sitemap has video reference board', 'body', '/tools/video-reference-board')
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
      (82, 'https://clusters.soleilpictures.com/tools/video-reference-board',
       'video reference board title', 'title', 'Video Reference Board'),
      (83, 'https://clusters.soleilpictures.com/tools/video-reference-board',
       'video reference board canonical', 'canonical',
       'https://clusters.soleilpictures.com/tools/video-reference-board'),
      (84, 'https://clusters.soleilpictures.com/tools/video-reference-board.md',
       'video reference board md mirror', 'body', 'A Reference Board That Plays Video'),
      (85, 'https://clusters.soleilpictures.com/sitemap.xml',
       'sitemap has video reference board', 'body', '/tools/video-reference-board')
    ) as t(id, url, check_name, kind, expected)
  loop
    if not exists (
      select 1 from public.seo_health_expectations e
       where e.id = r.id and e.url = r.url and e.check_name = r.check_name
         and e.kind = r.kind and e.expected = r.expected and e.enabled = true
    ) then
      raise exception '0866: expectation id % is not the row this migration pins', r.id;
    end if;
  end loop;

  if pg_sequence_last_value(
       pg_get_serial_sequence('public.seo_health_expectations', 'id')::regclass) is null
     or pg_sequence_last_value(
       pg_get_serial_sequence('public.seo_health_expectations', 'id')::regclass) < 85 then
    raise exception '0866: the id sequence did not move past 85';
  end if;
end $$;

commit;
