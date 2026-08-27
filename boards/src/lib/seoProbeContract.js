// seoProbeContract.js — what the external SEO prober asserts, written down
// where code review can see it.
//
// The prober (supabase/functions/seo-health/index.ts, pg_cron every 6h) reads
// its expectations from the `seo_health_expectations` TABLE, and it will keep
// doing that. Expectations are deliberately DB-resident so a stuck deploy
// cannot self-certify: if the checks shipped with the build, a build that
// failed to deploy would carry the stale assertions that match its own stale
// content, and the strip would stay green while production rotted.
//
// This file does NOT feed the prober. It is the other direction, and it closes
// the only gap that design left open:
//
//   the assertions live in Postgres, the prose they assert on lives in this
//   repo, and NOTHING connected the two.
//
// Concretely, on 2026-08-26: rows 60-62 asserted the substring
// "A tab that says which cluster", which was the opening of a changelog entry
// headline. `5c224b1` retitled that entry to "Settings you can find, and a tab
// that says which cluster" — the phrase moved to mid-sentence, so the page now
// reads a lowercase "a", `evaluate()` does a case-sensitive includes(), and the
// next run turned all three AI-crawler checks red. For three hours the admin
// Discover strip claimed ClaudeBot, GPTBot and PerplexityBot were being denied
// the changelog. They never were. A copy edit did it.
//
// That is the most expensive false positive this dashboard can produce — AI
// referrals are the best-converting acquisition channel here, so "the crawlers
// are blocked" is the one alarm nobody can afford to learn to ignore.
//
// So: every kind:'body' expectation whose `expected` string originates in this
// repo gets a row here, and seoProbeContract.test.mjs asserts the string still
// appears in the very artifact the Worker serves. Rewrite the prose and
// `npm test` goes red naming the DB row to update — BEFORE it ships, instead of
// six hours after.
//
// ADDING A CHECK: add the DB row, then add it here. A `body` expectation with
// no entry here is one nobody will notice rotting.

// The prober stores absolute URLs; every one shares this origin. Rows below
// carry the path, which is what you actually match against the source.
export const PROBE_ORIGIN = 'https://clusters.soleilpictures.com';

