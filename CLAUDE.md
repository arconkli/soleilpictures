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

Two tiers. The first runs in CI (`.github/workflows/test.yml`: `npm test` and `docs:check` on every push to main/production and every PR); Playwright does not:

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
| Party Worker (live sync, uploads, share bundles; PartyKit until Oct 2026) | `cd boards && npm run deploy:party` (wrangler 4, `party/wrangler.jsonc`) |
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

## Subagents: Opus and Fable decide, Sonnet executes

A subagent spawned without a `model` or `effort` runs on the main session's
model at the main session's effort, so an agent that only runs `npm test` from
a Fable session at `/effort max` spends Fable-at-max tokens doing it. Sonnet is
half Opus's list price per token and a fifth of Fable's. Route by one test:
**if the prompt fully determines the result, it's Sonnet work; if the agent has
to decide something, it stays on the main model.**

**Effort: the main session runs at `max`, every subagent at `medium`** —
planning agents on Opus included. Pass `effort: "medium"` on every spawn that
doesn't already pin it; an omitted effort inherits `max`.

| Work | Model | Spawn |
|---|---|---|
| Planning, architecture, root-causing a bug, migration / RLS / grant reasoning, deciding whether a finding is real or a fix is right, synthesis | Main (Opus or Fable) | `Plan` / `general-purpose`, no `model`, `effort: "medium"` |
| A step whose plan already names the files, the change and the check | Sonnet | `implementer` |
| Running `npm test`, `docs:check`, a build or a Playwright spec; a grep; a read-only query; confirming a claim at a file:line | Sonnet | `verifier` |
| Read-only research — mapping code, pulling data, web search — and other Sonnet work that fits neither role | Sonnet | `Explore` / `general-purpose` with `model: "sonnet"`, `effort: "medium"` |

- `implementer` and `verifier` live in `~/.claude/agents/` and pin
  `model: sonnet` and `effort: medium`, so choosing the role sets both.
  `verifier` can't edit files.
- **A fork can't be downgraded.** It runs on the main model at the main effort
  and ignores both, so fork only when the work needs this conversation's
  context. Sonnet work goes to a fresh `implementer` / `verifier` with a
  self-contained prompt.
- **Workflows:** every `agent()` passes `effort: 'medium'`. Research, implement
  and verify stages also pass `model: 'sonnet'`, plus `agentType: 'implementer'`
  / `'verifier'` where one fits: a research agent gathers what the code, the data
  or the web says, and the main session does the deciding. Bug-finders,
  refuters, judges and synthesis keep the default model.
- A Sonnet agent that hits a failure or an open question reports it and stops.
  The diagnosis and the decision come back to the main session; no Sonnet retry
  loops.
- `Explore` and `Plan` don't load this file. A plan delegated to `Plan` has
  never heard of the docs gate or the 0311 grant habit, so name the rules it has
  to honour in its prompt.
- **Never set `CLAUDE_CODE_EFFORT_LEVEL`.** It outranks the agents'
  `effort: medium` frontmatter, so they'd run at `max`. Settings can't hold
  `max`, so the main session gets it from `alias claude='claude --effort max'`
  in `~/.zshrc`, or `/effort max`.
- Don't reach for `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` either: it moves every
  `general-purpose` agent onto Sonnet, judgment work included, without anyone
  choosing it.

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
  move**. Repair paths also write it, deliberately: `_ensure_workspace_root`
  (0275) lifts boards stranded under a deleted parent; `soft_delete_board`
  re-homes a deleted *workspace root's* children (0275 — any other delete
  trashes the whole subtree as one batch since 0396); `restore_board` brings a
  board back under its nearest live ancestor when its parent is still trashed,
  and the `boards_rehome_live_children` trigger lifts live children before a
  trashed board is hard-deleted (both 0396). All of them only touch rows that
  are already unreachable from `board_tree`, which anchors on a live
  `parent_board_id is null` row — a workspace with no live root returns an
  empty tree, and the app renders a spinner forever on one. The
  `boards_parent_must_be_live` trigger refuses any write that would park a
  board under a trashed parent. Every workspace must always have a live root
  cluster.
- Dev-only QA harnesses (`?docqa=1`, `?gridqa`, …) are guarded by
  `import.meta.env.DEV` so the bundler drops them from production. Keep new ones
  behind the same literal guard.
- **Function grants since 0311:** a new function is born with EXECUTE for
  `authenticated` and `service_role` only. A `_`-prefixed internal helper must
  `revoke execute … from public, anon, authenticated`; an RPC meant for
  signed-out callers needs an explicit `grant … to anon`; every migration that
  creates functions ends with a `do $$ … has_function_privilege … $$` block
  that proves its own grants (the 0311 habit — a REVOKE reporting success
  proves nothing).
