# card_index becomes a derived table, and the card cap gets server-side teeth

**Date:** 2026-09-29
**Status:** approved, not yet implemented
**Migrations:** 0341 (A), 0342-0343 (C), 0344 (D)
**Follows:** `2026-09-21-admin-card-counts-design.md`, which fixed the *reporting*
of card counts. This fixes the *enforcement*.

The demo card cap meters `public.card_index`. Nothing on the server maintains
that table: `board_state` — where the cards actually live — carries exactly one
trigger (`board_state_recompute_image_refs`) and it does not touch
`card_index`. The table is written **only by the browser**, in
`boardsApi.js syncCardIndex`.

So the cap is advisory. A card can exist in the Y.Doc, render on the canvas, be
dragged and edited, and never be counted. This is not theoretical: a live board
holds several hundred image cards and is metered at one, on an account whose cap
is a fraction of that. It happened without any adversary — one bulk drop, a
single failed upsert, and `boardsApi.js:1401` swallowing the error with a
`console.warn`.

The leak is also still open. Fresh uncounted cards appear every month, on a
slowly growing number of accounts, at a much smaller per-account volume than the
original spike — consistent with the 10-second sync window closing on a tab
before it flushes, rather than with bulk-import failure.

And it drifts **both ways**: a meaningful number of `card_index` rows reference
cards that are no longer in the board's Y.Doc at all, which means some people are
spending cap on content they already deleted. That direction is worse
commercially than the ghosts — it pushes real users into the paywall early.

---

## The invariant this establishes

> `public.card_index` is a **derived table**. It has exactly one writer: the
> reconciler, running as `service_role`. `authenticated` keeps `SELECT` and
> loses `INSERT`, `UPDATE` and `DELETE`.

Everything else follows from that. Today `authenticated` holds INSERT, UPDATE and
DELETE on `card_index`, with **every column updatable** — `board_id` and `weight`
included. That is why the known bypasses exist, and why patching them one at a
time is the wrong shape: removing the write grant retires the whole class.

`SELECT` must stay. `entity_search` and the home graph read `card_index`, and
`syncCardIndex`'s own header notes the table serves search as well as the cap.

---

## Constraint that shaped the design

**Postgres cannot decode a Y.Doc.** `_r2_keys_in_doc(text)` looks like a parser
and is not: it base64-decodes the doc and runs `regexp_matches` for
`r2:([A-Za-z0-9_\-./]{20,})` over the raw bytes. That works for R2 keys because
they are long and distinctive. It cannot yield card ids, kinds, weights, or —
critically — distinguish live content from tombstoned content. Any accounting
built on it is a guess.

**And Yjs decode already failed once in a Supabase edge function.**
`supabase/functions/backfill-image-refs/index.ts` is deprecated with this note:

> We hit WORKER_RESOURCE_LIMIT on the full production dataset (1300+ snapshots)
> because Yjs decode + toJSON of large docs blows past the edge runtime's memory
> cap.

That was a **batch**: every snapshot decoded in one invocation. Per-document
decode is a different profile entirely. Measured on the live corpus:

| `board_state.doc` (base64) | size |
|---|---|
| median | under 1 kB |
| p95 | ~71 kB |
| largest | under 600 kB |
| over 1 MB | none |

So the rule the design is built on: **decode one document per invocation, never
a batch.** A queue plus a small per-tick claim enforces that structurally rather
than by discipline. A size guard skips and flags anything over 2 MB so a future
outsized doc degrades to a warning instead of killing the worker.

---

## Enforcement: a soft wall

Because derivation is asynchronous, the cap can no longer refuse a row at INSERT
time. It must not become a wall in front of `board_state` either: the document
already exists in the user's browser, so refusing to persist it destroys work,
and in a shared room a co-editor could push the doc over and start failing the
owner's saves for everyone.

So: **`board_state` always saves.** The server refuses *acquisition* instead —
the operations that cost money and that a client cannot perform for itself:

- **R2 upload presign** (`boards/party/upload.ts`). This is the money path and it
  checks nothing about the cap today.
- **New cluster creation.**

The client keeps its local cap check for immediate feedback, but it stops being
load-bearing — it is UX, not enforcement.

Worst-case staleness is one cron tick (~60s). That is acceptable precisely
because nothing user-facing blocks on the reconciler: a card always places, and
always saves.

---

