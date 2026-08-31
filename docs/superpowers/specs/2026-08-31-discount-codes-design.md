# Discount codes — admin tab + monthly-only enforcement

**Date:** 2026-08-31
**Status:** approved, not yet implemented

Create and manage Stripe discount codes from `/admin` instead of the Stripe
Dashboard. The motivating case is a code granting **50% off the first month**,
usable a configurable number of times.

---

## What already exists

Most of the redemption path is built. Before adding anything, the current state:

| Piece | Where | State |
|---|---|---|
| Promo code entry at checkout | `create-checkout-session/index.ts` — `allow_promotion_codes: true` | Works today for any plan |
| Net (post-discount) amount recorded | `subscriptions.monthly_amount_cents` (migration 0099) | Works |
| Discount shape recorded | `subscriptions.discount` jsonb (migration 0099) | Works for recurring coupons only — see Defect 1 |
| Discounts expanded on every Stripe read | `stripe-webhook`, `verify-checkout-session` | Works |
| Discounted-sub count | `admin_stats()` → `discounted_subs` | Works, but blind to `once` coupons |
| Per-user promo flag | `admin_list_users.subscription_discounted` → `AdminUserDetail.jsx:292` | Works, but blind to `once` coupons |

A coupon created in the Stripe Dashboard right now is redeemable with no code
change at all. What is missing is a way to **create and manage** codes without
leaving the app, and any per-code view of redemptions.

---

## Constraint that shaped the design

Monthly and annual are **two Prices on one Product** (`prod_UXMRuGS4n1NYk9`,
"Clusters Creator"). A Stripe coupon's `applies_to.products` therefore cannot
distinguish them, so the obvious "restrict this coupon to the monthly plan"
mechanism does not exist.

Separately, one promotion code maps to exactly one coupon, and a coupon carries
exactly one `percent_off`. A single code cannot discount monthly and annual at
different rates.

Stripe discounts **invoices, not months**. A `percent_off: 50, duration: 'once'`
coupon takes half off the first invoice — which is one month on the monthly
plan, but an entire year on the annual plan. Left unrestricted, "50% off the
first month" would hand annual buyers half off twelve months.

**Resolution:** codes are monthly-only, enforced by withholding the promo field
from annual checkouts. No Stripe restructuring, no product split, reversible in
one line.

---

## Design

### 1. Enforcement

In `create-checkout-session/index.ts`:

```ts
allow_promotion_codes: plan === "monthly",
```

An annual Checkout Session renders no promotion-code field, so no code can be
applied to a year-long first invoice regardless of how its coupon is configured.

