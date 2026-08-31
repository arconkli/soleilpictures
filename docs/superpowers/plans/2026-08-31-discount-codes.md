# Discount Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and manage monthly-only Stripe discount codes from `/admin`, with a durable record of who redeemed each one.

**Architecture:** Stripe remains the source of truth for the codes themselves — a new admin-authed edge function wraps `coupons.create` / `promotionCodes.*`, and the admin tab reads `times_redeemed` straight from Stripe so the two cannot drift. Only redemption *attribution* needs our own storage, because Stripe detaches a `duration: 'once'` discount after the first invoice. "Monthly only" is enforced by withholding Stripe Checkout's promo field from annual sessions, since monthly and annual are two Prices on one Product and a coupon cannot restrict itself to a plan.

**Tech Stack:** Deno edge functions (`npm:stripe@17`), Postgres/Supabase migrations, React 18 (no router — tab state in `AdminPage.jsx`), `node --test` for pure logic.

**Spec:** `docs/superpowers/specs/2026-08-31-discount-codes-design.md`

## Global Constraints

- **The repo is public.** No business metrics, revenue figures or user counts in commit messages or committed files.
- **Numbers are never typed by hand.** Every price in UI copy derives from `PRICING` in `boards/src/lib/billingCopy.js`.
- **Gold (`--soleil`) is reserved** for active / selection / focus states. Resting icons are neutral ink.
- **Deleting shows an undo toast.** Deactivating a code must follow this.
- **Never `.catch()` a `supabase.rpc()` builder** — it is a thenable, not a promise.
- Run `cd boards && npm test` before every commit.
- Latest migration on disk is `0273_admin_activity_pulse.sql`; the new one is **0274**.
- Pure, node-testable logic lives in `supabase/functions/_shared/activateCore.mjs` and is tested from `boards/src/lib/activateCore.test.mjs`. Follow that split — do not put testable logic inside a `.ts` edge function.

---

### Task 1: Record `once` coupons, and gate promo codes to monthly

Two pure-logic changes in the same file, both covered by the same test run.

**Files:**
- Modify: `supabase/functions/_shared/activateCore.mjs:97-133`
- Test: `boards/src/lib/activateCore.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `netMonthlyFromSubscription(sub)` → `{ monthlyAmountCents: number|null, discount: object|null }` — unchanged signature, but `discount` is now populated for `duration: 'once'` coupons, carrying `applies_to: 'first_invoice'`.
  - `promoCodesAllowedForPlan(plan: string|null|undefined)` → `boolean` — new export, consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `boards/src/lib/activateCore.test.mjs`. Also add `promoCodesAllowedForPlan` to the existing import block at the top of that file (the one importing from `'../../../supabase/functions/_shared/activateCore.mjs'`).

```javascript
// ── once coupons: recorded, never subtracted ────────────────────────────────
test('a once coupon is RECORDED even though it does not move MRR', () => {
  const s = sub(usdPrice(2500), { discounts: [coupon({ id: 'c_first', percent_off: 50, duration: 'once' })] });
  const r = netMonthlyFromSubscription(s);
  assert.equal(r.monthlyAmountCents, 2500);          // MRR untouched — correct
  assert.equal(r.discount.coupon, 'c_first');        // but the redemption is visible
  assert.equal(r.discount.percent_off, 50);
  assert.equal(r.discount.duration, 'once');
  assert.equal(r.discount.applies_to, 'first_invoice');
});
test('a recurring coupon outranks a once coupon as the primary record', () => {
  const s = sub(usdPrice(2500), {
    discounts: [
      coupon({ id: 'c_first', percent_off: 50, duration: 'once' }),
      coupon({ id: 'c_forever', percent_off: 20, duration: 'forever' }),
    ],
  });
  const r = netMonthlyFromSubscription(s);
  assert.equal(r.monthlyAmountCents, 2000);          // only the forever one applies
  assert.equal(r.discount.coupon, 'c_forever');      // the one that explains MRR wins
  assert.equal(r.discount.applies_to, undefined);
});
test('a once coupon carries its promotion code through', () => {
  const s = sub(usdPrice(2500), {
    discounts: [{ coupon: { id: 'c_first', percent_off: 50, duration: 'once' }, promotion_code: 'promo_abc' }],
  });
  assert.equal(netMonthlyFromSubscription(s).discount.promotion_code, 'promo_abc');
});

// ── promoCodesAllowedForPlan ────────────────────────────────────────────────
test('promo codes are offered on monthly only', () => {
  assert.equal(promoCodesAllowedForPlan('monthly'), true);
  assert.equal(promoCodesAllowedForPlan('annual'), false);
  assert.equal(promoCodesAllowedForPlan(undefined), false);
  assert.equal(promoCodesAllowedForPlan(null), false);
  assert.equal(promoCodesAllowedForPlan('MONTHLY'), false);   // exact match only
});
```

Then extend the existing `'once coupons do not reduce MRR'` test at line 83 so it no longer asserts the old blindness. Replace its body with:

```javascript
test('once coupons do not reduce MRR', () => {
  const s = sub(usdPrice(2500), { discounts: [coupon({ id: 'c', amount_off: 500, duration: 'once' })] });
  const r = netMonthlyFromSubscription(s);
  assert.equal(r.monthlyAmountCents, 2500);
  assert.equal(r.discount.amount_off, 500);   // recorded, just not subtracted
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd boards && node --test src/lib/activateCore.test.mjs
```

Expected: FAIL. The three new `once` tests fail on `Cannot read properties of null (reading 'coupon')` because `discount` is currently `null`; the `promoCodesAllowedForPlan` test fails on `promoCodesAllowedForPlan is not a function`.

- [ ] **Step 3: Implement**

In `supabase/functions/_shared/activateCore.mjs`, replace the loop body (currently lines 97–133, from `const firstPrice =` through the `return` of `netMonthlyFromSubscription`) with:

```javascript
    const firstPrice = sub.items?.data?.[0]?.price;
    let net = grossMonthly;
    let primary = null;           // a RECURRING coupon — the one that explains MRR
    let firstInvoiceOnly = null;  // a 'once' coupon — recorded, never subtracted

    // Shared shape so a 'once' coupon and a recurring one are described
    // identically; only the MRR arithmetic differs between them.
    const describe = (c, d) => ({
      coupon: c.id ?? c.name ?? null,
      name: c.name ?? null,
      percent_off: c.percent_off ?? null,
      amount_off: c.amount_off ?? null,
      duration: c.duration ?? null,
      ...(c.duration === "repeating"
        ? { duration_in_months: c.duration_in_months ?? null }
        : {}),
      promotion_code: d.promotion_code ?? null,
    });

    for (const d of list) {
      if (!d || typeof d === "string") continue; // unexpanded id — can't read coupon
      const coupon = d.coupon;
      if (!coupon) continue;

      // A 'once' coupon discounts the FIRST INVOICE only, so it must not move
      // the monthly figure. It is still a discount that HAPPENED, though —
      // skipping the record entirely (as this did until 2026-08-31) makes every
      // first-month promo invisible to subscription_discounted, the admin promo
      // flag and discounted_subs. Record it; just don't subtract it.
      if (coupon.duration === "once") {
        if (!firstInvoiceOnly) {
          firstInvoiceOnly = { ...describe(coupon, d), applies_to: "first_invoice" };
        }
        continue;
      }

      // An amount_off in a different currency than the price cannot be applied
      // without a rate; record the discount but leave the amount untouched
      // rather than subtracting apples from oranges.
      const currencyMismatch = Boolean(
        coupon.amount_off && coupon.currency && firstPrice?.currency
        && coupon.currency !== firstPrice.currency,
      );
      if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
        net = net * (1 - coupon.percent_off / 100);
      } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0 && !currencyMismatch) {
        net = net - perMonth(coupon.amount_off, 1, firstPrice);
      }
      if (!primary) {
        primary = {
          ...describe(coupon, d),
          ...(currencyMismatch ? { currency_mismatch: coupon.currency } : {}),
        };
      }
    }

    // A recurring coupon wins the slot when both exist — it is the one the
    // monthly figure needs explaining by.
    return {
      monthlyAmountCents: Math.max(0, Math.round(net)),
      discount: primary ?? firstInvoiceOnly,
    };