## Phase A — close the SQL bypasses (migration 0341)

Standalone and shippable immediately. It holds the line until C lands, and stays
as defence in depth afterwards.

1. **`CHECK (weight > 0)` on `card_index`.** There is no constraint today, so a
   zero- or negative-weight row is a free card: `_owner_card_count` sums weight,
   and the cap trigger's UPDATE delta is `greatest(new.weight - old.weight, 0)`,
   which never lets a raised weight trip it. Verified applicable as-is — no
   existing row violates it (weights currently run from 1 to 8, the values above
   1 being grid cells), so it needs no data remediation and can be added
   `NOT VALID`-free in one statement.

   **Amended 2026-10-01: the bound is `>= 0`, and it has shipped (0346).** An
   empty grid now legitimately weighs 0 (owner decision: empty grids stop
   counting, so Generate matrix no longer spends a card per empty copy). Zero is
   therefore a real weight for exactly one shape, a grid with nothing in it, and
   `cardIndexRow.test.mjs` pins that nothing else can reach it. 0346 also makes
   the trigger's INSERT delta the row's own weight. The reconciler's pure
   function must reproduce the same rule; it already will if it calls
   `cardIndexWeight`.
2. **The cap trigger fires on `UPDATE OF board_id` too.** It is currently
   `BEFORE INSERT OR UPDATE OF weight`, so repointing a row at another board
   moves cards between owners' meters without any check.
3. **Close the restore bypass.** `restore_board()` got a cap check in 0333, but
   the policy `boards update by members` has `USING (can_write_workspace(workspace_id))`
   with no `deleted_at` predicate — so a client can simply set
   `deleted_at = null` and skip it. Add `and deleted_at is null` to that policy's
   USING clause: members may update *live* boards, and un-deleting must go
   through `restore_board()`.

   Soft delete still works (the row is live when it is deleted). The migration
   must verify no legitimate client path updates an already-deleted board.

## Phase B — stop the bleeding (client, no migration)

1. **Chunk the `card_index` upsert.** `changed` is upserted in a single call
   however large, so one oversized batch fails wholesale and the next sync
   retries the identical oversized batch forever.
2. **Stop swallowing the failure.** `boardsApi.js:1401` returns after a
   `console.warn` — no event, no withdrawal, no retry. Replace with a recorded
   error and bounded backoff. `saveBoardSnapshot` also fires
   `syncCardIndex(...).catch(e => console.warn(...))`, swallowing it a second
   time at the call site.
3. **Never write into a deleted cluster.** `deleteBoard` does not clear the
   pending 10-second timer, and `_doSyncCardIndex` resolves a board's workspace
   with no `deleted_at` filter and then **caches** it, so it cannot notice the
   delete even on a later run. Cancel the timer on delete and filter the lookup.

**The chunking in (1) is deliberately interim — Phase C deletes it.** It is worth
doing anyway: accounts are still accruing uncounted cards every month and C is
the long pole. (2) and (3) are *not* throwaway: `syncGroupIndex` has the same
shape at `boardsApi.js:1780` and C does not cover `group_index`.

**Done ahead of this spec (2026-10-01, interim):** a cap refusal no longer
withdraws existing work. The refusal used to delete *every* refused card on the
visible board with no undo. That included cards placed while the account was
paid whose 10-second sync never ran, so the first sync after a paid period ended
deleted them. Cards restored by undo or version history were deleted the same
way. `src/lib/capRefusal.js` now keeps a ledger of the cards this tab placed
through the cap gate in the last five minutes. Only those are withdrawn; every
other refused card stays on the canvas, uncounted, retried by the next sync, and
logged as `card_index_held`. The cap branch of `_doSyncCardIndex` also stopped
returning before the orphan cleanup. Before that, a board holding a refused card
never released the count of the cards deleted from it. Phase C removes the
ledger together with the rest of the client write path. This is the soft wall
above, arriving early.

## Phase C — the reconciler (migrations 0342, 0343)

**0342** creates the queue, the `board_state` trigger, and the cron schedule, and
deploys the edge function — derivation running alongside the client's writes, so
the two can be compared before anything is taken away. **0343** is the switch:
`revoke insert, update, delete on card_index from authenticated, anon`, remove
the client's `syncCardIndex` write path, and add the acquisition checks. Splitting
them means 0343 only lands once 0342 has been observed agreeing with the client
on live traffic.