// `source` names the artifact the Worker actually serves for that URL:
//   { kind: 'changelog' }            CHANGELOG_HTML, injected into #seo-fallback
//   { kind: 'listicle', path }       buildListicleCrawlableHtml(getListicleSpec(path))
//   { kind: 'docs', path }           DOCS_HTML[path]
//   { kind: 'file',  path }          a committed file under boards/ served as-is
//   { kind: 'route' }                a route path, not prose — asserted against
//                                    the landing/listicle path registries
export const SEO_PROBE_CONTRACT = [
  // ── The sitemap carries the routes it should ──────────────────────────────
  // These assert route paths, not prose. They rot only if a page is renamed or
  // dropped, which the path registries below already know about.
  { id: 7,  path: '/sitemap.xml', check: 'sitemap has landings',
    expected: '/tools/mood-board-maker', source: { kind: 'route' } },
  { id: 21, path: '/sitemap.xml', check: 'sitemap has the storyboard guide',
    expected: '/best/storyboard-software', source: { kind: 'route' } },
  { id: 33, path: '/sitemap.xml', check: 'sitemap has listicles',
    expected: '/best/pureref-alternatives', source: { kind: 'route' } },
  { id: 38, path: '/sitemap.xml', check: 'sitemap has the assistant page',
    expected: '/tools/ai-mood-board-maker', source: { kind: 'route' } },
  { id: 65, path: '/sitemap.xml', check: 'sitemap has the changelog',
    expected: '/changelog', source: { kind: 'route' } },

  // ── The markdown twins and llms.txt ───────────────────────────────────────
  { id: 39, path: '/best/pureref-alternatives.md', check: 'listicle md mirror',
    expected: 'Best PureRef Alternatives', source: { kind: 'file', path: 'public/best/pureref-alternatives.md' } },
  { id: 40, path: '/vs/pureref.md', check: 'landing md mirror',
    expected: 'There is no web version of PureRef', source: { kind: 'file', path: 'public/vs/pureref.md' } },
  { id: 42, path: '/llms.txt', check: 'llms.txt indexes buying guides',
    expected: '/best/pureref-alternatives', source: { kind: 'file', path: 'public/llms.txt' } },
  { id: 54, path: '/best/storyboard-software.md', check: 'storyboard md mirror',
    expected: 'The Two Storyboards', source: { kind: 'file', path: 'public/best/storyboard-software.md' } },
  { id: 63, path: '/changelog.md', check: 'changelog md mirror',
    expected: '# Changelog', source: { kind: 'file', path: 'public/changelog.md' } },
  { id: 64, path: '/changelog.xml', check: 'changelog feed is a feed',
    expected: '<rss version="2.0"', source: { kind: 'file', path: 'public/changelog.xml' } },
  { id: 69, path: '/best/pureref-alternatives.md', check: 'platform matrix in the md twin',
    expected: 'Where PureRef runs', source: { kind: 'file', path: 'public/best/pureref-alternatives.md' } },
  { id: 73, path: '/best/milanote-alternatives.md', check: 'milanote head-to-heads in the md twin',
    expected: 'Milanote head to head', source: { kind: 'file', path: 'public/best/milanote-alternatives.md' } },

  // ── The AI crawlers get real content, not the empty shell ─────────────────
  // The point of these is zone-level AI-crawler blocking: Cloudflare can turn
  // it on and silently cost the best-converting channel. So the string has to
  // be one a challenge page or an unfilled SPA shell cannot possibly carry.
  // Do NOT use id="seo-fallback" — that is static markup in index.html:240 and
  // is present even when the injection never ran.
  { id: 43, path: '/best/pureref-alternatives', check: 'GPTBot sees real content',
    expected: 'Best PureRef Alternatives', source: { kind: 'listicle', path: '/best/pureref-alternatives' } },
  { id: 44, path: '/best/pureref-alternatives', check: 'PerplexityBot sees real content',
    expected: 'Best PureRef Alternatives', source: { kind: 'listicle', path: '/best/pureref-alternatives' } },
  { id: 45, path: '/best/pureref-alternatives', check: 'ClaudeBot sees real content',
    expected: 'Best PureRef Alternatives', source: { kind: 'listicle', path: '/best/pureref-alternatives' } },
  { id: 68, path: '/best/pureref-alternatives', check: 'GPTBot sees the head-to-heads',
    expected: 'PureRef vs BeeRef', source: { kind: 'listicle', path: '/best/pureref-alternatives' } },
  { id: 72, path: '/best/milanote-alternatives', check: 'GPTBot sees the milanote head-to-heads',
    expected: 'Milanote vs Mural', source: { kind: 'listicle', path: '/best/milanote-alternatives' } },

  // The three that broke. `expected` is now a fragment of CHANGELOG_ANSWER
  // (scripts/gen-docs.mjs) — generator boilerplate, not entry prose. Entry
  // titles get rewritten as a matter of practice; this sentence does not, and
  // changelog.test.mjs already asserts it reaches CHANGELOG_HTML.
  { id: 60, path: '/changelog', check: 'GPTBot sees the changelog',
    expected: 'ships continuously; this page lists every user-visible change', source: { kind: 'changelog' } },
  { id: 61, path: '/changelog', check: 'ClaudeBot sees the changelog',
    expected: 'ships continuously; this page lists every user-visible change', source: { kind: 'changelog' } },
  { id: 62, path: '/changelog', check: 'PerplexityBot sees the changelog',
    expected: 'ships continuously; this page lists every user-visible change', source: { kind: 'changelog' } },

  // ── Sections that must survive a rebuild ──────────────────────────────────
  { id: 66, path: '/best/pureref-alternatives', check: 'head-to-head section is served',
    expected: 'id="pureref-vs-beeref"', source: { kind: 'listicle', path: '/best/pureref-alternatives' } },
  { id: 67, path: '/best/pureref-alternatives', check: 'platform matrix is served',
    expected: 'id="platforms"', source: { kind: 'listicle', path: '/best/pureref-alternatives' } },
  { id: 71, path: '/best/milanote-alternatives', check: 'milanote head-to-heads are served',
    expected: 'id="milanote-vs-canva"', source: { kind: 'listicle', path: '/best/milanote-alternatives' } },

  // These three URLs are 301s onto the storyboard guide (the prober follows
  // redirects), so the string has to live in the REDIRECT TARGET, not in
  // anything at /vs/*.
  { id: 55, path: '/vs/storyboarder', check: 'retired storyboarder lands on the guide',
    expected: 'Best Storyboard Software Tools', source: { kind: 'listicle', path: '/best/storyboard-software' } },
  { id: 56, path: '/vs/boords', check: 'retired boords lands on the guide',
    expected: 'Best Storyboard Software Tools', source: { kind: 'listicle', path: '/best/storyboard-software' } },
  { id: 57, path: '/vs/studiobinder', check: 'retired studiobinder lands on the guide',
    expected: 'Best Storyboard Software Tools', source: { kind: 'listicle', path: '/best/storyboard-software' } },

  // ── The docs corpus links the changelog ───────────────────────────────────
  { id: 70, path: '/docs/canvas/cards', check: 'deep docs pages link the changelog',
    expected: 'href="/changelog"', source: { kind: 'docs', path: '/docs/canvas/cards' } },
];

// Deliberately NOT pinned: their `expected` is live database content, not
// anything in this repo, so no local test can speak for them. Listed so the
// next person can tell "absent from the contract" from "forgotten".
//
// Both assert on `/c/` marketing boards. Editing that board's copy or its
// palette turns the check red, and the repo will have no idea why — which is
// the same failure mode as 60-62, just with no fix available from here.
export const SEO_PROBE_UNPINNABLE = [
  { id: 10, path: '/c/world-cup-2026-moodboard', check: 'board article + faq',
    expected: 'Frequently asked questions', why: 'rendered from a board row in Postgres' },
  { id: 11, path: '/c/neon-noir-look-book', check: 'board swatches crawlable',
    expected: '#00C2D1', why: 'a swatch on a marketing board; editing the palette breaks it' },
];