```

Then append this exported function at the end of the same file:

```javascript
// Whether Stripe Checkout should offer its promotion-code field for `plan`.
//
// Codes are MONTHLY-ONLY, and this is the only place that can enforce it.
// Stripe discounts INVOICES, not months: a `duration: 'once'` coupon takes its
// percentage off the first invoice, which is one month on the monthly plan but
// an ENTIRE YEAR on the annual one. The usual fix — restricting the coupon with
// applies_to.products — is unavailable here because monthly and annual are two
// Prices on a single Product, so no coupon can tell them apart. Withholding the
// field is therefore the enforcement, not a UI preference.
export function promoCodesAllowedForPlan(plan) {
  return plan === "monthly";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd boards && node --test src/lib/activateCore.test.mjs
```

Expected: PASS, all tests. Then the full suite:

```bash
cd boards && npm test
```

Expected: PASS. If `docsite.test.mjs` fails here, stop — it means something in the public surface moved unexpectedly and must be understood before continuing.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/activateCore.mjs boards/src/lib/activateCore.test.mjs
git commit -m "$(cat <<'EOF'
A first-month discount was recorded as no discount at all

netMonthlyFromSubscription skipped `duration: once` coupons entirely rather
than skipping only the arithmetic, so a first-invoice promo left
subscriptions.discount null — invisible to subscription_discounted, the admin
promo flag, and discounted_subs. It still must not move MRR; it must still be
recorded. A recurring coupon keeps the primary slot when both are present.

Also adds promoCodesAllowedForPlan, which is where monthly-only enforcement
has to live: monthly and annual are two Prices on one Product, so no coupon
can restrict itself to a plan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration 0274 — `discount_redemptions`

**Files:**
- Create: `supabase/migrations/0274_discount_redemptions.sql`

**Interfaces:**
- Consumes: `public.is_admin()` (migration 0073).
- Produces: table `public.discount_redemptions` with columns `id, user_id, stripe_promotion_code_id, stripe_coupon_id, stripe_session_id, stripe_subscription_id, plan, percent_off, amount_off_cents, redeemed_at`. Consumed by Tasks 3 and 6.

- [ ] **Step 1: Write the migration**

```sql
-- 0274 — discount_redemptions: a durable record of who redeemed which code.
--
-- WHY THIS TABLE EXISTS. subscriptions.discount is a SNAPSHOT of the
-- subscription's CURRENT discount, not a ledger. Stripe detaches a
-- `duration: 'once'` coupon once it has been applied to an invoice, so the
-- next customer.subscription.updated webhook recomputes discount as null and
-- overwrites the record. Attribution for a first-month promo therefore
-- survives about one billing period unless it is captured at checkout, which
-- is what stripe-webhook now does.
--
-- Written ONLY by stripe-webhook via the service role. There is deliberately
-- no INSERT/UPDATE/DELETE policy — the service role bypasses RLS, and every
-- other caller is left with nothing to use. Same posture as subscriptions (0065).

create table if not exists public.discount_redemptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid references auth.users on delete cascade,
  stripe_promotion_code_id text,           -- promo_… (the ID, NOT the code string)
  stripe_coupon_id         text,
  stripe_session_id        text unique,    -- idempotency: Stripe retries webhooks
  stripe_subscription_id   text,
  plan                     text check (plan is null or plan in ('monthly','annual')),
  percent_off              numeric,
  amount_off_cents         integer,
  redeemed_at              timestamptz not null default now()
);

create index if not exists discount_redemptions_promo_idx
  on public.discount_redemptions(stripe_promotion_code_id);
create index if not exists discount_redemptions_user_idx
  on public.discount_redemptions(user_id);

alter table public.discount_redemptions enable row level security;

-- Table-level grants are NOT implicit here. `revoke from public` does not cover
-- anon, so both roles are named explicitly; authenticated gets SELECT only and
-- RLS narrows that to admins.
revoke all on public.discount_redemptions from anon, authenticated;
grant select on public.discount_redemptions to authenticated;

drop policy if exists "discount redemptions read admin" on public.discount_redemptions;
create policy "discount redemptions read admin" on public.discount_redemptions
  for select using (public.is_admin());
```

- [ ] **Step 2: Apply it**

Apply via the Supabase MCP (`mcp__supabase__apply_migration`, project ref `ehlhlmbpwwalmeisvmdp`, name `discount_redemptions`) — the local `supabase` CLI is authenticated to the wrong org and cannot do this.

**The DB is shared between preview and production.** Applying this migration makes the table live for production users immediately, before any code ships. That is safe here (a new, unwritten, admin-read-only table) but must be a conscious act, not a surprise.

- [ ] **Step 3: Verify it landed correctly**

Run via `mcp__supabase__execute_sql`:

```sql
select
  (select count(*) from information_schema.columns
     where table_name = 'discount_redemptions') as cols,
  (select relrowsecurity from pg_class where relname = 'discount_redemptions') as rls_on,
  (select count(*) from pg_policies where tablename = 'discount_redemptions') as policies,
  (select has_table_privilege('anon', 'public.discount_redemptions', 'SELECT')) as anon_can_select,
  (select has_table_privilege('authenticated', 'public.discount_redemptions', 'INSERT')) as authed_can_insert;
