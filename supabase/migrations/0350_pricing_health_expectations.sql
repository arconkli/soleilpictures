-- 0350 — health expectations for the server-rendered /pricing body and its
-- /pricing.md twin.
--
-- APPLY AFTER PROMOTING, never before (the 0262/0268/0336 rule): until the
-- promote lands, production still serves /pricing with the HOMEPAGE's fallback
-- body, so every row below would paint the health strip red for the gap.
--
-- Why these exist: for months /pricing's crawlable body was byte-identical to
-- '/', and the only price on the page lived in a meta description. Nothing
-- checked it, because no expectation targeted /pricing at all (0 of 57 rows on
-- 2026-10-01). The first row asserts a heading only the pricing body carries;
-- the GPTBot row asserts an AI crawler gets the same thing; the .md row asserts
-- the twin exists and is not the SPA shell.
--
-- Idempotent by (url, check_name) — seo_health_expectations has no unique key
-- but its identity id (0336's note).
--
-- THE REPO HALF, after applying: mirror each kind='body' row into
-- boards/src/lib/seoProbeContract.js keyed by the generated ids (read them back:
-- select id, url, check_name from seo_health_expectations order by id desc
-- limit 4). The 'pricing' source kind already resolves to the Worker's own
-- builder, so the rows only need adding. Then bump build_min to the promote date.

begin;

insert into public.seo_health_expectations (url, check_name, kind, expected, enabled, user_agent)
select v.url, v.check_name, v.kind, v.expected, true, v.user_agent
from (values
  ('https://clusters.soleilpictures.com/pricing',
   'pricing body is the pricing page', 'body', 'Both plans, line by line', null),
  ('https://clusters.soleilpictures.com/pricing',
   'GPTBot sees the pricing plans', 'body', 'no per-seat charges',
   'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot'),
  ('https://clusters.soleilpictures.com/pricing.md',
   'pricing md mirror', 'body', 'Start free. Pay when you outgrow it.', null),
  ('https://clusters.soleilpictures.com/pricing.md',
   'pricing md is not the SPA shell', 'status', '200', null)
) as v(url, check_name, kind, expected, user_agent)
where not exists (
  select 1 from public.seo_health_expectations e
   where e.url = v.url and e.check_name = v.check_name
);

commit;
