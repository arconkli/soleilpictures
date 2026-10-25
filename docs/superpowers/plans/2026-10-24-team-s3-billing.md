# Team S3: Team billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Migrations, RLS and grant reasoning stay on the main model. Steps use checkbox (`- [x]`)
> syntax.

**Goal:** a team pays for itself through Stripe. That covers buying a team, every seat change, renewal
and lapse, all behind the holds. While teams stay closed, nothing changes for anyone.

**Architecture:**
- **Separate customer.** A team's subscription lives on its own Stripe customer, stamped `soleil_kind:
  team` and never `supabase_user_id`. The personal billing path can't see it, and it can't see the
  personal path. Every team object carries `soleil_kind: team` in its metadata.
- **Code layout.** The rules live in `_shared/teamBillingCore.mjs` (pure, node-tested). The Stripe and DB
  calls live in `_shared/teamBilling.ts`.
- **Two new edge functions:**
  - `team-billing`, signed in: checkout, verify, portal, seat preview and add.
  - `team-billing-cron`, run by the cron secret: sync one team, or sweep all of them.
- **Seat sync.** The database owns seats (`organizations.seats`; S2a's `_org_add_seats` is its one
  writer, and the `org_seat_changes` outbox records each change). Stripe follows. A pg_net trigger on the
  outbox calls the cron function for that team at once, and a 10-minute sweep catches anything missed.
- **Holds.**
  - `team-billing` answers 404 `not_available` until the team price ids are set.
  - Checkout refuses unless `_teams_open_for(caller)`.
  - With no team, the webhook's team branch never runs.

**Tech stack:** Supabase Postgres (plpgsql), Deno edge functions with `npm:stripe@17.7.0` and
`npm:@supabase/supabase-js@2.117.3`, and node `--test` for the cores.

## Global constraints

- Owner decisions, from `docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md` (final):
  - Price and seats: $15 a seat a month or $144 a year; minimum 3 seats; self-serve up to 100.
  - A 14-day trial with a card required. The drive is 100 GB until the first payment, and seats added
    during the trial are charged at conversion.
  - Unused seats drop at renewal, never below 3.
  - When payment stops: 14 days of grace, then view-only, with data kept 12 months. Paying again
    restores the team.
  - Only the owner changes the card or plan, or cancels; admins can add seats, with the price shown
    first.
- Never apply a migration, deploy a function or write to Stripe live without the owner's explicit go.
  Teams stay closed (`teams_open` = `{"open": false, "test_owner_ids": []}`).
- Function grants follow the 0311 habit: `_` helpers are server-only, every migration ends with a proof
  block, and there are no overloads.
- The MCP applies at most about 5.5k characters per call, so the apply goes in parts.
- The repo is public: no business numbers in commits or files. Run `npm test` before every commit. Commit
  by pathspec.

## Decisions taken here (the owner can overrule; each is one place in the code)

1. **One team trial per owner.** An owner who has completed a trialing team checkout before gets no
   second trial. Without this, closing and re-buying is an endless free trial.
2. **Teams start at checkout.** `create_team` (S2a) now refuses with hint `team_checkout`. Its body moves
   to `_create_team_for(owner, …)`, which only the paid path calls. Otherwise anyone could make an unpaid
   team the day teams open.
3. **Closing a team cancels its subscription at once, with no refund.** This matches Creator, whose
   cancel runs to the period's end and refunds nothing.
4. **Renewal true-down happens at renewals only.** Seats the buyer chose before the trial converts are
   billed as chosen; unused ones drop from the first renewal on.
5. **Grace is 14 days from `past_due_since`.** `canceled`, `unpaid`, `incomplete_expired` and `paused`
   go view-only at once.
6. **Deferred, with the date they are first needed:**
   - The 12-month deletion and its warnings: not before 2027-10.
   - Team storage blocks and Creator credit plus the blocks move: S3b, before launch.

## As built (2026-10-24; nothing applied, deployed or written to Stripe)

- `_team_checkout_complete(checkout, session, mirror)` takes the session id too: a different session on the same
  checkout is refused (`session_mismatch`), and the team is made only once the subscription is active or trialing
  (`not_paid` waits for the subscription's own event). A refusal (42501/22023) is recorded and undone in Stripe
  (cancel, refund, `billing_flag`); anything else raises, so the webhook retries.
- `set_team_seats(org, seats)`: an admin's priced purchase as a TOTAL, so a retried `seats_add` can't buy twice.
  `team-billing` also has `sync` (after S2a's other admin seat adds, which the sweep otherwise bills within 10 min).
- `_team_billing_tick()` is the cron job: it applies the grace (the clock, not an event, ends it), then posts the
  sweep only while a team or a live team subscription exists.
- A trial's seat changes are synced unprorated: the first invoice bills the seats the trial ends with
  (`seatSyncPlan`, `canSyncSeats`). Seat increases use the default `allow_incomplete`: a failed charge leaves an open
  invoice, and the team goes past_due and through the grace.
- The webhook's team branch reads `soleil_kind` off the object itself, so a personal event never touches a team table.
- Apply kit: scratchpad `s3/apply/p0538_1..8.sql` (≤5.6k each, the proof alone in part 8), applied in order on a fresh
  local copy of the team schema; probe F (`s3/probeF.sql`, F1–F9) passes there and runs on live after the apply.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0538_teams_billing.sql` | Billing tables and the activation, entitlement, trim and read functions; `create_team` closed; the sync trigger and cron; proof |
