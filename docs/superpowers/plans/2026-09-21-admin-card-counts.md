# Admin card counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `/admin` surface report the card count the cap actually enforces, and surface cards on deleted clusters and cards in other people's workspaces as their own figures.

**Architecture:** One internal view, `public._owner_card_counts`, becomes the single set-wise definition of per-user card holdings. Four admin RPCs stop recomputing the count inline and read the view instead. `AdminUserDetail.jsx` splits the old single "Cards" figure into three conditional rows. The now-unread `profiles.demo_card_count` column and its triggers are dropped.

**Tech Stack:** PostgreSQL (Supabase, project `ehlhlmbpwwalmeisvmdp`), React 18 + Vite, `node --test` for the suite.

**Spec:** `docs/superpowers/specs/2026-09-21-admin-card-counts-design.md`

## Global Constraints

- **The repo is public.** No business metrics, revenue figures, user counts, user IDs or email addresses in commit messages or committed files. This includes test fixtures and SQL comments. Verification numbers you observe go in the conversation, never in a file.
- **Migrations are applied through the Supabase MCP** (`mcp__supabase__apply_migration`). The local Supabase CLI is authenticated to the wrong org. Always also write the `.sql` file into `supabase/migrations/` so the file and the database agree.
- **Migration numbers:** 0338, 0339, 0340. Latest existing is 0337.
- **Function/view grants (the 0311 convention):** a `_`-prefixed internal object must `revoke` from `public, anon, authenticated`, and the migration must end with a `do $$ … $$` block that *proves* its own grants. A REVOKE reporting success proves nothing.
- **`create or replace view` resets unstated reloptions.** Always restate `security_invoker` explicitly. This is how `entity_search` silently lost RLS for 23 days.
- **Gold (`--soleil`) is reserved** for active/selection/focus states. Resting figures use neutral ink — the existing `is-strong` / `is-muted` classes.
- **Run `cd boards && npm test` before every commit.** `docsite.test.mjs` must stay green; `/admin` is not a public surface and the admin tab list is a separate `ADMIN_TABS` const the docs gate does not read, so no `boards/content/docs/**` change should be needed. If the docs gate *does* go red, that is a real signal — investigate, do not run `docs:accept`.
- **Work on `main`, commit, and push after each task.** No feature branches. Only stage the files the task names — other work is in progress in this tree (`git diff --cached --name-only` first; never bare `git stash pop`).
- **Never `.catch()` a `supabase.rpc()` builder** — it is a thenable, not a promise, and the catch swallows the query.

---

### Task 1: Source-level guard against the defective predicate

The bug is a `card_index ⋈ boards` aggregate with no `deleted_at` filter. This lint catches the next copy someone writes. It cannot scan history — migrations are immutable, and 0070/0117/0164/0205/0229 all legitimately contain the old text — so it is bounded to migrations numbered 0338 and above.

**Files:**
- Create: `boards/src/lib/cardCountPredicate.test.mjs`

**Interfaces:**
- Produces: nothing other tasks consume. Self-contained test.

- [ ] **Step 1: Write the failing test**

Create `boards/src/lib/cardCountPredicate.test.mjs`:

```js
// A card count that joins card_index to boards without filtering
// boards.deleted_at counts cards on soft-deleted clusters. That is what made
// /admin disagree with the cap (see migration 0339).
//
// Migrations are immutable history, so this only guards files numbered at or
// above the one that fixed it. Raising FIRST_GUARDED is never the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIRST_GUARDED = 338;
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

// Heuristic line-window lint: for every line naming card_index, look at the
// surrounding window. A window that also names boards and aggregates with
// count()/sum() but never says deleted_at is the defect. max()/min() are not
// flagged — "when did they last make something" is an activity question, and
// a card made in a since-deleted cluster still happened.
//
// Because the window is fixed-width it can catch an aggregate belonging to a
// neighbouring clause. A query that genuinely must span deleted clusters
// carries `card-count-lint: activity` in a comment beside it, which suppresses
// the hit and forces whoever writes it to say so out loud.
const SUPPRESS = /card-count-lint:\s*activity/i;

export function findUnfilteredCardCounts(sql, windowLines = 6) {
  const lines = sql.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (!/card_index/i.test(line)) return;
    const win = lines.slice(Math.max(0, i - windowLines), i + windowLines + 1).join('\n');
    if (!/\bboards\b/i.test(win)) return;
    if (!/\b(count|sum)\s*\(/i.test(win)) return;
    if (/deleted_at/i.test(win)) return;
    if (SUPPRESS.test(win)) return;
    hits.push({ line: i + 1, text: line.trim() });
  });
  return hits;
}

test('detector flags an unfiltered card count', () => {
  const bad = `
    select b.created_by as uid,
           count(*)::int as card_count
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  `;
  assert.equal(findUnfilteredCardCounts(bad).length, 1);
});

test('detector accepts a count that filters deleted_at', () => {
  const good = `
    select coalesce(sum(ci.weight), 0)::integer
      from public.card_index ci
      join public.boards b on b.id = ci.board_id
     where b.deleted_at is null
  `;
  assert.deepEqual(findUnfilteredCardCounts(good), []);
});

test('detector ignores non-aggregate uses of card_index', () => {
  const activity = `
    select b.created_by as uid,
           max(ci.updated_at) filter (where ci.card_id not like 'onb-%') as last_card_at
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  `;
  assert.deepEqual(findUnfilteredCardCounts(activity), []);
  assert.deepEqual(findUnfilteredCardCounts('insert into public.card_index (board_id) values ($1)'), []);
});

test('an explicit activity suppression silences the lint', () => {
  const spanning = `
    -- card-count-lint: activity — last_card_at must survive the cluster
    select b.created_by as uid,
           max(ci.updated_at) as last_card_at,
           count(*) as ignore_me
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  `;
  assert.deepEqual(findUnfilteredCardCounts(spanning), []);
  assert.equal(findUnfilteredCardCounts(spanning.replace(/-- card-count-lint.*\n/, '')).length, 1);
});

test('no guarded migration counts cards without filtering deleted clusters', () => {
  const offenders = [];
  for (const name of readdirSync(MIGRATIONS).sort()) {
    if (!name.endsWith('.sql')) continue;
    const num = Number(name.slice(0, 4));
    if (!Number.isFinite(num) || num < FIRST_GUARDED) continue;
    for (const hit of findUnfilteredCardCounts(readFileSync(join(MIGRATIONS, name), 'utf8'))) {
      offenders.push(`${name}:${hit.line}  ${hit.text}`);
    }
  }
  assert.deepEqual(offenders, [], `Card counts missing a boards.deleted_at filter:\n${offenders.join('\n')}`);
});
```

- [ ] **Step 2: Run it and watch the detector tests fail**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && node --test src/lib/cardCountPredicate.test.mjs
```

Expected: the three detector tests fail if `findUnfilteredCardCounts` has a bug; the migration scan passes vacuously (no migration ≥ 0338 exists yet). If all four pass immediately, deliberately break the `bad` fixture by adding `where b.deleted_at is null` and confirm that test flips — you must see the detector actually discriminate before trusting it.

- [ ] **Step 3: Run the full suite**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm test
```

Expected: PASS, including `docsite.test.mjs`.

- [ ] **Step 4: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git diff --cached --name-only   # must be empty before you stage
git add boards/src/lib/cardCountPredicate.test.mjs
git commit -m "$(cat <<'MSG'
A card count that forgets deleted clusters is now a failing test

Lints migrations from 0338 on for a card_index-to-boards aggregate with
no deleted_at filter. History is immutable and legitimately contains the
old shape, so the scan is bounded rather than retroactive.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T1p5QibKaRiDeMgrSZUmnG
MSG
)"
git push origin main
```

---

### Task 2: Migration 0338 — the `_owner_card_counts` view

**Files:**
- Create: `supabase/migrations/0338_owner_card_counts_view.sql`

**Interfaces:**
- Produces: view `public._owner_card_counts(user_id uuid, live_cards int, discarded_cards int, discarded_clusters int, guest_cards int, guest_clusters int, guest_workspaces int)`. Tasks 3 and 4 consume these exact column names. A user with no boards at all has **no row** — every consumer must `left join` and `coalesce(…, 0)`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0338_owner_card_counts_view.sql`:

```sql
-- The admin decks counted cards the cap does not count.
--
-- Since 0333, _owner_card_count(uuid) is THE definition of cards-held:
-- sum(card_index.weight) over LIVE boards in workspaces the user created.
-- The admin RPCs never moved onto it. They each recomputed the count inline,
-- and the inline version diverged three ways at once: it counted soft-deleted
-- clusters, keyed on boards.created_by instead of workspaces.created_by, and
-- counted rows instead of summing weight. An account reading well above its
-- cap in /admin was holding a third of that, and had never once been refused.
--
-- This view is the set-wise form of the same definition, plus the two figures
-- that were being silently folded into the old number:
--   discarded_* — cards stranded on soft-deleted clusters. purge_old_deleted_
--                 boards() hard-deletes at 30 days, so they are recoverable
--                 until then and count against nobody meanwhile.
--   guest_*     — cards in LIVE clusters the user created inside someone
--                 else's workspace. The plan covers the WORKSPACE (owner-keyed
--                 since 0187), so these are charged to that workspace's owner,
--                 not to the user who made the cluster. Shown on the guest's
--                 panel so the asymmetry is visible rather than invisible.
--
-- _owner_card_count(uuid) is deliberately NOT reimplemented on top of this
-- view: it runs inside enforce_demo_card_cap_trg, a BEFORE INSERT trigger, and
-- must not scan a grouped view once per card inserted. That leaves two
-- expressions for "live cards", which is exactly the drift this migration
-- exists to end — so the block at the bottom asserts they agree for every
-- user, and this migration refuses to apply if they ever do not.

create or replace view public._owner_card_counts as
with per_board as (
  select w.created_by as ws_owner,
         b.created_by as board_creator,
         b.id         as board_id,
         b.deleted_at,
         coalesce(sum(ci.weight), 0)::int as cards
    from public.boards b
    join public.workspaces w on w.id = b.workspace_id
    left join public.card_index ci on ci.board_id = b.id
   group by w.created_by, b.created_by, b.id, b.deleted_at
),
owners as (
  select ws_owner as uid,
         coalesce(sum(cards) filter (where deleted_at is null), 0)::int     as live_cards,
         coalesce(sum(cards) filter (where deleted_at is not null), 0)::int as discarded_cards,
         -- Deleted clusters that actually held something. An empty cluster the
         -- user made and threw away is not part of "where did the cards go".
         count(*) filter (where deleted_at is not null and cards > 0)::int   as discarded_clusters
    from per_board
   where ws_owner is not null
   group by ws_owner
),
guests as (
  select board_creator as uid,
         coalesce(sum(cards), 0)::int      as guest_cards,
         count(*)::int                     as guest_clusters,
         count(distinct ws_owner)::int     as guest_workspaces
    from per_board
   where board_creator is not null
     and board_creator is distinct from ws_owner
     and deleted_at is null
   group by board_creator
)
select coalesce(o.uid, g.uid)              as user_id,
       coalesce(o.live_cards, 0)           as live_cards,
       coalesce(o.discarded_cards, 0)      as discarded_cards,
       coalesce(o.discarded_clusters, 0)   as discarded_clusters,
       coalesce(g.guest_cards, 0)          as guest_cards,
       coalesce(g.guest_clusters, 0)       as guest_clusters,
       coalesce(g.guest_workspaces, 0)     as guest_workspaces
  from owners o
  full outer join guests g on g.uid = o.uid;

-- Runs as owner, NOT as the caller. Stated explicitly because create or
-- replace view resets unstated reloptions, and because every consumer is a
-- SECURITY DEFINER admin RPC already gated on _require_admin() — the same
-- posture those RPCs have when they query these tables directly today. The
-- view is never client-readable; the grants below are what enforces that.
alter view public._owner_card_counts set (security_invoker = false);

comment on view public._owner_card_counts is
  'Per-user card holdings, set-wise. live_cards is identical to '
  '_owner_card_count(uuid) and the two are asserted equal at migration time. '
  'Internal: admin RPCs only, never client-readable.';

revoke all on public._owner_card_counts from public;
revoke all on public._owner_card_counts from anon;
revoke all on public._owner_card_counts from authenticated;

-- Prove the grants rather than trusting the REVOKEs, and prove the view agrees
-- with the cap. Either failure aborts the migration.
do $$
declare
  v_leak text;
  v_bad  integer;
begin
  select string_agg(r, ', ') into v_leak
    from unnest(array['public', 'anon', 'authenticated']) r
   where has_table_privilege(r, 'public._owner_card_counts', 'SELECT');
  if v_leak is not null then
    raise exception '_owner_card_counts is SELECT-able by: %', v_leak;
  end if;

  select count(*) into v_bad
    from public._owner_card_counts c
   where c.live_cards is distinct from public._owner_card_count(c.user_id);
  if v_bad > 0 then
    raise exception
      '_owner_card_counts.live_cards disagrees with _owner_card_count() on % row(s)', v_bad;
  end if;
end $$;
```