This is deliberately blunt: it disables promo codes on annual entirely, not just
the codes this tab issues. That matches the requirement ("we can't do 50% off a
full year") and is a one-line reversal if an annual-specific offer is ever
wanted.

### 2. Admin tab — "Discounts"

New tab, `id: 'discounts'`, label `Discounts`. Placed in `OVERFLOW_IDS`
immediately **before** `'grants'` so the two sit adjacent — Grants comps access
for free, Discounts sells it cheaper — and so `OVERFLOW_SEP_AFTER = 'grants'`
keeps its current divider position.

Structurally modelled on `AdminGrantsTab.jsx`: `useAdminData` for fetching,
`AdminToolbar` / `AdminAsync` / `AdminSkeleton` for states, `AdminStatCard` for
the summary row, `StatusPill` for row status.

**Create panel**

| Field | Default | Notes |
|---|---|---|
| Code | — | Type one, or Generate (uppercase alphanumeric, ambiguous glyphs excluded) |
| Percent off | 50 | 1–100 |
| Max redemptions | 1 | Blank = unlimited |
| Expires | none | Optional date |
| Note | — | Stored in Stripe `metadata`, shown in the table |

A live preview line states the real outcome, with every number derived from
`PRICING` in `billingCopy.js` rather than typed:

> 50% off the first month — they pay $12.50, then $25/mo. Monthly plan only.

This is the house rule that pricing numbers are never hand-written, applied to
an admin surface: a price change in `billingCopy.js` must move this line too.

**Table**

Columns: code, discount, status, redeemed / max, expires, created by, note.
Row actions: copy code, deactivate.

Stripe promotion codes cannot be deleted, only deactivated. That fits the
repo's undo-toast convention precisely — the toast's Undo is a genuine
reactivate, not a tombstone.

Stat cards: Active, Redeemed, Expired, Inactive.

### 3. `admin-discount-action` edge function

Creating a coupon needs `STRIPE_SECRET_KEY`, so this cannot be a plain RPC.
Auth and shape follow `admin-account-action`: Bearer JWT must resolve to a
profile with `tier = 'admin'`, CORS headers on every response including errors.

| Action | Stripe calls |
|---|---|
| `create` | `coupons.create({ percent_off, duration: 'once', name, metadata })` then `promotionCodes.create({ coupon, code, max_redemptions?, expires_at?, metadata })` |
| `list` | `promotionCodes.list({ limit: 100, expand: ['data.coupon'] })` |
| `deactivate` / `reactivate` | `promotionCodes.update(id, { active })` |

`duration: 'once'` is used rather than `repeating / duration_in_months: 1`; on a
monthly plan they are equivalent, and `once` states the intent.

**Stripe is the source of truth for the codes themselves** — no mirror table.
The tab reads `times_redeemed`, `max_redemptions`, `active` and `expires_at`
straight from Stripe, so the two can never drift.

Failure handling: the coupon is created before the promotion code, so a failed
second call leaves an orphan coupon. The function deletes the coupon on
promotion-code failure and surfaces the original error.

### 4. Redemption tracking

Two changes, for two distinct defects.

**Defect 1 — `once` coupons are recorded as no discount at all.**

`_shared/activateCore.mjs:104`:

```js
if (coupon.duration === "once") continue;   // first invoice only — doesn't recur
```

The MRR reasoning is correct: a first-invoice discount genuinely should not
reduce monthly recurring revenue. But the `continue` also skips the block that
populates `primary`, conflating *should this reduce MRR* with *should we record
that a discount happened*. The result is that a `duration: 'once'` coupon —
exactly what this feature issues — is stored as `discount: null`, leaving
`subscription_discounted` false, the `promo` flag at `AdminUserDetail.jsx:292`
unrendered, and `discounted_subs` uncounted.

Fix: still skip the arithmetic for `once`, but populate `primary`, tagged
`applies_to: 'first_invoice'`. When both a `once` and a recurring coupon are
present, the recurring one wins `primary`, since that is the one explaining the
MRR figure.

This **widens the meaning** of two existing readouts — `subscription_discounted`
and `admin_stats().discounted_subs` will begin counting first-invoice promos.
That is intended, and doing it before any such coupon has ever been issued means
no historical figure changes retroactively.

**Defect 2 — `subscriptions.discount` is a snapshot, not a ledger.**

Stripe detaches a `once` discount after the first invoice. The next
`customer.subscription.updated` webhook recomputes `discount` from the
subscription's now-empty discount list and overwrites the record with null. Any
attribution that lives only in `subscriptions.discount` disappears roughly a
month after redemption.

Fix: a `discount_redemptions` table, written once from `stripe-webhook` on
`checkout.session.completed`.

```sql
create table public.discount_redemptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references auth.users on delete cascade,
  stripe_promotion_code_id text,                 -- promo_… (the id, NOT the code string)
  stripe_coupon_id        text,
  stripe_session_id       text unique,          -- idempotency on webhook replay
  stripe_subscription_id  text,
  plan                    text,
  percent_off             numeric,
  amount_off_cents        integer,
  redeemed_at             timestamptz not null default now()
);
```

RLS: admin read only, no client writes (the webhook uses the service role) —
matching the `subscriptions` table's posture from migration 0065.

The webhook already retrieves the subscription with `expand: ['discounts']`
(`stripe-webhook/index.ts:121`). The expected case is that the `once` discount is
still attached at `checkout.session.completed`, carrying both `promotion_code`
(a bare `promo_…` id) and an expanded `coupon` — needing no additional Stripe
call.

**This must be verified, not assumed.** Stripe removes a `once` discount once it
has been applied to an invoice, and the first invoice is paid during checkout, so
there is a plausible ordering in which the discount is already gone by the time
the webhook retrieves the subscription. Implementation step one is a test-mode
redemption with the retrieved subscription logged. If the discount is absent
there, fall back to the Checkout Session, which records what was applied
durably — retrieve it with `expand: ['total_details.breakdown.discounts']` and
read the promotion code and coupon from that breakdown. Ship whichever source
actually carries the data; do not ship the optimistic path untested, because the
failure mode is a silently empty ledger.

The `stripe_session_id` unique constraint makes the insert idempotent, which
matters because Stripe retries webhooks.

The admin tab joins redemptions to codes on `stripe_promotion_code_id`,
client-side, against the list it already fetched from Stripe.

### 5. Docs

`content/docs/account/plans.md` gains a short "Discount codes" subsection:
codes apply to the monthly plan only, discount the first month, and are entered
at checkout. Then `npm run docs:build` so the generated registries, `.md`
mirrors and `llms.txt` regenerate; `npm run docs:check` must be a no-op
afterwards.

The public-surface hash is not expected to move. `docsite.test.mjs` extracts the
`endpoints:` array from `worker-api.js`, `registerTool(…)`, `CARD_KINDS`, the
Settings `TABS`, and the `main.jsx` router branches — none of which this touches.
`/admin` is not a public surface and its tab list is not part of the gate. If the
hash does move, the cause must be understood before running `docs:accept`.

---

## Testing

- `activateCore.test.mjs` — new cases: a `once` coupon populates `discount` while
  leaving `monthlyAmountCents` at the gross figure; a `once` plus a recurring
  coupon yields the recurring one as `primary`; an unexpanded discount id is
  still skipped.
- `billingCopy` remains the only source of the preview line's numbers; the
  existing `docsite.test.mjs` price lint continues to cover the docs claim.
- Manual: create a code, redeem it on a monthly checkout in Stripe test mode,
  confirm a `discount_redemptions` row appears and the tab shows the redemption;
  confirm an annual checkout renders no promo field.

## Deliberately out of scope

- A "Have a code?" field on `/pricing` and `?code=` share links. Codes are
  entered in Stripe's own Checkout field, which already exists.
- Plan-dependent discount rates from a single code. Not expressible in Stripe;
  would require owning the code layer and pre-applying `discounts` at session
  creation, which is a materially larger build.
- Amount-off (rather than percent-off) coupons.
- Editing a live code. Stripe allows almost no mutation of an issued promotion
  code; deactivate and issue a new one.

## Expectations

The funnel's weak stage is upstream of price, not at it. A discount code is
worth having ready, but a quiet code should not be read as evidence that the
discount was too small.