| `supabase/functions/_shared/teamBillingCore.mjs` | Pure rules: team items, mirror fields, entitlement, seat-sync plan, trim window, portal spec |
| `supabase/functions/_shared/teamBilling.ts` | Deno: config, activation from a session, mirroring a subscription, syncing a team |
| `supabase/functions/team-billing/index.ts` | Signed in: `checkout`, `verify`, `portal`, `seats_preview`, `seats_add` |
| `supabase/functions/team-billing-cron/index.ts` | Cron secret: `{org_id}` syncs one team; `{}` sweeps all of them |
| `supabase/functions/_shared/activateCore.mjs` | `pickReusableCustomer` skips team customers; team items are never Creator |
| `supabase/functions/_shared/activate.ts` | `billingConfig()` gains the team product and prices |
| `supabase/functions/stripe-webhook/index.ts` | The team branch first, on checkout, subscription and charge events |
| `supabase/functions/verify-checkout-session/index.ts` | Refuses a team session |
| `supabase/config.toml` | `team-billing-cron` runs with `verify_jwt = false` |
| `boards/src/lib/teamBillingCore.test.mjs` | Core tests |
| `boards/src/lib/teamsBillingMigration.test.mjs` | Migration pins |
| `boards/src/lib/activateCore.test.mjs` | Tests for the two guards |

## Task 1: the guards in the personal path

- [x] `pickReusableCustomer(customers, userId)`: skip any customer whose `metadata.soleil_kind ===
  'team'`. Test: a list holding only a team customer returns `null`; a team customer listed before an
  unclaimed one picks the unclaimed one.
- [x] `isTeamItem(item, cfg)` uses `cfg.teamProduct` or `cfg.teamPrices`. `subscriptionItems` leaves team
  items out of `creator`, out of the `rest[0]` fallback and out of `unknown`. Test: a subscription whose
  only item is a team seat gets `creator: null`, and `activationDecision` gives `no_creator_item`.
- [x] `billingConfig()` adds `teamProduct` (`STRIPE_PRODUCT_TEAM`) and `teamPrices`
  (`STRIPE_PRICE_TEAM_MONTHLY` / `_ANNUAL`).
- [x] `verify-checkout-session` answers 409 `team_session` when `session.metadata.soleil_kind === 'team'`.

## Task 2: `teamBillingCore.mjs`

**Produces:**
- `TEAM_GRACE_DAYS = 14`, `TEAM_TRIAL_DAYS = 14`, `TEAM_MIN_SEATS = 3`, `TEAM_SELF_SERVE_MAX = 100`.
- `isTeamObject(obj)`: `obj.metadata.soleil_kind === 'team'`.
- `teamItems(sub, cfg)` → `{ seat, storage, seatsBilled, storageBlocks }`.
- `teamPlanFromSubscription(sub, cfg)` → `'monthly' | 'annual' | null`.
- `teamMirrorFields(sub, cfg)` → `{ stripe_subscription_id, plan, status, seats_billed, storage_blocks,
  current_period_end, cancel_at_period_end, trial_end }`.
- `teamEntitled(status, pastDueSince, now)`, the twin of SQL `_team_entitled`.
- `seatSyncPlan({ desired, billed, status, closed })` → `{ action: 'none' | 'update' | 'cancel', quantity,
  proration }`. Proration is `always_invoice` going up and `none` going down. No action unless the
  status is `active`, `trialing` or `past_due`.
- `trimDue({ status, cancelAtPeriodEnd, periodEnd, now })`: true when the status is `active`, the
  subscription is not cancelling, and renewal is less than 36 h away.
- `teamPortalFeatures()`: invoices, payment method and customer details are on; cancel is at the
  period's end; subscription update is off.
- `teamCheckoutParams({ customerId, price, seats, trial, checkoutId, ownerId, successUrl, cancelUrl, now })`
  → the Checkout Session create body.

**Check:** every function has cases in `teamBillingCore.test.mjs`.

## Task 3: migration 0538

- [x] Tables:
  - `org_subscriptions`: one row per team; RLS on; server-only; partial unique index on the
    subscription id.
  - Its observation guard: drop an older `observed_at`, and set or clear `past_due_since`.
  - `team_checkouts`: RLS on, server-only.
  - `organizations.view_only_since`.
  - `org_seat_changes.reason` gains `renewal`.