- [ ] **Step 2: Apply it**

Use `mcp__supabase__apply_migration` with `project_id: "ehlhlmbpwwalmeisvmdp"`, `name: "0338_owner_card_counts_view"`, and the file's contents as `query`.

Expected: success. A failure naming `disagrees with _owner_card_count()` means the view's `live_cards` is wrong — fix the view, not the assertion.

- [ ] **Step 3: Verify the view against the cap independently**

```sql
select count(*) as rows_disagreeing
from public._owner_card_counts c
where c.live_cards is distinct from public._owner_card_count(c.user_id);
```

Expected: `0`.

Then spot-check that the new columns are populated and that guests are non-empty:

```sql
select count(*) filter (where discarded_cards > 0) as with_discarded,
       count(*) filter (where guest_cards > 0)     as with_guest_work
from public._owner_card_counts;
```

Expected: both non-zero. Report the numbers in conversation only — they do not go in any file.

- [ ] **Step 4: Run the suite**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm test
```

Expected: PASS. Task 1's migration scan now covers 0338 — the view's `per_board` CTE names `card_index`, `boards` and `sum(`, and its window contains `b.deleted_at` in the select list, so it does not trip the lint.

If it *does* trip, work out which of two things you are looking at. If the flagged query really is missing a `deleted_at` filter, that is the lint doing its job — fix the query. If it genuinely must span deleted clusters, add a `-- card-count-lint: activity` comment beside it explaining why. Never raise `FIRST_GUARDED` and never delete the assertion.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git diff --cached --name-only
git add supabase/migrations/0338_owner_card_counts_view.sql
git commit -m "$(cat <<'MSG'
One definition of what a user's cards are

_owner_card_counts is the set-wise form of _owner_card_count: live cards
keyed on the workspace owner, summing weight, live clusters only. It also
carries the two figures the admin number was silently folding in — cards
stranded on soft-deleted clusters, and cards in clusters the user made
inside someone else's workspace.

The cap trigger keeps its scalar function; a BEFORE INSERT trigger cannot
scan a grouped view per card. The migration asserts the two agree for
every user and refuses to apply if they do not.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T1p5QibKaRiDeMgrSZUmnG
MSG
)"
git push origin main
```

---

### Task 3: Migration 0339 — move the four admin RPCs onto the view

**Files:**
- Create: `supabase/migrations/0339_admin_card_counts_read_the_view.sql`

**Interfaces:**
- Consumes: `public._owner_card_counts` from Task 2.
- Produces: `admin_user_detail`'s `engagement` object gains `discarded_cards`, `discarded_clusters`, `guest_cards`, `guest_clusters`, `guest_workspaces` (all int, always present, 0 when absent) and **loses** `demo_card_count`. `card_count` keeps its name and becomes live-only. Task 4 consumes these names.

**How to write this migration.** These are large functions and the migration must contain each one's complete `create or replace`. Do not retype them. For each function, fetch the current definition verbatim:

```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_list_users','admin_user_count','admin_top_users',
                    'admin_tier_usage_compare','admin_user_detail');
```

Paste each into the migration file unchanged, then apply **only** the edits below. Keep every other line — parameter lists, filters, ordering, the `_require_admin()` call — byte-identical.

- [ ] **Step 1: Edit `admin_list_users`**

Replace the `owner_cards` CTE (currently body lines 16–22) with two CTEs. `owner_cards` keeps **only** `last_card_at`, still computed across all clusters including deleted ones:

```sql
  with owner_cards as (
    -- card-count-lint: activity
    -- Activity, not holdings: "last made something" stays true even if the
    -- cluster it happened in has since been deleted. Deliberately unfiltered.
    select b.created_by as uid,
           max(ci.updated_at) filter (where ci.card_id not like 'onb-%') as last_card_at
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  ),
  owner_counts as (
    select c.user_id as uid, c.live_cards from public._owner_card_counts c
  ),
```

Then, in the `base` select, replace:

```sql
      coalesce(oc.card_count, 0)::int as card_count,
```

with:

```sql
      coalesce(occ.live_cards, 0)::int as card_count,
```

and add a join next to the existing `left join owner_cards oc on oc.uid = u.id`:

```sql
    left join owner_counts occ on occ.uid = u.id
```

Leave `owner_boards`, the `'active'` / `'inactive'` cases, and the `'cards'` sort key untouched — they read `base.card_count`, which is now the live figure.

- [ ] **Step 2: Edit `admin_user_count`**

Replace the two `card_index` `exists` subqueries (body lines 30 and 33) so the activity filter matches the list. Line 30's:

```sql
                   exists (select 1 from public.card_index ci join public.boards b on b.id = ci.board_id where b.created_by = u.id)
```

becomes:

```sql
                   exists (select 1 from public._owner_card_counts c where c.user_id = u.id and c.live_cards > 0)
```

and line 33's `not exists (…)` becomes the same subquery with `not exists`. Leave the `boards` half of each condition alone — it already filters `deleted_at is null`.

- [ ] **Step 3: Edit `admin_top_users`**

Replace the `stats` lateral (body lines 18–24) with:

```sql
  left join lateral (
    select
      (select count(*) from public.boards b
        where b.created_by = u.id and b.deleted_at is null) as board_count,
      (select coalesce(c.live_cards, 0) from public._owner_card_counts c
        where c.user_id = u.id) as card_count
  ) stats on true
```

Note this also adds the `deleted_at is null` filter the board count was missing — the same defect, one line over. The spec's blast-radius table named only the card count; fixing the board count alongside it is a deliberate small extension, called out here so it is not a surprise in review.

- [ ] **Step 4: Edit `admin_tier_usage_compare`**

Replace body lines 11–14 with:

```sql
      coalesce((select count(*) from public.boards b
                 where b.created_by = u.id and b.deleted_at is null), 0)::bigint as board_count,
      coalesce((select c.live_cards from public._owner_card_counts c
                 where c.user_id = u.id), 0)::bigint as card_count
```

`avg_cards` / `total_cards` / `avg_boards` / `total_boards` downstream need no change. Expect the per-tier figures to move downward when this ships — they were biased upward, and unevenly.

- [ ] **Step 5: Edit `admin_user_detail`**

In the `engagement` object, replace:

```sql
      'card_count',      coalesce(oc.card_count, 0),
```

with:

```sql
      'card_count',         coalesce(occ.live_cards, 0),
      'discarded_cards',    coalesce(occ.discarded_cards, 0),
      'discarded_clusters', coalesce(occ.discarded_clusters, 0),
      'guest_cards',        coalesce(occ.guest_cards, 0),
      'guest_clusters',     coalesce(occ.guest_clusters, 0),
      'guest_workspaces',   coalesce(occ.guest_workspaces, 0),
```

Delete this line entirely — it is the stale counter, and Task 5 drops the column it reads:

```sql
      'demo_card_count', coalesce(p.demo_card_count, 0),
```

Replace the `oc` lateral join:

```sql
  left join lateral (
    select count(*)::int as card_count
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
    where b.created_by = u.id
  ) oc on true
```

with a plain join to the view:

```sql
  left join public._owner_card_counts occ on occ.user_id = u.id
```

Leave `demo_card_cap`, `card_cap_base`, `bonus_card_credits` and `effective_card_limit` exactly as they are — the panel still shows the cap.

- [ ] **Step 6: Add the migration header and apply**

Head the file with:

```sql
-- Four admin RPCs recomputed cards-held inline instead of calling the 0333
-- definition, and every copy diverged the same three ways: soft-deleted
-- clusters counted, keyed on boards.created_by rather than the workspace
-- owner, counting rows rather than summing weight. They now read
-- _owner_card_counts (0338), so /admin and the cap can no longer disagree.
--
-- admin_user_detail additionally stops reading profiles.demo_card_count — a
-- counter that only moves while tier = 'demo' and that the 30-day purge never
-- decrements — and gains the discarded_* and guest_* figures instead. 0340
-- drops that column.
```

Apply via `mcp__supabase__apply_migration`, `name: "0339_admin_card_counts_read_the_view"`.

- [ ] **Step 7: Verify each RPC against the cap**

The signature is `admin_list_users(p_limit int, p_offset int, p_query text, p_tier text, p_sort text, p_status text, p_source text, p_contacted text, p_verification text, p_activity text)` — ten arguments:

```sql
select count(*) as list_rows_disagreeing
from public.admin_list_users(2000, 0, null, null, null, null, null, null, null, null) l
join public._owner_card_counts c on c.user_id = l.user_id
where l.card_count is distinct from c.live_cards;
```

Expected: `0`. (This RPC calls `_require_admin()`, so run it as a role that passes that check.)

Then confirm the detail payload shape on any user:

```sql
select jsonb_pretty(public.admin_user_detail('<any user_id>') -> 'engagement');
```

Expected: `card_count` equals that user's `live_cards`; the five new keys are present; `demo_card_count` is **absent**.

- [ ] **Step 8: Run the suite and commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm test
cd /Users/andrewconklin/soleilpictures-1
git diff --cached --name-only
git add supabase/migrations/0339_admin_card_counts_read_the_view.sql
git commit -m "$(cat <<'MSG'
/admin and the cap now answer the same question

The four admin RPCs read _owner_card_counts instead of recomputing the
count inline. admin_user_detail drops the stale profiles counter and
gains cards-on-deleted-clusters and cards-in-other-workspaces as their
own figures. Two board counts that were also missing a deleted_at filter
are fixed alongside.

Per-tier avg/total card figures will step down: they were biased upward
by cards on deleted clusters, and biased unevenly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T1p5QibKaRiDeMgrSZUmnG
MSG
)"
git push origin main
```

---

### Task 4: The admin panel rows

**Files:**
- Modify: `boards/src/pages/admin/AdminUserDetail.jsx` (the `EngagementSection` rows, currently lines 133–157)
- Modify: `boards/src/pages/admin/AdminUserList.jsx:59` (the `usageTitle` tooltip)

**Interfaces:**
- Consumes: `engagement.card_count`, `.discarded_cards`, `.discarded_clusters`, `.guest_cards`, `.guest_clusters`, `.guest_workspaces` from Task 3.

- [ ] **Step 1: Replace the Cards / Boards / Demo cards rows**

In `AdminUserDetail.jsx`, replace everything from the `<Row label="Cards">` line through the closing `)}` of the `{tier === 'demo' && (` block (lines 133–157) with:

```jsx
        {/* One card number, and it is the one the cap enforces:
            _owner_card_counts.live_cards. The row that used to sit below this
            read profiles.demo_card_count, a counter the 30-day purge never
            decremented — it could print a number above the cap for an account
            that had never once been refused a card. */}
        <Row label="Cards">
          <span className="is-strong">{formatCount(eng.card_count)}</span>
          {tier === 'demo' && (
            <>
              <span className="is-muted"> / {eng.effective_card_limit || eng.demo_card_cap || DEMO_CARD_LIMIT}</span>
              {eng.bonus_card_credits > 0 && (
                <span className="is-muted" style={{ marginLeft: 6 }}>(+{formatCount(eng.bonus_card_credits)} from referrals)</span>
              )}
              {/* Which cap cohort this account is in. Accounts predating migration
                  0229 keep the base cap they signed up under, so a support answer
                  about "why can they add more than I can" is one glance away. */}
              {eng.card_cap_base > DEMO_CARD_LIMIT && (
                <span className="is-muted" style={{ marginLeft: 6 }}>(grandfathered at {eng.card_cap_base})</span>
              )}
            </>
          )}
        </Row>
        <Row label="Boards">{formatCount(eng.board_count)}</Row>
        {/* Cards on soft-deleted clusters. They count against nobody's cap and
            purge_old_deleted_boards() hard-deletes them at 30 days. Hidden at
            zero, which is most accounts. */}
        {eng.discarded_cards > 0 && (
          <Row label="Discarded">
            {formatCount(eng.discarded_cards)} in {formatCount(eng.discarded_clusters)}
            {eng.discarded_clusters === 1 ? ' deleted cluster' : ' deleted clusters'}
            <span className="is-muted" style={{ marginLeft: 6 }}>· restorable for 30 days</span>
          </Row>
        )}
        {/* Cards in clusters this person made inside someone else's workspace.
            The plan covers the workspace (owner-keyed since 0187), so these are
            charged to that owner's cap, not this account's. */}
        {eng.guest_cards > 0 && (
          <Row label="Guest work">
            {formatCount(eng.guest_cards)} cards in {formatCount(eng.guest_clusters)}
            {eng.guest_clusters === 1 ? ' cluster in ' : ' clusters in '}
            {formatCount(eng.guest_workspaces)}
            {eng.guest_workspaces === 1 ? ' other workspace' : ' other workspaces'}
            <span className="is-muted" style={{ marginLeft: 6 }}>{"· counts against those owners' caps"}</span>
          </Row>
        )}
```

The apostrophe in `owners' caps` is written as a JSX string expression, not bare text, so `react/no-unescaped-entities` does not fire.

- [ ] **Step 2: Fix the list tooltip**

In `AdminUserList.jsx`, the card column is now live-only. Change line 59 from:

```js
  const usageTitle = paid ? 'Storage used' : 'Cards created';
```

to:

```js
  const usageTitle = paid ? 'Storage used' : 'Cards held now (what the cap counts)';
```

`AdminTopUsersList.jsx` needs no change — its `card_count` came from the RPC and is now live.

- [ ] **Step 3: Verify it builds and lints**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npx vite build 2>&1 | tail -20
```

Expected: build succeeds. Confirm `AppShell` is roughly its usual size (~500KB) — a much smaller figure means the signed-in app was dead-code-eliminated.

- [ ] **Step 4: Look at it in the running app**

Start the app, open `/admin`, and open a user who has discarded cards (find one with the Task 2 Step 3 query, then open that user's detail page). Confirm: one "Cards" row showing the live figure over the cap, a "Discarded" row, and no "Demo cards" row. Open a user with neither and confirm the section shows only Cards and Boards.

- [ ] **Step 5: Run the suite and commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm test
cd /Users/andrewconklin/soleilpictures-1
git diff --cached --name-only
git add boards/src/pages/admin/AdminUserDetail.jsx boards/src/pages/admin/AdminUserList.jsx
git commit -m "$(cat <<'MSG'
The panel stops showing two card numbers and disagreeing with itself

Cards is now the figure the cap enforces. Cards stranded on deleted
clusters and cards placed in other people's workspaces get their own
rows, shown only when non-zero.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T1p5QibKaRiDeMgrSZUmnG
MSG
)"
git push origin main
```

---

### Task 5: Migration 0340 — drop the counter

Only after Tasks 3 and 4 are live. The column now has no readers: verified across `pg_proc` (only `bump_demo_card_count_trg` writes it; `get_my_tier`'s identically-named **output** column is `_owner_card_count(u.id)` and is unaffected), `pg_views`, `pg_policies`, `pg_constraint`, all of `boards/src`, `supabase/functions/` and `scout/`. The one grep hit in `create-checkout-session/index.ts` reads `get_my_tier()`'s output column, not the table column.

**Files:**
- Create: `supabase/migrations/0340_drop_demo_card_count.sql`

- [ ] **Step 1: Re-verify there are no readers, immediately before dropping**

```sql
select p.oid::regprocedure::text as fn
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ilike '%demo_card_count%';
```

Expected: exactly `bump_demo_card_count_trg()` and `get_my_tier()`. If `admin_user_detail` still appears, Task 3 did not land — stop.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0340_drop_demo_card_count.sql`:

```sql
-- profiles.demo_card_count was a cache of a number nothing now reads.
--
-- It was never a lifetime total and could not be made into one: it moved only
-- while tier = 'demo', it decremented on card_index row DELETE, and
-- purge_old_deleted_boards()'s cascade never decremented it at all — so once a
-- deleted cluster aged out at 30 days its cards were overstated permanently.
-- 0339 moved its last reader (admin_user_detail) onto _owner_card_counts.
--
-- get_my_tier() returns an output column of the same name whose VALUE is
-- _owner_card_count(u.id). That is the authoritative number, it is what every
-- client and create-checkout-session reads, and it is untouched here.
--
-- Dropping the triggers also removes an UPDATE on public.profiles from every
-- single card insert: a bulk drop of n cards took n sequential row locks on
-- one profile row, on the same statement as the cap check.

drop trigger if exists card_index_demo_count_ins on public.card_index;
drop trigger if exists card_index_demo_count_del on public.card_index;
drop function if exists public.bump_demo_card_count_trg();
alter table public.profiles drop column if exists demo_card_count;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'demo_card_count'
  ) then
    raise exception 'profiles.demo_card_count still exists';
  end if;
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.card_index'::regclass
       and not tgisinternal
       and tgname in ('card_index_demo_count_ins', 'card_index_demo_count_del')
  ) then
    raise exception 'the demo card counter triggers still exist';
  end if;
  -- The cap trigger must survive. Dropping it would make the cap decorative.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.card_index'::regclass
       and not tgisinternal
       and tgname = 'card_index_demo_cap_ins'
  ) then
    raise exception 'card_index_demo_cap_ins is missing — the cap is unenforced';
  end if;
