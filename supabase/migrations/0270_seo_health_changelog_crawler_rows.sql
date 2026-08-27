-- 0270 — repoint the three AI-crawler changelog rows off a headline.
--
-- Rows 60-62 ('GPTBot|ClaudeBot|PerplexityBot sees the changelog') asserted the
-- substring 'A tab that says which cluster'. That was the OPENING OF A CHANGELOG
-- ENTRY HEADLINE, and 5c224b1 retitled the entry to:
--
--   "Settings you can find, and a tab that says which cluster"
--
-- which moved the phrase mid-sentence, so the page now renders a lowercase "a".
-- seo-health compares kind 'body' with a case-sensitive `body.includes()`, so
-- all three went red at the 00:37 run on 2026-08-27 having passed at 12:37 and
-- 18:37 the day before.
--
-- Nothing was wrong with the crawlers. All three receive the full
-- server-rendered page — 200, ~36KB, correct title, complete crawlable body.
-- A copy edit produced an "AI crawlers are blocked" alarm, which is the most
-- expensive false positive this dashboard can raise: AI referrals are the
-- best-converting channel, so that alarm is the one nobody can afford to learn
-- to ignore.
--
-- Repointed at a fragment of CHANGELOG_ANSWER (scripts/gen-docs.mjs) — the
-- page's fixed intro sentence. It is GENERATOR BOILERPLATE, not entry prose:
-- entry titles get rewritten as a matter of practice, that sentence does not,
-- and changelog.test.mjs already asserts it reaches CHANGELOG_HTML. It also
-- reaches the page only through the #seo-fallback injection, so a challenge
-- page or an unfilled SPA shell still fails the check.
--
-- Do NOT anchor one of these on id="seo-fallback": that is static markup in
-- boards/index.html and is present even when the injection never ran.
--
-- LESSON, and the sibling of 0263's: an expectation can assert PROSE THAT
-- SOMEONE WILL EDIT. 0263 was "grep `expected`, not just `url`, when retiring a
-- page"; this one is "never pin a check to a sentence a writer owns". Both are
-- the same blind spot — the assertions live in Postgres, the strings live in the
-- repo, and nothing connected them. boards/src/lib/seoProbeContract.js now
-- mirrors every kind:'body' row and seoProbeContract.test.mjs fails the build
-- naming the row, so the next one of these is caught before it ships.
--
-- Matched by check_name rather than by the old value so this is idempotent: it
-- was already applied by hand when the strip was red.

update public.seo_health_expectations
   set expected = 'ships continuously; this page lists every user-visible change'
 where kind = 'body'
   and url = 'https://clusters.soleilpictures.com/changelog'
   and check_name in (
     'GPTBot sees the changelog',
     'ClaudeBot sees the changelog',
     'PerplexityBot sees the changelog'
   );