```

Expected: `cols = 10`, `rls_on = true`, `policies = 1`, `anon_can_select = false`, `authed_can_insert = false`.

If `anon_can_select` is true, the revoke did not take — stop and fix before continuing, or the ledger is world-readable.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0274_discount_redemptions.sql
git commit -m "$(cat <<'EOF'
subscriptions.discount is a snapshot, so it cannot answer who redeemed a code

Stripe detaches a `once` coupon after it hits an invoice; the next
subscription.updated recomputes discount as null and overwrites it. A
first-month promo is therefore only attributable if it is captured at
checkout. Admin-read-only, service-role-write, unique on the session id so a
webhook retry cannot double-count.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Withhold the promo field from annual, and capture redemptions

**Files:**
- Modify: `supabase/functions/create-checkout-session/index.ts:15` (import), `:165` (`allow_promotion_codes`)
- Modify: `supabase/functions/stripe-webhook/index.ts` — new helper + one call inside `onCheckoutCompleted`

**Interfaces:**
- Consumes: `promoCodesAllowedForPlan` (Task 1); table `discount_redemptions` (Task 2).
- Produces: rows in `discount_redemptions`. Consumed by Task 6.

- [ ] **Step 1: Gate the promo field**

In `supabase/functions/create-checkout-session/index.ts`, extend the existing import at line 15:

```typescript
import { decideCheckoutRoute, filterLiveSubscriptions, pickReusableCustomer, promoCodesAllowedForPlan } from "../_shared/activateCore.mjs";
```

Replace line 165 (`allow_promotion_codes: true,`) with:

```typescript
      // Monthly only. Stripe discounts invoices, not months — a `once` coupon
      // is half off ONE month here but half off a WHOLE YEAR on annual, and no
      // coupon can restrict itself to a plan because monthly and annual are two
      // Prices on one Product. Withholding the field IS the enforcement.
      allow_promotion_codes: promoCodesAllowedForPlan(plan),
```

- [ ] **Step 2: Add the redemption capture helper**

Append to `supabase/functions/stripe-webhook/index.ts`, next to the other helpers:

```typescript
// Durable redemption record — see migration 0274. subscriptions.discount is a
// snapshot Stripe clears after the first invoice, so a first-month promo is
// only ever attributable if it is captured here, at checkout.
//
// Never throws: the money has already moved, and a failed ledger write must not
// turn into a 500 that makes Stripe retry a completed activation.
async function recordDiscountRedemption(
  admin: ReturnType<typeof createClient>,
  args: {
    session: Stripe.Checkout.Session;
    subscription: Stripe.Subscription | null;
    userId: string;
    subId: string | null;
  },
): Promise<void> {
  const { session, subscription, userId, subId } = args;
  try {
    let promo: string | null = null;
    let couponId: string | null = null;
    let percentOff: number | null = null;
    let amountOff: number | null = null;

    const take = (c: Stripe.Coupon, pc: string | Stripe.PromotionCode | null | undefined) => {
      couponId = c.id ?? null;
      percentOff = c.percent_off ?? null;
      amountOff = c.amount_off ?? null;
      promo = typeof pc === "string" ? pc : pc?.id ?? null;
    };

    // Preferred source: the subscription, already retrieved with
    // expand: ["discounts"] by the caller — no extra Stripe call.
    for (const d of (subscription?.discounts ?? []) as (string | Stripe.Discount)[]) {
      if (!d || typeof d === "string") continue;   // unexpanded id
      if (!d.coupon) continue;
      take(d.coupon, d.promotion_code);
      break;
    }

    // Fallback: Stripe removes a `once` discount as soon as it is applied, and
    // the first invoice is paid DURING checkout — so it can already be gone by
    // the time we retrieve the subscription. The Checkout Session records what
    // was actually applied, and keeps it.
    if (!couponId) {
      const full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["total_details.breakdown.discounts"],
      });
      for (const bd of full.total_details?.breakdown?.discounts ?? []) {
        const c = bd.discount?.coupon;
        if (!c) continue;
        take(c, bd.discount?.promotion_code);
        break;
      }
    }

    if (!couponId) return;   // no discount on this checkout — nothing to record

    const ins = await admin.from("discount_redemptions").insert({
      user_id: userId,
      stripe_promotion_code_id: promo,
      stripe_coupon_id: couponId,
      stripe_session_id: session.id,
      stripe_subscription_id: subId,
      plan: (session.metadata?.plan as string | undefined) ?? null,
      percent_off: percentOff,
      amount_off_cents: amountOff,
    });
    // 23505 = unique violation on stripe_session_id → this is a webhook retry,
    // which is expected and correct, not an error.
    if (ins.error && ins.error.code !== "23505") {
      console.error("[stripe] discount_redemptions insert failed", ins.error);
    }
  } catch (e) {
    console.error("[stripe] recordDiscountRedemption threw", e);
  }
}
```

- [ ] **Step 3: Call it**

In `onCheckoutCompleted`, immediately **before** the `emitCapi({ eventName: "Purchase", … })` block, insert:

```typescript
  // Same reasoning as the Purchase emit below: past the soft-refusal return,
  // the payment is real, so the redemption is real and worth recording even if
  // our own tier flip failed.
  await recordDiscountRedemption(admin, { session, subscription, userId, subId: subId ?? null });
