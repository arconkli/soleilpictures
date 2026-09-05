# Soleil Clusters — working notes

The React app is `boards/`. The Cloudflare Worker is `boards/src/worker.js`
(deployed as `soleil-boards`). Production is `clusters.soleilpictures.com`.

The interface says **cluster**; the database, the API and most of the code say
**board**. Both words are correct in their own context — don't "fix" one to
match the other.

---

## Public docs MUST be updated with the feature

**If you change a public-facing surface, you change `boards/content/docs/**.md`
in the same commit.** A public-facing surface is:

- a route a signed-out visitor or a crawler can reach
- an `/api/v1` endpoint, field, scope, or error code
- an MCP tool or its input schema
- a card kind, a Settings tab, a keyboard shortcut, a power reveal
- any enforced limit — card caps, file size ceilings, prices, rate limits

This is not a request for good behaviour. It is enforced:

```sh
cd boards && npm test          # includes src/lib/docsite.test.mjs
```

`docsite.test.mjs` extracts the public surface straight out of the source —
the `endpoints:` array in `worker-api.js`, `registerTool(…)` in `mcp/src/`,
`CARD_KINDS`, `TABS`, the router branches in `main.jsx` — hashes it, and diffs
it against `boards/src/lib/docsiteSurface.json`. Change any of them and the test
goes red with a list of exactly what moved.

When it does:

1. Update the relevant page(s) under `boards/content/docs/`.
2. `npm run docs:build` — regenerates the registries, the `.md` mirrors, `llms.txt`.
3. `npm run docs:accept` — re-snapshots the surface.

Running `docs:accept` without doing step 1 defeats the entire mechanism. Don't.

### Numbers are never typed by hand

Limits, prices and caps are injected at build time from the code that enforces
them, via `{{fact:…}}` placeholders resolved in `scripts/gen-docs.mjs`:

```md
The free plan allows {{fact:demoCardLimit}} cards.
```

`FACTS` is sourced from `billingCopy.js`, `demoCardCap.js`, `fileIngest.js` and
regex extraction from `worker-api.js` / the migrations. If you need a new one,
add it to `FACTS` sourced from real code — never as a literal.
`billingCopy.js` already carries the rule that every pricing claim must name the
code enforcing it.

### How the docs are built

`boards/content/docs/**.md` → `scripts/gen-docs.mjs` (a `prebuild` hook) →

| Output | Consumer |
|---|---|
| `src/lib/docsiteIndex.js` | Worker meta, sitemap, React nav, tests |
| `src/lib/docsiteContent.js` | The code-split React page only |
| `src/lib/docsiteCrawlable.js` | The Worker's `<main id="seo-fallback">` injection |
| `public/docs/**.md` | Raw Markdown for AI agents and `curl` |
| `public/llms.txt`, `llms-full.txt` | AI agents |

Generated files are **committed**, so the Cloudflare build never depends on
generation succeeding. `npm run docs:check` asserts regeneration is a no-op —
that is what catches "edited the markdown, forgot to regenerate".

The Worker and React render from the **same** parse. That is the anti-cloaking
parity the whole registry design exists to protect — see the header of
`boards/src/lib/seoLanding.js`, which established the pattern.

---

## Tests

Two tiers, neither wired to CI (there is no CI):

```sh
cd boards
npm test                                  # node --test src/lib/*.test.mjs
npm run test:e2e                          # playwright
npx playwright test tests/x.spec.js --project=desktop-chrome
```

Run `npm test` before committing. It is fast and it is the only thing standing
between a surface change and stale documentation.

---

## Deploying

**Pushing `main` deploys a PREVIEW, not production.** Production is the
`production` branch, promoted by cherry-picking in an isolated worktree.

> **The gotcha that has burned this repo before:** copy `boards/.env.local` into
> the worktree **before** running `vite build`, or the signed-in app is silently
> dead-code-eliminated and you ship a build that only works logged out. Gate on
> `AppShell` being roughly its usual size (~500KB) and grep `dist` for a known
> marker before promoting.

Other deploy targets:

| Thing | How |
|---|---|
| Worker + SPA | Cloudflare Workers Builds, on push |
| PartyKit | `npm run deploy:party` |
| Supabase functions | via MCP — the local CLI is authenticated to the wrong org |
| Scout bot | `fly deploy --config scout/fly.toml --dockerfile scout/Dockerfile .` from the repo root |

