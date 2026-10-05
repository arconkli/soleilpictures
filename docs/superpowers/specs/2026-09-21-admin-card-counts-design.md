# Admin card counts — separate live, discarded and guest cards

**Date:** 2026-09-21
**Status:** approved, not yet implemented
**Migration:** 0338

The admin decks report a card count the cap does not recognise. An account whose
`/admin` row read well above its cap turned out to be holding far fewer cards
than the cap counts, and to have never once been refused a card. The number was
wrong, not the account.

This spec makes every admin surface report the same number the cap enforces, and
adds the two figures that were being silently folded into it: cards stranded on
deleted clusters, and cards in clusters the user created inside someone else's
workspace.

---

## The defect

Since 0333, `public._owner_card_count(uuid)` is the single definition of
cards-held: it is what `get_my_tier`, `enforce_demo_card_cap_trg`,
`get_board_capacity`, `scout_board_capacity`, `admin_paid_reach` and
`_live_card_counts` all call. The admin RPCs were never moved onto it. They each
recompute the count inline, and the inline version diverges three ways at once:

| | admin RPCs | `_owner_card_count` (the cap) |
|---|---|---|
| Soft-deleted clusters | **included** | excluded (`b.deleted_at is null`) |
| Keyed on | `boards.created_by` | `workspaces.created_by` |
| Measure | `count(*)` | `sum(ci.weight)` |

The workspace-owner key is the one that matters for money — the plan covers the
**workspace** (owner-keyed since 0187), so a card in a cluster a guest created
inside someone else's workspace is charged to the owner, not the guest. The
admin RPCs bill it to the guest.

The clearest evidence that the missing `deleted_at` filter is an oversight and
not a deliberate lifetime metric: in `admin_list_users`, the `owner_cards` CTE
sits immediately above `owner_boards`, and `owner_boards` **does** filter
`b.deleted_at is null`. Same function, same shape, one filtered and one not.

### Blast radius

| Surface | What it feeds | Consequence of the inflated count |
|---|---|---|
| `admin_user_detail` | `AdminUserDetail.jsx:133` "Cards" | Overstated |
| `admin_user_detail` | `AdminUserDetail.jsx:144` "Demo cards _n_ / cap" | Reads the stale counter — can print a number above the cap |
| `admin_list_users` | `AdminUserList.jsx:58` card column | Overstated |
| `admin_list_users` | `'cards'` sort key | Inflates a user's rank |
| `admin_list_users` | `active` / `inactive` filter | A dormant account whose clusters are all deleted still classifies as active |
| `admin_user_count` | filter counts | Same predicate, same skew |
| `admin_top_users` | `AdminTopUsersList.jsx:34` leaderboard | Overstated rank |
| `admin_tier_usage_compare` | `avg_cards`, `total_cards` per tier | Biased upward and **unevenly** — a user who deletes and rebuilds is overstated, one who never deletes is not, so the per-tier comparison is not merely shifted but distorted |

`admin_tier_usage_compare`'s `board_count` is worse still: `count(*) from boards
where created_by = u.id` with no deleted filter at all, inconsistent even with
`admin_list_users`' own board count.

### Why `profiles.demo_card_count` cannot be "total cards placed"

The second admin row reads the raw counter maintained by
`bump_demo_card_count_trg`. It is not a lifetime total and cannot be made into
one:

- it increments **only while `tier = 'demo'`** — every card placed during a trial
  or a paid period is invisible to it, and it never catches up on return;
- it decrements on `card_index` row DELETE, so it is not "ever placed" either;
- `purge_old_deleted_boards` hard-deletes boards 30 days after soft deletion,
  and that cascade **never decrements the counter** — the overstatement becomes
  permanent and unrecoverable at that point;
- it is keyed on `boards.created_by`, a third key, agreeing with neither the cap
  nor a lifetime reading;
- `greatest(0, …)` clamping discards information on the way down.

A genuine lifetime figure has to be derived from `card_index`, and even then it
is a **floor**: `syncCardIndex` flushes on a 10-second trailing timer, so a card
created and removed inside that window never produces a row to count.

---

## Design

### 1. One internal view

`public._owner_card_counts` — one row per user, computed set-wise:

| Column | Definition |
|---|---|
| `user_id` | |
| `live_cards` | `sum(weight)` over live boards in workspaces they created — identical to `_owner_card_count` |
| `discarded_cards` | same, over soft-deleted boards |
| `discarded_clusters` | count of soft-deleted boards holding at least one card |
| `guest_cards` | `sum(weight)` over live boards where `boards.created_by` = them and `workspaces.created_by` ≠ them |
| `guest_clusters` | count of those boards |
| `guest_workspaces` | count of distinct foreign workspaces involved |

Set-wise rather than a scalar function because `admin_list_users` renders a full
page of users and must not call a per-row function.

**Grants.** Internal, `_`-prefixed, read only by the `SECURITY DEFINER` admin
RPCs, which already gate on `_require_admin()`. `revoke all … from public, anon,
authenticated`. Per the 0311 convention the migration ends with a
`do $$ … has_table_privilege … $$` block that proves its own grants — a REVOKE
reporting success proves nothing.

**`security_invoker`.** State it explicitly. `create or replace view` resets
unstated reloptions, which is how `entity_search` silently lost RLS for 23 days
(see the 2026-09-07 production-readiness audit). The view is never client-
readable, so it runs as owner deliberately, and that decision is written down in
the view comment rather than left to a default.

### 2. `_owner_card_count` stays as it is

It sits on `enforce_demo_card_cap_trg`, a `BEFORE INSERT` trigger, and must not
scan a grouped view once per card inserted.

That leaves two definitions of "live cards", which is the drift this whole spec
exists to fix. The migration therefore **asserts they agree**, for every user
holding any cards, and refuses to apply if a single row disagrees:

```sql
do $$
declare v_bad integer;
begin
  select count(*) into v_bad
    from public._owner_card_counts c
   where c.live_cards is distinct from public._owner_card_count(c.user_id);
  if v_bad > 0 then
    raise exception '_owner_card_counts.live_cards disagrees with _owner_card_count on % row(s)', v_bad;
  end if;