```

- [ ] **Step 4: Deploy both functions**

Deploy via the Supabase MCP (`mcp__supabase__deploy_edge_function`) — `create-checkout-session` and `stripe-webhook`.

- [ ] **Step 5: Verify the fallback question empirically — do not skip this**

The spec flags this as the one assumption that must be tested rather than reasoned about. In Stripe **test mode**: create a 50%-off `once` coupon and a promotion code, run a monthly checkout redeeming it, then read the Supabase function logs (`mcp__supabase__get_logs`, service `edge-function`).

Confirm which branch produced the row, and confirm the row exists:

```sql
select stripe_promotion_code_id, stripe_coupon_id, percent_off, plan, redeemed_at
from public.discount_redemptions order by redeemed_at desc limit 5;
```

Expected: exactly one row, `percent_off = 50`, `plan = 'monthly'`, both Stripe ids non-null.

Then confirm the enforcement, which is the whole point of the feature:

Start an **annual** checkout and confirm the Stripe Checkout page renders **no** "Add promotion code" link. If it does render, `promoCodesAllowedForPlan` is not wired to the session — stop and fix.

If **neither** source yielded a coupon, the ledger is silently empty: inspect the retrieved session in the logs and correct the extraction before moving on. Shipping the optimistic path untested is the specific failure this step exists to prevent.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/create-checkout-session/index.ts supabase/functions/stripe-webhook/index.ts
git commit -m "$(cat <<'EOF'
Half off the first invoice is half off a whole year, on the annual plan

Stripe discounts invoices, not months, and monthly/annual are two Prices on
one Product — so no coupon can restrict itself to a plan. Checkout now offers
the promotion-code field on monthly only, which is the enforcement.

The webhook records the redemption at checkout, preferring the already-expanded
subscription discount and falling back to the Checkout Session's breakdown,
because Stripe detaches a `once` discount the moment it is applied.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `admin-discount-action` edge function

**Files:**
- Create: `supabase/functions/admin-discount-action/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: POST endpoint taking `{ action, … }` and returning JSON. Consumed by Task 5 and Task 6.
  - `{ action: 'list' }` → `{ ok: true, codes: DiscountCode[] }`
  - `{ action: 'create', code, percent_off, max_redemptions?, expires_at?, note? }` → `{ ok: true, code: DiscountCode }`
  - `{ action: 'set_active', promotion_code_id, active }` → `{ ok: true, code: DiscountCode }`
  - `DiscountCode = { id, code, active, percent_off, duration, times_redeemed, max_redemptions, expires_at, created, created_by, note }`

- [ ] **Step 1: Write the function**

```typescript
// admin-discount-action — POST (admin-authed) management of Stripe discount
// codes, so an operator never has to open the Stripe Dashboard.
//
// Body: { action, … }
//   • list        → every promotion code, newest first, with its coupon inlined
//   • create      → { code, percent_off, max_redemptions?, expires_at?, note? }
//                   Creates a `duration: 'once'` coupon, then the promotion code.
//   • set_active  → { promotion_code_id, active } — deactivate / reactivate.
//                   Stripe cannot DELETE a promotion code, only deactivate it,
//                   which is why the UI offers an undo rather than a tombstone.
//
// Auth: caller's Bearer JWT must resolve to a profile with tier='admin' — same
// pattern as admin-account-action.
//
// STRIPE IS THE SOURCE OF TRUTH for the codes. There is no mirror table, so
// times_redeemed / active / expires_at cannot drift from Stripe. The operator's
// note rides in the coupon's metadata. Only redemption ATTRIBUTION is ours
// (discount_redemptions, migration 0274), because Stripe forgets it.
//
// Codes are MONTHLY-ONLY. That is enforced in create-checkout-session, which
// withholds Checkout's promo field on annual — not here. See
// promoCodesAllowedForPlan in _shared/activateCore.mjs for why it cannot be a
// coupon restriction.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY")!;

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

interface Body {
  action?: "list" | "create" | "set_active";
  code?: string;
  percent_off?: number;
  max_redemptions?: number | null;
  expires_at?: string | null;   // ISO date
  note?: string;
  promotion_code_id?: string;
  active?: boolean;
}

function shape(pc: Stripe.PromotionCode) {
  const c = pc.coupon as Stripe.Coupon;
  return {
    id: pc.id,
    code: pc.code,
    active: pc.active,
    percent_off: c?.percent_off ?? null,
    duration: c?.duration ?? null,
    times_redeemed: pc.times_redeemed ?? 0,
    max_redemptions: pc.max_redemptions ?? null,
    expires_at: pc.expires_at ? new Date(pc.expires_at * 1000).toISOString() : null,
    created: pc.created ? new Date(pc.created * 1000).toISOString() : null,
    created_by: (c?.metadata?.created_by as string | undefined) ?? null,
    note: (c?.metadata?.note as string | undefined) ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return json({ error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const u = await userClient.auth.getUser();
    if (u.error || !u.data.user) return json({ error: "invalid token" }, 401);
    const callerId = u.data.user.id;
    const callerEmail = u.data.user.email ?? null;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const me = await admin.from("profiles").select("tier").eq("user_id", callerId).maybeSingle();
    if (me.error || me.data?.tier !== "admin") return json({ error: "admin only" }, 403);

    let body: Body;
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

    switch (body.action) {
      case "list": {
        const list = await stripe.promotionCodes.list({ limit: 100, expand: ["data.coupon"] });
        return json({ ok: true, codes: list.data.map(shape) }, 200);
      }

      case "create": {
        const code = (body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (code.length < 3 || code.length > 40) {
          return json({ error: "code must be 3–40 letters or digits" }, 400);
        }
        const pct = Number(body.percent_off);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
          return json({ error: "percent_off must be between 1 and 100" }, 400);
        }
        let maxRedemptions: number | undefined;
        if (body.max_redemptions !== null && body.max_redemptions !== undefined) {
          const m = Number(body.max_redemptions);
          if (!Number.isInteger(m) || m < 1) return json({ error: "max_redemptions must be a whole number ≥ 1" }, 400);
          maxRedemptions = m;
        }
        let expiresAt: number | undefined;
        if (body.expires_at) {
          const t = Date.parse(body.expires_at);
          if (Number.isNaN(t)) return json({ error: "expires_at is not a date" }, 400);
          if (t <= Date.now()) return json({ error: "expires_at must be in the future" }, 400);
          expiresAt = Math.floor(t / 1000);
        }
        const note = (body.note || "").trim().slice(0, 400);

        // duration:'once' rather than repeating/duration_in_months:1 — on a
        // monthly plan they are equivalent, and 'once' states the intent.
        const coupon = await stripe.coupons.create({
          percent_off: pct,
          duration: "once",
          name: `${pct}% off first month`,
          metadata: {
            created_by: callerEmail ?? callerId,
            ...(note ? { note } : {}),
          },
        });

        try {
          const pc = await stripe.promotionCodes.create({
            coupon: coupon.id,
            code,
            ...(maxRedemptions !== undefined ? { max_redemptions: maxRedemptions } : {}),
            ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
          });
          // Re-read so the response carries the same expanded shape as `list`.
          const full = await stripe.promotionCodes.retrieve(pc.id, { expand: ["coupon"] });
          return json({ ok: true, code: shape(full) }, 200);
        } catch (e) {
          // The coupon exists but the code does not — a duplicate code string is
          // the common cause. Delete the orphan so a retry with a different code
          // does not litter the account, then surface the REAL error.
          await stripe.coupons.del(coupon.id).catch(() => {});
          const msg = String((e as Error)?.message ?? e);
          const dupe = /already exists|code.*taken/i.test(msg);
          return json({ error: dupe ? `The code "${code}" is already in use.` : msg }, dupe ? 409 : 400);
        }
      }

      case "set_active": {
        if (!body.promotion_code_id) return json({ error: "missing promotion_code_id" }, 400);
        if (typeof body.active !== "boolean") return json({ error: "active must be true or false" }, 400);
        await stripe.promotionCodes.update(body.promotion_code_id, { active: body.active });
        const full = await stripe.promotionCodes.retrieve(body.promotion_code_id, { expand: ["coupon"] });
        return json({ ok: true, code: shape(full) }, 200);
      }

      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error("[admin-discount-action] error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
```