After shipping SEO-relevant changes, bump the `build_min` row in
`seo_health_expectations` (see `supabase/functions/seo-health/index.ts`).

### The prober asserts on real strings from this repo

`seo_health_expectations` rows are live production checks, and the `body` ones
assert **exact, case-sensitive substrings** of pages built from
`boards/content/**` and `src/lib/seo*`. Rewrite the prose and the check goes
red six hours later blaming the AI crawlers — which is what happened on
2026-08-26 when a changelog headline moved a phrase mid-sentence.

`boards/src/lib/seoProbeContract.js` mirrors those rows, and
`seoProbeContract.test.mjs` fails the build naming the row to update. If it goes
red, reconcile the row — deleting the contract entry just restores the blind
spot. Expectations stay in the DB (a deploy must never be able to self-certify),
so the contract is checked at test time only and never feeds the prober.

---

## Reading the SEO numbers

Four traps, each of which has already produced a confident wrong answer here.

**1. Two tables, one of them a snapshot.** `seo_page_daily` is the true per-day
Search Console series and is safe to `SUM`. `seo_page_stats` is a **rolling
28-day window keyed by sync date** — summing it multiplies by ~28.

**2. Within `seo_page_daily`, never mix the two row types.** Rows with
`query = ''` are the **page-level total**. Rows with `query <> ''` are Google's
anonymized partial breakdown covering only **~37% of web impressions**. Summing
both together double-counts every page; summing only the query rows undercounts
it by two thirds. Pick one, and say which you used.

```sql
-- page-level truth
select day, clicks, impressions, position from seo_page_daily
 where path = '/vs/pureref' and query = '' and search_type = 'web' order by day;
```

**3. Never quote a CTR that includes `path = '/'`.** The homepage is brand
navigational traffic at ~43% CTR on a few hundred impressions, and it drags any
blended figure it appears in. A "position 4–10 CTR of 3.78%" was really the
homepage contributing 5% of the impressions and 43% of the clicks; content-only
was 2.21%. Segment brand out first, always.

**4. `search_type` is not optional.** `/vs/pureref` alone carried 792 zero-click
*image* impressions in one month. An unfiltered read reports a CTR collapse that
is really an image-search artifact.

### Pre-register a title change or the result is unreadable

Before editing a `title` / `metaDescription` in `seoLanding.js`, write into the
comment block above it: the **target query predicate**, the **evaluation
window**, and an **impression floor (≥200 post-change)**. One surface per
commit. The one title change here with a defensible result is the one whose
comment named its target queries in advance; the ones that changed five things
at once are permanently ungradable. Grade with ±7/±14 day buckets and
impression-weighted position, and **never inside 3 days of a ship** — GSC lags
~3 days and Google restates the trailing ~3.

### Non-human traffic is quarantined, not filtered

`analytics_events` diverts QA-harness rows (`reason='qa_harness'`, 0230) and
crawler rows (`reason='bot_ua'`, 0294) into `analytics_events_synthetic` on
insert, so every reader is clean without knowing to filter. Two consequences:
**crawler rows before 0294 shipped cannot be identified** (the raw user-agent is
never stored), so public-page counts step down at that deploy and any
before/after straddling it is invalid; and if you actually want crawler
behaviour, read the archive or `crawler_hits`, not the live table.

---

## House conventions

- **The repo is public.** No business metrics, revenue figures or user counts in commit messages or committed files.
- **Gold (`--soleil`) is reserved** for active / selection / focus states. Resting icons are neutral ink.
- **Deleting shows an undo toast.** That is the convention; match it.
- **Never `.catch()` a `supabase.rpc()` builder** — it is a thenable, not a promise, and the catch swallows the query.
- `move_boards_under` is the only path that may write `parent_board_id` **as a
  move**. Two repair paths in `0275` also write it, deliberately:
  `_ensure_workspace_root` lifts boards stranded under a deleted parent, and
  `soft_delete_board` re-homes a deleted board's live children onto its own
  parent. Both only touch rows that are already unreachable from `board_tree`,
  which anchors on a live `parent_board_id is null` row — a workspace with no
  live root returns an empty tree, and the app renders a spinner forever on one.
  Every workspace must always have a live root cluster.
- Dev-only QA harnesses (`?docqa=1`, `?gridqa`, …) are guarded by
  `import.meta.env.DEV` so the bundler drops them from production. Keep new ones
  behind the same literal guard.