- [x] Functions:
  - `_team_grace_days()` and `_team_entitled(status, past_due_since)`.
  - `_create_team_for(owner, name, color, seats)` and `create_team`, which now refuses.
  - `start_team_checkout(name, color, workspace_ids, seats, plan, end_creator)`, as the caller. It checks
    teams are open, the caller has no team, owns the workspaces and they are personal, and the seats
    cover what the move-in needs (the `preview_move_into_team` rollback trick); then it writes the row.
  - `_team_checkout_complete(checkout_id, mirror jsonb)`: idempotent; creates the team, moves each
    workspace in on its own, writes the mirror, applies the billing.
  - `_team_mirror_upsert(org, mirror jsonb)` and `_org_billing_apply(org)`, which sets status,
    `view_only_since`, `first_paid_at` and `storage_blocks`, and notifies.
  - `_team_trim_seats(org)` and `_team_mark_seats_billed(org, upto)`.
  - `get_team_billing(org)`, for the owner and admins.
- [x] Sync and schedule:
  - The trigger `org_seat_changes_sync` posts `team-billing-cron` with `{org_id}`, through
    `_cron_edge_post`.
  - A second trigger does the same when `organizations.closed_at` is set.
  - `cron.schedule('team-billing-every-10-min', '*/10 * * * *', …)`.
- [x] Proof block:
  - every helper is server-only;
  - the client RPCs are callable when signed in and not signed out;
  - there are no overloads;
  - no organization exists.

**Check:** `teamsBillingMigration.test.mjs`, the local compile, and a rolled-back probe F covering
checkout complete (twice), the mirror guard, entitlement, trim and the seat outbox.

## Task 4: `teamBilling.ts` and the two functions

- [x] `activateTeamFromSession(admin, stripe, session)`:
  - retrieves the subscription with `latest_invoice` expanded;
  - runs `_team_checkout_complete`;
  - if that refuses (`team_exists` or `teams_closed`), cancels the subscription, refunds a paid invoice
    and writes a `billing_flag`.
- [x] `mirrorTeamSubscription(admin, stripe, subId)` and `syncTeam(admin, stripe, orgId)`:
  - close → cancel;
  - the seat quantity follows `organizations.seats`;
  - the changes are marked billed;
  - the mirror is refreshed and the billing applied.
- [x] `team-billing`:
  - `checkout` (the team price ids or 404; `start_team_checkout` as the caller; a reused team customer
    or a new one; a session with idempotency keys);
  - `verify`;
  - `portal` (owner only; a portal configuration found or created by metadata);
  - `seats_preview` (`invoices.createPreview`);
  - `seats_add` (`add_team_seats` as the caller, then `syncTeam`).
- [x] `team-billing-cron`:
  - `{org_id}` runs `syncTeam`;
  - `{}` sweeps, within a time budget: unbilled changes, closed teams with a live subscription, trims due,
    stale mirrors, and trial-ending notices.
- [x] `stripe-webhook`: the team branch comes first for `checkout.session.completed` and
  `customer.subscription.updated/deleted`, and `onChargeTrouble` flags team charges.

## Task 5: hand-off, on the owner's go

- [ ] Create the live Stripe objects with the Stripe MCP: the product "Clusters Team", and the prices
  `team_seat_monthly` ($15) and `team_seat_annual` ($144), per unit, recurring.
- [ ] Set the secrets `STRIPE_PRODUCT_TEAM`, `STRIPE_PRICE_TEAM_MONTHLY` and `STRIPE_PRICE_TEAM_ANNUAL`.
- [x] Apply 0538 in parts, then verify the bodies by md5 and run probe F. Done 2026-10-25: eight
  records, 17 bodies md5-matched, probe F 9/9 on live (rolled back; F5 builds its lapsed team
  fresh, since the MCP refuses a script with a delete in it).
- [ ] Deploy `team-billing`, `team-billing-cron`, `stripe-webhook`, `verify-checkout-session`,
  `create-checkout-session`, `billing-reconcile-cron` and `storage-addon` (everything that imports
  `activateCore` or `activate.ts`). Five done 2026-10-25, each built on the live code plus
  only S3's hunks (main's files, byte for byte) and read back: team-billing-cron v1, storage-addon v8,
  create-checkout-session v37, verify-checkout-session v27, stripe-webhook v37. Left: team-billing,
  with the price; and billing-reconcile-cron, frozen by another session, which can follow later: it
  only re-reads the subscription on a person's own `subscriptions` row, which never holds a team's.
- [ ] A live walk-through by the owner as a test owner: buy (trial, no charge), add a seat, open the
  portal, cancel, see the team go view-only. It runs through S4's setup and /team, wired to
  `team-billing` (until then both are sample-data previews).