- [ ] **Step 2: Deploy and verify auth refuses a non-admin**

Deploy via `mcp__supabase__deploy_edge_function`. Then, from the browser console **signed in as a non-admin**:

```javascript
const { data } = await window.supabase.auth.getSession();
await fetch(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/admin-discount-action', {
  method: 'POST',
  headers: { authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'list' }),
}).then(r => r.status);
```

Expected: `403`. An unauthenticated call (no header) must give `401`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-discount-action/index.ts
git commit -m "$(cat <<'EOF'
Issuing a discount code meant leaving the app for the Stripe Dashboard

Admin-authed wrapper over coupons.create + promotionCodes.*, with Stripe kept
as the source of truth so times_redeemed and active cannot drift from a mirror
table. A failed promotion-code create deletes the orphaned coupon rather than
littering the account, and reports the duplicate-code case as a 409.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Pure client helpers for the tab

Isolated so the copy rules and the code generator are node-testable without mounting React.

**Files:**
- Create: `boards/src/lib/discountCodes.js`
- Create: `boards/src/lib/discountCodes.test.mjs`

**Interfaces:**
- Consumes: `PRICING` from `boards/src/lib/billingCopy.js`.
- Produces, all consumed by Task 6:
  - `normalizeDiscountCode(raw: string) → string`
  - `generateDiscountCode(len?: number, rand?: () => number) → string`
  - `discountPreviewLine({ percentOff: number }) → string | null`
  - `codeStatus(code: DiscountCode, now?: Date) → 'active'|'expired'|'revoked'|'forever'` — `'revoked'` for `active:false`, `'expired'` for past-expiry **or** fully redeemed, `'forever'` for an active code with no expiry and no cap, else `'active'`. These four map onto the existing `StatusPill` colours.

- [ ] **Step 1: Write the failing tests**

```javascript
// Pure helpers behind the admin Discounts tab. Kept out of the component so the
// copy rule (prices come from billingCopy, never typed) is actually testable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeStatus,
  discountPreviewLine,
  generateDiscountCode,
  normalizeDiscountCode,
} from './discountCodes.js';
import { PRICING } from './billingCopy.js';

test('codes normalize to uppercase alphanumerics', () => {
  assert.equal(normalizeDiscountCode(' launch-50 '), 'LAUNCH50');
  assert.equal(normalizeDiscountCode('a_b.c'), 'ABC');
  assert.equal(normalizeDiscountCode(''), '');
  assert.equal(normalizeDiscountCode(null), '');
});

test('generated codes avoid glyphs that are misread aloud', () => {
  const code = generateDiscountCode(12, () => 0.999999);
  assert.equal(code.length, 12);
  assert.match(code, /^[A-Z0-9]+$/);
  // A code read over a phone must not contain I/O/0/1.
  for (let i = 0; i < 200; i++) {
    assert.doesNotMatch(generateDiscountCode(10, Math.random), /[IO01]/);
  }
});

test('the preview line derives every number from PRICING, never a literal', () => {
  const line = discountPreviewLine({ percentOff: 50 });
  const full = PRICING.monthly.perMonth;             // 25
  const first = (full * 0.5).toFixed(2);             // "12.50"
  assert.ok(line.includes(`$${first}`), line);
  assert.ok(line.includes(`$${full}/mo`), line);
  assert.ok(line.includes('Monthly plan only'), line);
});

test('the preview line refuses nonsense percentages', () => {
  assert.equal(discountPreviewLine({ percentOff: 0 }), null);
  assert.equal(discountPreviewLine({ percentOff: 101 }), null);
  assert.equal(discountPreviewLine({ percentOff: NaN }), null);
});

test('a 100% code reads as free, not as "$0.00"', () => {
  assert.ok(discountPreviewLine({ percentOff: 100 }).includes('free'));
});

test('status: deactivated outranks everything', () => {
  assert.equal(codeStatus({ active: false, times_redeemed: 0, max_redemptions: 1 }), 'revoked');
});

test('status: a used-up code reads expired, not active', () => {
  assert.equal(codeStatus({ active: true, times_redeemed: 1, max_redemptions: 1 }), 'expired');
});

test('status: past its expiry is expired', () => {
  const past = new Date('2020-01-01T00:00:00Z').toISOString();
  assert.equal(codeStatus({ active: true, expires_at: past, times_redeemed: 0 }), 'expired');
});

test('status: uncapped and undated is forever', () => {
  assert.equal(codeStatus({ active: true, times_redeemed: 3, max_redemptions: null, expires_at: null }), 'forever');
});

test('status: capped but unspent is active', () => {
  assert.equal(codeStatus({ active: true, times_redeemed: 0, max_redemptions: 5, expires_at: null }), 'active');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd boards && node --test src/lib/discountCodes.test.mjs
```

Expected: FAIL — `Cannot find module './discountCodes.js'`.

- [ ] **Step 3: Implement**