end $$;
```

- [ ] **Step 3: Apply and verify the cap still fires**

Apply via `mcp__supabase__apply_migration`, `name: "0340_drop_demo_card_count"`.

Then confirm `get_my_tier` still resolves for a real signed-in session (it selects from `profiles` and must not reference the dropped column):

```sql
select pg_get_functiondef('public.get_my_tier()'::regprocedure) ilike '%p.demo_card_count%' as still_references_column;
```

Expected: `false`.

- [ ] **Step 4: Verify a card can still be created**

In the running app, sign in and add a card to a cluster. Expected: it saves, and the cards-used figure in the app still moves. This is the check that the dropped trigger was not load-bearing.

- [ ] **Step 5: Run the suite and commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm test
cd /Users/andrewconklin/soleilpictures-1
git diff --cached --name-only
git add supabase/migrations/0340_drop_demo_card_count.sql
git commit -m "$(cat <<'MSG'
Delete the counter that could not be right

profiles.demo_card_count moved only while tier = 'demo' and the 30-day
purge never decremented it, so an overstatement became permanent. 0339
moved its last reader off it. Dropping the triggers also stops an UPDATE
on profiles running once per card inserted.

get_my_tier()'s output column of the same name is _owner_card_count()
and is unaffected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T1p5QibKaRiDeMgrSZUmnG
MSG
)"
git push origin main
```

---

## Not in this plan

Three cap-integrity defects found in the same investigation, each its own work:

1. **The cap is advisory.** `card_index` is maintained only by the browser; `board_state` has no trigger deriving it. `boardsApi.js:1401` swallows every non-cap upsert failure with a `console.warn`, no withdrawal, and retries the identical oversized batch forever. Live boards exist whose cards have never cost any cap.
2. **`update card_index set board_id` skips the cap** — the trigger is `BEFORE INSERT OR UPDATE OF weight`, and `authenticated` holds a column grant on `board_id`.
3. **`syncCardIndex`'s trailing 10s flush writes into deleted clusters** — `deleteBoard` never clears the timer and `_doSyncCardIndex` resolves (and caches) a board's workspace with no `deleted_at` filter. This is the origin of most of the `Discarded` population this plan now surfaces, so fixing it will shrink that row to genuine user deletions.

Also open: `card_index.weight` has no `CHECK (weight > 0)`, and `restore_board`'s 0333 cap check can be sidestepped by setting `boards.deleted_at = null` directly under the members update policy.
