-- 0257 — health checks for the machine-readable marketing corpus.
--
-- APPLY THIS *AFTER* PROMOTING, NOT BEFORE. Every row below asserts something
-- that only becomes true once the build carrying the /best/*.md and /vs/*.md
-- mirrors reaches production. Applying it early turns seo-health red for the
-- whole gap between migrating and promoting, which is exactly the false alarm
-- the build_min row exists to distinguish from a real regression.
--
-- WHY these checks (2026-08-22): AI assistants are the highest-activation
-- acquisition channel on the site (8 of 11 signups placed a card, vs 51.7% for
-- search), and they cite the /best/* buying guides. Two things could silently
-- end that and neither would show up anywhere else:
--
--   1. The .md mirrors stop being generated. They are committed build output —
--      a bad merge or a skipped `docs:build` drops them and nothing complains,
--      because the HTML pages keep working fine.
--   2. Cloudflare's AI-crawler blocking gets enabled at the zone level. The
--      site would look perfectly healthy to every human and to Googlebot while
--      serving a challenge page to GPTBot. The user_agent column (0256) exists
--      for exactly this: probe as the crawler, not as ourselves.

insert into public.seo_health_expectations (url, check_name, kind, expected, enabled, user_agent)
values
  -- 1. The mirrors exist and carry real content, not an SPA shell.
  ('https://clusters.soleilpictures.com/best/pureref-alternatives.md',
   'listicle md mirror', 'body', 'Best PureRef Alternatives', true, null),
  -- Assert the CLAIM, not the title: the .md mirror carries the h1 and prose,
  -- never the <title>. After the 2026-08-23 intent split the h1 leads with
  -- "PureRef Online", so a 'PureRef Alternative' assertion here fails against a
  -- perfectly healthy page. (It did, on the first run.)
  ('https://clusters.soleilpictures.com/vs/pureref.md',
   'landing md mirror', 'body', 'There is no web version of PureRef', true, null),
  ('https://clusters.soleilpictures.com/vs/pureref.md',
   'landing md is not the SPA shell', 'status', '200', true, null),

  -- 2. llms.txt actually indexes the buying guides (the whole point of 0256's
  --    gen-docs change; a regenerate that lost the section would be silent).
  ('https://clusters.soleilpictures.com/llms.txt',
   'llms.txt indexes buying guides', 'body', '/best/pureref-alternatives', true, null),

  -- 3. The AI crawlers still receive the real page. `expected` is a phrase from
  --    the article body, so a challenge/block page fails the check.
  ('https://clusters.soleilpictures.com/best/pureref-alternatives',
   'GPTBot sees real content', 'body', 'Best PureRef Alternatives', true,
   'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot'),
  ('https://clusters.soleilpictures.com/best/pureref-alternatives',
   'PerplexityBot sees real content', 'body', 'Best PureRef Alternatives', true,
   'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'),
  ('https://clusters.soleilpictures.com/best/pureref-alternatives',
   'ClaudeBot sees real content', 'body', 'Best PureRef Alternatives', true,
   'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')
on conflict do nothing;

-- Deploy-drift stamp: bump to the date this actually ships.
update public.seo_health_expectations
   set expected = '2026-08-23'
 where kind = 'build_min';