```javascript
// Pure helpers behind the admin Discounts tab (AdminDiscountsTab.jsx).
//
// These live outside the component for one reason: the house rule that pricing
// numbers are never typed by hand. discountPreviewLine composes the operator's
// preview from PRICING, so a price change in billingCopy.js moves the admin
// copy too — and a test can prove it.

import { PRICING } from './billingCopy.js';

// I/O/0/1 are excluded: a code gets read aloud, and those four are the pairs
// people transcribe wrongly.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeDiscountCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
}

export function generateDiscountCode(len = 8, rand = Math.random) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.min(ALPHABET.length - 1, Math.floor(rand() * ALPHABET.length))];
  }
  return out;
}

const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

// The line under the create form, in the operator's own numbers. It names the
// plan restriction because that is the single most surprising thing about these
// codes — Stripe discounts invoices, not months.
export function discountPreviewLine({ percentOff } = {}) {
  const pct = Number(percentOff);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  const full = PRICING.monthly.perMonth;
  const first = Math.round(full * (1 - pct / 100) * 100) / 100;
  const paid = first === 0 ? 'their first month is free' : `they pay ${money(first)}`;
  return `${pct}% off the first month — ${paid}, then ${money(full)}/mo. Monthly plan only.`;
}

// Maps a Stripe promotion code onto the four lifecycle words StatusPill already
// colours. A used-up code reads 'expired' rather than 'active': Stripe leaves
// active:true on a code nobody can redeem any more, which reads as available.
export function codeStatus(code, now = new Date()) {
  if (!code?.active) return 'revoked';
  const cap = code.max_redemptions;
  const used = code.times_redeemed ?? 0;
  if (Number.isFinite(cap) && cap !== null && used >= cap) return 'expired';
  if (code.expires_at && new Date(code.expires_at).getTime() <= now.getTime()) return 'expired';
  if ((cap === null || cap === undefined) && !code.expires_at) return 'forever';
  return 'active';
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd boards && node --test src/lib/discountCodes.test.mjs && npm test
```

Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add boards/src/lib/discountCodes.js boards/src/lib/discountCodes.test.mjs
git commit -m "$(cat <<'EOF'
The operator's preview of a code is a pricing claim, so it gets a test

discountPreviewLine composes from PRICING rather than literals, so a price
change moves the admin copy too. codeStatus exists because Stripe leaves
active:true on a fully-redeemed code, which reads as available when it is not.
Generated codes skip I/O/0/1 — a code gets read aloud.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The Discounts tab

**Files:**
- Create: `boards/src/pages/admin/AdminDiscountsTab.jsx`
- Modify: `boards/src/pages/AdminPage.jsx` (import, `TABS`, `OVERFLOW_IDS`, render branch, header comment)
- Modify: `boards/src/pages/admin/admin.css` (append the `.admin-discount-*` block)

**Interfaces:**
- Consumes: `admin-discount-action` (Task 4); `discountCodes.js` helpers (Task 5); `discount_redemptions` (Task 2).
- Produces: `<AdminDiscountsTab />`.

- [ ] **Step 1: Write the component**