end $$;
```

### 3. RPC changes

All four read the view. `admin_user_detail`'s `engagement` object gains
`discarded_cards`, `discarded_clusters`, `guest_cards`, `guest_clusters`,
`guest_workspaces`; `card_count` becomes `live_cards`; `demo_card_count` is
**removed from the payload**.

`admin_list_users`, `admin_user_count`, `admin_top_users` and
`admin_tier_usage_compare` swap their inline CTEs for the view's `live_cards`.
`admin_tier_usage_compare`'s `board_count` gains the `deleted_at is null` filter
it is missing.

### 4. The panel

`AdminUserDetail.jsx` — the "Demo cards" row is deleted; "Cards" absorbs the cap
and becomes the cap-counted number. The two new rows render only when non-zero,
which for most accounts means the section gets shorter, not longer:

```
Cards          <live> / <cap>
Discarded      <n> in <m> deleted clusters · restorable for 30 days
Guest work     <n> cards in <m> clusters in <k> other workspaces
                                  · counts against those owners' caps
```

The grandfathered-cap note and the referral-bonus note move onto the `Cards` row
unchanged. Resting figures stay neutral ink — gold (`--soleil`) is reserved for
active / selection / focus states.

The 30-day figure is `purge_old_deleted_boards`' interval. It is stated once, in
the component, sourced from that function.

### 5. Retire the dead counter

After (3), `profiles.demo_card_count` has no readers. Verified across `pg_proc`,
`pg_views`, `pg_matviews`, `pg_policies`, `pg_constraint` and all of `boards/src`:
the only live reader is `admin_user_detail`, the only writer is
`bump_demo_card_count_trg`, and `get_my_tier`'s identically-named **output**
column is `_owner_card_count(u.id)` — the authoritative value, unaffected by
anything here.

Drop both `card_index_demo_count_ins` / `card_index_demo_count_del` triggers, the
`bump_demo_card_count_trg` function, and the column.

This also removes an `update public.profiles` executed on **every card insert**.
Today a bulk drop of _n_ cards takes _n_ sequential row locks on one profile row,
on the same statement as the cap check.

---

## Testing

`npm test` (`node --test src/lib/*.test.mjs`) has no database, so the definitional
guarantee is proved in the migration (§2) rather than in the suite.

The suite gets a source-level guard instead: a test that scans
`supabase/migrations/**` for a `card_index` join to `boards` that counts without
a `deleted_at` predicate, and fails naming the migration. That is the mechanism
that would have caught this one, and it catches the next copy someone writes.

No public surface changes — `/admin` is not a route a signed-out visitor can
reach, and the admin tab list is a separate `ADMIN_TABS` const that the docs gate
does not read. `boards/content/docs/**` is untouched and `docsite.test.mjs`
should stay green; if it does not, that is a real signal, not a snapshot to
accept.

---

## Explicitly out of scope

Three defects found during the same investigation. Each is independent of this
one and none is a reporting bug — they are all cap-integrity bugs, and this spec
deliberately does not touch them:

1. **The cap is advisory.** `card_index` is maintained only by the browser
   (`boardsApi.js` `syncCardIndex`); `board_state` carries no trigger that
   derives it. A card can exist in the Y.Doc, render, and never be counted.
   `boardsApi.js:1401` swallows every non-cap upsert failure with a
   `console.warn` and no withdrawal, and re-attempts the identical oversized
   batch on the next sync. Live boards exist today whose cards have never cost
   any cap.
2. **`update card_index set board_id` skips the cap.** The trigger is
   `BEFORE INSERT OR UPDATE **OF weight**`, and `authenticated` holds a column
   grant on `board_id`.
3. **`syncCardIndex`'s trailing flush writes into deleted clusters.**
   `deleteBoard` never clears the pending 10-second timer and `_doSyncCardIndex`
   resolves a board's workspace without a `deleted_at` filter (and caches it), so
   rows land on a cluster the user already deleted. This is the origin of most
   of the discarded-card population this spec now surfaces — fixing it shrinks
   the `Discarded` row to genuine user deletions.

Also unaddressed, and related to (3): `weight <= 0` has no CHECK constraint, and
`restore_board`'s 0333 cap check can be sidestepped by setting
`boards.deleted_at = null` directly under the members update policy.