| Piece | Responsibility |
|---|---|
| `card_index_dirty` | Queue. `board_id` primary key, `enqueued_at`, `attempts`, `last_error`. One row per board, so repeated writes coalesce |
| Trigger on `board_state` | `AFTER INSERT OR UPDATE` — upsert the `board_id`, bumping `enqueued_at` on conflict. O(1), no decoding in Postgres |
| `card-index-reconcile` edge function | Claims the **10** oldest rows per invocation (`for update skip locked`, so concurrent ticks never double-claim) and processes them **sequentially, one decode at a time** — never `Promise.all`, which would reconstruct the batch that killed the old function. Diffs desired against actual, applies inserts/updates/deletes as `service_role`, deletes the queue row. On failure increments `attempts` and stores `last_error`, leaving the row to retry |
| `pg_cron` + `pg_net`, every minute | Both extensions are already installed; follows the `0253_billing_reconcile_cron` pattern |
| Grant change | `revoke insert, update, delete on card_index from authenticated, anon`. `SELECT` retained |

The diff is a pure function — `(doc bytes, board_id, workspace_id) → desired
rows` — and lives in `boards/src/lib/` so `node --test` covers it, alongside the
existing `boardStateSync.js`. The edge function is then a thin shell: claim,
decode, call the pure function, apply, clear.

`board_state` writes were once 59.8% of all DB time, so the trigger must stay
O(1) — an upsert of one short row, never a decode.

**Failure mode, stated plainly:** if the reconciler stalls, `card_index` goes
stale. Cards still render and still save; counts lag. That is the same failure as
today except centrally visible — `attempts` and `last_error` are queryable, and
queue depth is alertable. The existing `check_discovery_pipelines` daily-alert
pattern is the model.

**`did_work` rides on this table, and 0343 takes its attribution away.** Since
0347, `_stamp_active_day_work` (AFTER INSERT OR UPDATE on `card_index`) marks a
day as work only when a card row is inserted or its content changes, and stamps
the person who made the write (`auth.uid()`), falling back to the board's
creator only when there is no session. Once the reconciler is the only writer,
every write runs as `service_role` with no `auth.uid()`: every stamp falls back
to the creator, a collaborator's edit credits the owner again, and the day
follows the queue's drain rather than the person. Before 0343 lands, move
`did_work` to a user-attributed source — the WORK_EVENTS the client already
emits (the list `_admin_engaged_visits` reads, pinned by
`engagedVisitsMigration.test.mjs`), or the `board_state` write, which is still
the person's own — and drop the trigger in the same migration.

## Phase D — reconcile the backlog (migration 0344)

Depends on C, because C is the first trustworthy decoder. Enqueue every board,
let the drain settle it, then report which accounts moved and in which direction
— ghosts gained, and stale rows released.

Only then decide remediation for the outlier accounts, on real per-card truth
rather than a regex over tombstone-bearing bytes. **No account's numbers are
adjusted before this report exists.**

---

## Testing

- **The decode-and-diff function** is pure and unit-tested in `src/lib` against
  hand-built Y.Docs: a card added, a card deleted, a card moved between boards,
  a weight change, an empty doc, and a doc whose only cards are tombstoned.
- **Migration assertions.** 0341 proves its CHECK rejects `weight = 0` and that
  the policy refuses an un-delete. 0342 proves the grant state: `authenticated`
  has `SELECT` and none of `INSERT`/`UPDATE`/`DELETE`.
- **A standing test that `card_index` has no client write grants** — the
  invariant everything else rests on, so it fails loudly if a future migration
  hands the grant back.
- The card-count lint from `cardCountPredicate.test.mjs` continues to guard the
  read side.
- `/admin` is not a public surface, and this changes no `/api/v1` endpoint, card
  kind, or limit — so `boards/content/docs/**` is untouched and
  `docsite.test.mjs` should stay green. If it goes red, that is a real signal.

---

## Explicitly out of scope

- **Per-card authorship.** `card_index` has no author column and the Y.Doc
  carries none either. The 2026-09-21 spec attributes guest work by who created
  the cluster; that stays.
- **`group_index` derivation.** It has the same client-written shape and the same
  swallowed-error bug (fixed in Phase B), but it feeds search, not the cap, so it
  does not need a reconciler yet.
- **Changing the cap's value or the plan.** This makes the existing cap real; it
  does not reprice anything.