```jsx
// AdminDiscountsTab — create and manage Stripe discount codes.
//
//   • Top: code + percent + max redemptions + expiry + note → Create.
//     A live preview states the real outcome in the operator's own numbers.
//   • Bottom: every promotion code with its redemption count, and per-row
//     Deactivate (undo-able — Stripe cannot delete a code, only deactivate it).
//
// Stripe is the source of truth for the codes; only redemption attribution is
// ours (discount_redemptions, 0274), because Stripe detaches a `once` discount
// after the first invoice and forgets who used it.
//
// Codes apply to the MONTHLY plan only. That is enforced in
// create-checkout-session, which withholds Checkout's promo field on annual —
// see promoCodesAllowedForPlan. The form says so because it is the single most
// surprising thing about these codes.

import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { CopyableText } from '../../components/CopyableText.jsx';
import { fmtDate, formatCount, formatExpires } from '../../lib/adminFormat.js';
import {
  codeStatus,
  discountPreviewLine,
  generateDiscountCode,
  normalizeDiscountCode,
} from '../../lib/discountCodes.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { StatusPill } from './AdminPills.jsx';
import { Tag } from '../../lib/icons.js';

const FN_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-discount-action';

async function discountAction(payload) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function AdminDiscountsTab() {
  const feedback = useFeedback();

  const [code, setCode]       = useState('');
  const [percent, setPercent] = useState('50');
  const [maxUses, setMaxUses] = useState('1');
  const [expires, setExpires] = useState('');
  const [note, setNote]       = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId]   = useState(null);

  const preview = useMemo(() => discountPreviewLine({ percentOff: percent }), [percent]);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    // Codes come from Stripe; redemptions from our own ledger. Neither can
    // stand in for the other — Stripe knows the count, we know the people.
    const [listed, reds] = await Promise.all([
      discountAction({ action: 'list' }),
      supabase
        .from('discount_redemptions')
        .select('stripe_promotion_code_id, user_id, plan, redeemed_at')
        .order('redeemed_at', { ascending: false })
        .limit(500),
    ]);
    if (reds.error) throw reds.error;
    return { codes: listed.codes || [], redemptions: reds.data || [] };
  }, []);

  const codes = data?.codes || [];
  const redemptions = data?.redemptions || [];

  const stats = useMemo(() => {
    const counted = codes.map((c) => codeStatus(c));
    return {
      active:   counted.filter((s) => s === 'active' || s === 'forever').length,
      redeemed: codes.reduce((n, c) => n + (c.times_redeemed || 0), 0),
      expired:  counted.filter((s) => s === 'expired').length,
      revoked:  counted.filter((s) => s === 'revoked').length,
    };
  }, [codes]);

  const onCreate = async (e) => {
    e?.preventDefault?.();
    const clean = normalizeDiscountCode(code);
    if (clean.length < 3) {
      feedback.toast({ type: 'info', message: 'Enter a code of at least 3 letters or digits.' });
      return;
    }
    if (!preview) {
      feedback.toast({ type: 'info', message: 'Percent off must be between 1 and 100.' });
      return;
    }
    const uses = maxUses.trim() === '' ? null : Number(maxUses);
    if (uses !== null && (!Number.isInteger(uses) || uses < 1)) {
      feedback.toast({ type: 'info', message: 'Max redemptions must be a whole number, or blank for unlimited.' });
      return;
    }

    const ok = await feedback.confirm({
      title: `Create ${clean}?`,
      message: `${preview}\n\n${uses === null ? 'Unlimited redemptions.' : `Usable ${uses} time${uses === 1 ? '' : 's'}.`}`
        + '\n\nA code cannot be edited once created — only deactivated.',
      confirmLabel: 'Create code',
    });
    if (!ok) return;

    setCreating(true);
    try {
      await discountAction({
        action: 'create',
        code: clean,
        percent_off: Number(percent),
        max_redemptions: uses,
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        note: note.trim() || null,
      });
      feedback.toast({ type: 'success', message: `${clean} created` });
      setCode(''); setNote(''); setExpires('');
      await refresh();
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Create failed: ' + (ex?.message || ex) });
    } finally {
      setCreating(false);
    }
  };

  // Deactivate is reversible, so it gets the undo toast rather than a
  // confirm — matching the house convention for destructive-looking actions.
  const onSetActive = async (row, active) => {
    setBusyId(row.id);
    try {
      await discountAction({ action: 'set_active', promotion_code_id: row.id, active });
      await refresh();
      feedback.toast({
        type: 'success',
        message: active ? `${row.code} reactivated` : `${row.code} deactivated`,
        action: active ? undefined : {
          label: 'Undo',
          onClick: async () => {
            try {
              await discountAction({ action: 'set_active', promotion_code_id: row.id, active: true });
              await refresh();
            } catch (ex) {
              feedback.toast({ type: 'error', message: 'Undo failed: ' + (ex?.message || ex) });
            }
          },
        },
      });
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Failed: ' + (ex?.message || ex) });
    } finally {
      setBusyId(null);
    }
  };

  const redeemedBy = (promoId) => redemptions.filter((r) => r.stripe_promotion_code_id === promoId).length;

  return (
    <div className="admin-section">

      {!loading && !error && (
        <div className="admin-stat-grid">
          <AdminStatCard label="Active"   value={formatCount(stats.active)}   sub="redeemable now" />
          <AdminStatCard label="Redeemed" value={formatCount(stats.redeemed)} sub="all time" />
          <AdminStatCard label="Expired"  value={formatCount(stats.expired)}  sub="used up or lapsed" />
          <AdminStatCard label="Inactive" value={formatCount(stats.revoked)}  sub="deactivated" />
        </div>
      )}

      {/* ===== Create ===== */}
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Create a code</h3>
          <span className="admin-chart-sub t-meta">
            Discounts the first month on the monthly plan. Annual checkouts are not offered a code field.
          </span>
        </header>

        <form onSubmit={onCreate} className="admin-discount-form">
          <div className="admin-discount-row">
            <label className="admin-discount-field">
              <span className="t-meta admin-muted">Code</span>
              <div className="admin-discount-code-input">
                <input
                  className="auth-input"
                  type="text"
                  placeholder="LAUNCH50"
                  value={code}
                  onChange={(e) => setCode(normalizeDiscountCode(e.target.value))}
                  aria-label="Discount code"
                />
                <button type="button" className="admin-action" onClick={() => setCode(generateDiscountCode())}>
                  Generate
                </button>
              </div>
            </label>

            <label className="admin-discount-field admin-discount-field-narrow">
              <span className="t-meta admin-muted">Percent off</span>
              <input className="auth-input" type="number" min="1" max="100"
                     value={percent} onChange={(e) => setPercent(e.target.value)} aria-label="Percent off" />
            </label>

            <label className="admin-discount-field admin-discount-field-narrow">
              <span className="t-meta admin-muted">Max uses</span>
              <input className="auth-input" type="number" min="1" placeholder="∞"
                     value={maxUses} onChange={(e) => setMaxUses(e.target.value)} aria-label="Max redemptions" />
            </label>

            <label className="admin-discount-field admin-discount-field-narrow">
              <span className="t-meta admin-muted">Expires</span>
              <input className="auth-input" type="date"
                     value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Expiry date" />
            </label>
          </div>

          <div className="admin-discount-controls">
            <input className="auth-input admin-discount-note" type="text" placeholder="note (optional)"
                   value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="submit" className="admin-action admin-action-primary" disabled={creating || code.length < 3}>
              {creating ? 'Creating…' : 'Create code'}
            </button>
          </div>

          {preview && <p className="admin-discount-preview t-meta">{preview}</p>}
        </form>
      </section>

      {/* ===== List ===== */}
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Codes</h3>
          <span className="admin-chart-sub t-meta">
            Live from Stripe. A code cannot be edited or deleted once created — only deactivated.
          </span>
        </header>

        <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated} />

        <AdminAsync
          loading={loading}
          error={error}
          onRetry={refresh}
          skeleton={<AdminSkeleton variant="table" rows={5} cols={7} />}
          isEmpty={codes.length === 0}
          empty={{
            icon: Tag,
            title: 'No discount codes yet',
            body: 'Create one above. It will apply to the first month on the monthly plan.',
          }}
        >
          <table className={`admin-table admin-discounts-table ${refreshing ? 'is-refreshing' : ''}`}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Status</th>
                <th>Redeemed</th>
                <th>Expires</th>
                <th>Created</th>
                <th>Note</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const status = codeStatus(c);
                const ledger = redeemedBy(c.id);
                return (
                  <tr key={c.id}>
                    <td><CopyableText value={c.code} className="admin-discount-code" /></td>
                    <td>{c.percent_off ? `${c.percent_off}% first month` : '—'}</td>
                    <td><StatusPill kind={status} /></td>
                    <td className="admin-muted"
                        title={ledger !== (c.times_redeemed ?? 0)
                          ? `Stripe counts ${c.times_redeemed ?? 0}; our ledger holds ${ledger}. Redemptions before the ledger existed are not attributable.`
                          : undefined}>
                      {formatCount(c.times_redeemed ?? 0)}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}
                    </td>
                    <td className="admin-muted">{c.expires_at ? formatExpires(c.expires_at) : '—'}</td>
                    <td className="admin-muted" title={c.created_by || ''}>{fmtDate(c.created)}</td>
                    <td className="admin-muted admin-discounts-note" title={c.note || ''}>{c.note || ''}</td>
                    <td className="admin-actions">
                      <button
                        className={`admin-action ${c.active ? 'admin-action-danger' : ''}`}
                        disabled={busyId === c.id}
                        onClick={() => onSetActive(c, !c.active)}
                        title={c.active ? 'Stop this code being redeemed' : 'Allow this code again'}
                      >
                        {busyId === c.id ? '…' : c.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminAsync>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into AdminPage**

In `boards/src/pages/AdminPage.jsx`:

1. Add to the header comment block, after the `//   • Grants` line:

```
//   • Discounts — create / deactivate Stripe discount codes (monthly only)
```

2. Add the import beside the other tab imports:

```javascript
import { AdminDiscountsTab } from './admin/AdminDiscountsTab.jsx';
```

3. Add to `TABS`, immediately after the `grants` entry:

```javascript
  { id: 'discounts', label: 'Discounts' },
```

4. In `OVERFLOW_IDS`, insert `'discounts'` immediately **before** `'grants'` so the two sit adjacent and `OVERFLOW_SEP_AFTER = 'grants'` keeps its divider position:

```javascript
const OVERFLOW_IDS = ['discover', 'templates', 'feedback', 'errors', 'api', 'scout', 'emails', 'discounts', 'grants', 'campaign', 'tagging', 'universe'];
```

5. Add the render branch after the `grants` line:

```jsx
        {tab === 'discounts' && <AdminDiscountsTab />}
```

- [ ] **Step 3: Add the styles**

Append to `boards/src/pages/admin/admin.css`:

```css
/* ── Discounts tab ─────────────────────────────────────────────────────── */
.admin-discount-form { display: flex; flex-direction: column; gap: 12px; }
.admin-discount-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
.admin-discount-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 220px; min-width: 0; }
.admin-discount-field-narrow { flex: 0 0 120px; }
.admin-discount-code-input { display: flex; gap: 8px; align-items: center; }
.admin-discount-code-input .auth-input { flex: 1 1 auto; min-width: 0; text-transform: uppercase; letter-spacing: 0.06em; }
.admin-discount-controls { display: flex; gap: 12px; align-items: center; }
.admin-discount-note { flex: 1 1 auto; min-width: 0; }
.admin-discount-preview { margin: 0; color: var(--ink-2); }
.admin-discount-code { font-variant-numeric: tabular-nums; letter-spacing: 0.06em; }
.admin-discounts-note { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 4: Verify in the running app**

```bash
cd boards && npm run dev
```

Open `/admin?tab=discounts` signed in as an admin and confirm:
- The tab renders, reachable from the **More** menu, sitting next to Grants.
- Typing `75` into Percent off changes the preview line's numbers live.
- **Generate** fills a code containing no `I`, `O`, `0` or `1`.
- Creating a code makes it appear in the table with `Redeemed 0 / 1`.
- Deactivating shows a toast with a working **Undo**.
- Creating the same code string twice reports *already in use*, not a raw 500.

- [ ] **Step 5: Run the full test suite**

```bash
cd boards && npm test
```

Expected: PASS. `docsite.test.mjs` should stay green — admin tabs are not part of the public-surface gate (it extracts the *Settings* `TABS`, not `AdminPage`'s). **If it goes red, do not run `docs:accept`** — read what it says moved and understand it first.

- [ ] **Step 6: Commit**

```bash
git add boards/src/pages/admin/AdminDiscountsTab.jsx boards/src/pages/AdminPage.jsx boards/src/pages/admin/admin.css
git commit -m "$(cat <<'EOF'
Discount codes lived in the Stripe Dashboard, and their redemptions nowhere

A Discounts tab next to Grants — the two are siblings, one comps access and
one sells it cheaper. Codes are read live from Stripe so a count cannot drift
from a mirror; the people behind those counts come from discount_redemptions.

Deactivate gets the undo toast rather than a confirm, because Stripe cannot
delete a promotion code and the action is genuinely reversible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Public docs

**Files:**
- Modify: `boards/content/docs/account/plans.md`
- Regenerate: `boards/src/lib/docsite*.js`, `boards/public/docs/**`, `boards/public/llms*.txt`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add the section**

Append to `boards/content/docs/account/plans.md`, before any closing/related-links block. Do **not** type a price — `{{fact:priceMonthly}}` resolves at build time from `billingCopy.js`.

```markdown
## Discount codes

If you have a discount code, enter it at checkout — the payment page has an
**Add promotion code** field. The discount comes off your first month.

Codes apply to the **monthly** plan only. The annual plan is already discounted
against paying monthly, so the checkout for it does not offer a code field.
```

Then add an FAQ entry to the `faq:` block at the top of the same file:

```yaml
  - q: Where do I enter a discount code?
    a: On the payment page, under Add promotion code. Codes apply to the monthly plan only and come off your first month.
```

- [ ] **Step 2: Regenerate and check**

```bash
cd boards && npm run docs:build && npm run docs:check
```

Expected: `docs:check` reports artifacts current. If it reports a diff, `docs:build` did not run or did not finish — rerun it.

- [ ] **Step 3: Full suite**

```bash
cd boards && npm test
```

Expected: PASS.

If `docsite.test.mjs` now reports a moved surface hash, that is a real signal — the docs page changed but the *extracted* surface should not have. Read the list of what moved before doing anything. Only run `npm run docs:accept` if the move is explained and the pages are already updated; running it to silence the test defeats the mechanism.

- [ ] **Step 4: Commit**

```bash
git add boards/content/docs/account/plans.md boards/src/lib/docsite*.js boards/public/docs boards/public/llms.txt boards/public/llms-full.txt
git commit -m "$(cat <<'EOF'
A code field that only appears on one plan needs saying out loud

Documents where a discount code goes and why the annual checkout has no field
for one. The price stays a {{fact:priceMonthly}} placeholder so it cannot drift
from billingCopy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification before promotion

Do not promote until all of these hold. Production is the `production` branch, promoted by cherry-picking in an isolated worktree — pushing `main` only builds a preview.

- [ ] `cd boards && npm test` — green, including `docsite.test.mjs`.
- [ ] `cd boards && npm run docs:check` — artifacts current.
- [ ] Task 3 Step 5 was actually performed, and the `discount_redemptions` row was observed. This is the one step whose omission is invisible until it is too late to fix.
- [ ] An annual Stripe Checkout page renders no promotion-code field.
- [ ] Migration 0274 verified applied (Task 2 Step 3), with `anon_can_select = false`.
- [ ] Both edge functions deployed; `admin-discount-action` returns 403 to a non-admin.

**Promotion notes specific to this stack:**

- The **DB and edge functions are shared between preview and production.** Migration 0274 and both function deploys are live for production users the moment they are applied — before any branch is promoted. The git promotion is therefore **client-only** for this stack, and the backend half needs no separate deploy step.
- Copy `boards/.env.local` into the promote worktree **before** `vite build`, or the signed-in app is dead-code-eliminated. Gate on `AppShell` ≈ 490–570 KB, never ~54 KB.
- Marker greps for the dist walk — `AdminDiscountsTab` and `codeStatus` are function names and get minified. Use string literals that survive terser: `"Add promotion code"` is not ours, so prefer **`Monthly plan only`**, **`No discount codes yet`**, and **`admin-discount-preview`** (a class name, unmangled).
- Negative control: **`allow_promotion_codes`** must not appear as a bare `!0` alongside the annual path — better, assert the retired string is gone by confirming the new copy is present in `AppShell`.
