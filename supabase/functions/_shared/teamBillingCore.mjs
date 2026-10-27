// teamBillingCore — the pure half of the Team plan's billing (S3).
//
// Plain ESM, no Deno APIs, no npm deps, so the same file runs in the edge
// bundle (teamBilling.ts, team-billing, team-billing-cron, stripe-webhook) and
// under `node --test` (boards/src/lib/teamBillingCore.test.mjs), the pattern
// activateCore.mjs set. The functions fetch; this decides. Everything here
// moves money or decides who can edit, so change nothing without a test.
//
// What is sold (owner decisions, docs/superpowers/specs/2026-10-21-team-plan-
// and-editor-limit-design.md): a seat at $25 a month or $240 a year (what
// Creator costs; changed 2026-10-25 from $15/$144), at least 3, self-serve up to 100; a 14-day trial with a card; extra storage in the
// Creator's blocks. A team's subscription lives on the team's OWN Stripe
// customer, stamped soleil_kind = "team" and never with a person's id, so the
// personal billing path (activateCore) can neither see it nor be seen by it.
// The database owns the seat count (organizations.seats, one writer:
// _org_add_seats); Stripe follows it (seatSyncPlan).

import { isStorageItem, isTeamItem, isTeamObject, periodEndFromSubscription } from "./activateCore.mjs";

export { isTeamObject };

export const TEAM_KIND = "team";
export const TEAM_TRIAL_DAYS = 14;
// The most a team buys by itself is organizations.seat_ceiling, the
// database's (support can raise it), so it has no twin here.
export const TEAM_MIN_SEATS = 3;

// What one seat costs, per interval, in the currency's minor unit. The Stripe
// price must say exactly this or checkout refuses (`price_mismatch`): a price
// edited in the dashboard must never charge an amount the page did not show.
// teamModel.js TEAM_SEAT_PRICE states the same figures to the reader;
// teamBillingCore.test.mjs holds the two in lockstep.
export const TEAM_SEAT_UNIT_AMOUNT = { month: 2500, year: 24000 };
export const TEAM_CURRENCY = "usd";

const INTERVAL = { monthly: "month", annual: "year" };

export function teamPriceIdFor(plan, cfg) {
  if (plan === "monthly") return cfg?.teamPrices?.monthly ?? null;
  if (plan === "annual") return cfg?.teamPrices?.annual ?? null;
  return null;
}

// The seat price as Stripe has it, checked before a checkout is made: active,
// licensed per unit, one interval, and exactly TEAM_SEAT_UNIT_AMOUNT.
export function teamPriceMatches(price, plan) {
  const interval = INTERVAL[plan];
  const r = price?.recurring;
  if (!interval || !price || price.active === false || !r) return false;
  if (r.interval !== interval || (r.interval_count ?? 1) !== 1) return false;
  if ((r.usage_type ?? "licensed") !== "licensed") return false;
  if ((price.billing_scheme ?? "per_unit") !== "per_unit") return false;
  return price.currency === TEAM_CURRENCY && price.unit_amount === TEAM_SEAT_UNIT_AMOUNT[interval];
}

function qty(item) {
  const q = Math.trunc(Number(item?.quantity ?? 1));
  return Number.isFinite(q) && q > 0 ? q : 0;
}

// { seat, storage, seatsBilled, storageBlocks }. The seat is found by the
// team product or prices; failing that (a price changed in Stripe ahead of
// the secrets), the first item that is not storage, since a team's
// subscription carries nothing else.
export function teamItems(sub, cfg) {
  const items = (sub?.items?.data ?? []).filter(Boolean);
  const storage = items.filter((i) => isStorageItem(i, cfg));
  const rest = items.filter((i) => !isStorageItem(i, cfg));
  const seat = rest.find((i) => isTeamItem(i, cfg)) ?? rest[0] ?? null;
  let storageBlocks = 0;
  for (const i of storage) storageBlocks += qty(i);
  return { seat, storage, seatsBilled: seat ? qty(seat) : 0, storageBlocks };
}

export function teamPlanFromSubscription(sub, cfg) {
  const seat = teamItems(sub, cfg).seat;
  if (!seat) return null;
  const id = seat.price?.id;
  if (id && id === cfg?.teamPrices?.monthly) return "monthly";
  if (id && id === cfg?.teamPrices?.annual) return "annual";
  const r = seat.price?.recurring;
  if (r && (r.interval_count ?? 1) === 1) {
    if (r.interval === "month") return "monthly";
    if (r.interval === "year") return "annual";
  }
  return null;
}

function isoFromEpoch(epoch) {
  const n = Number(epoch);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

// The Stripe-derived half of an org_subscriptions row (0538). Every writer —
// activation, the webhook, the sync and the sweep — builds its row here, so a
// field added for one cannot be forgotten by another.
export function teamMirrorFields(sub, cfg) {
  const { seatsBilled, storageBlocks } = teamItems(sub, cfg);
  const customer = sub?.customer;
  return {
    stripe_customer_id: typeof customer === "string" ? customer : customer?.id ?? null,
    stripe_subscription_id: sub?.id ?? null,
    plan: teamPlanFromSubscription(sub, cfg),
    status: sub?.status ?? null,
    seats_billed: seatsBilled,
    storage_blocks: storageBlocks,
    current_period_end: periodEndFromSubscription(sub),
    cancel_at_period_end: Boolean(sub?.cancel_at_period_end),
    trial_end: isoFromEpoch(sub?.trial_end),
  };
}

// What syncing a team does to Stripe. The database owns the seats; Stripe
// follows them.
//   closed → cancel the subscription now, refunding nothing (S3 decision 3:
//            Creator's cancel refunds nothing either).
//   seats  → set the seat item's quantity. Going up is charged now, prorated.
//            In a trial nothing is prorated: the first invoice bills the
//            quantity the trial ends with, so seats added in a trial are
//            charged when it converts (the owner's rule), and no $0 invoice
//            is made for each one. Going down credits nothing: seats already
//            paid for stay paid to the period's end.
// No change is pushed to a subscription that can't take one (canceled,
// incomplete, unpaid, paused): a team in that state is view-only, and its
// seats can't change.
const SYNCABLE = new Set(["active", "trialing", "past_due"]);
const ENDED = new Set(["canceled", "incomplete_expired"]);

export function canSyncSeats(status) {
  return SYNCABLE.has(status);
}

export function seatSyncPlan({ desired, billed, status, closed }) {
  if (closed) return !status || ENDED.has(status) ? { action: "none" } : { action: "cancel" };
  if (!SYNCABLE.has(status)) return { action: "none" };
  const d = Math.trunc(Number(desired));
  const b = Math.trunc(Number(billed));
  if (!Number.isFinite(d) || d < TEAM_MIN_SEATS || d === b) return { action: "none" };
  return { action: "update", quantity: d, proration: d > b && status !== "trialing" ? "always_invoice" : "none" };
}

// Unused seats drop at renewal, never below 3 (S3 decision 4: from the first
// renewal on; a trial converts with the seats its buyer chose). The sweep
// trims a team whose paid period ends within TRIM_WINDOW_MS, so the renewal
// invoice already bills the lower count; the window is wider than a day so
// one missed run still trims in time.
export const TRIM_WINDOW_MS = 36 * 3_600_000;

export function trimDue({ status, cancelAtPeriodEnd, periodEnd, now = Date.now() }) {
  if (status !== "active" || cancelAtPeriodEnd) return false;
  const t = typeof periodEnd === "number" ? periodEnd : Date.parse(periodEnd ?? "");
  return Number.isFinite(t) && t > now && t - now <= TRIM_WINDOW_MS;
}

// A trial is about to end: the sweep tells the owner and admins once
// (_team_notify keeps one a day; this window keeps it to the last few days).
export const TRIAL_NOTICE_MS = 3 * 86_400_000;

export function trialEndingSoon({ status, trialEnd, now = Date.now() }) {
  if (status !== "trialing") return false;
  const t = Date.parse(trialEnd ?? "");
  return Number.isFinite(t) && t > now && t - now <= TRIAL_NOTICE_MS;
}

// The Checkout Session for a team: a new one, or a lapsed one paying again
// (orgId). Card always (a trial with a card is the owner's model), no promo
// codes, one hour to finish. Never a client_reference_id: stripe-webhook's
// event log reads that field as a person's id.
export function teamCheckoutParams({
  customerId, priceId, seats, trial, checkoutId, ownerId, orgId = null, successUrl, cancelUrl, nowMs = Date.now(),
}) {
  const metadata = {
    soleil_kind: TEAM_KIND,
    soleil_team_checkout: checkoutId,
    soleil_owner_id: ownerId,
    ...(orgId ? { soleil_org_id: orgId } : {}),
  };
  return {
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: seats }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: Math.floor(nowMs / 1000) + 60 * 60,
    payment_method_collection: "always",
    metadata,
    subscription_data: {
      metadata,
      ...(trial
        ? {
            trial_period_days: TEAM_TRIAL_DAYS,
            // A card is collected above; if a trial ever ends without one, the
            // subscription cancels rather than limping into past_due.
            trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          }
        : {}),
    },
  };
}

// A team's own customer: its name on the invoices, the buyer's email, and no
// person's id (activateCore pickReusableCustomer skips it by soleil_kind).
export function teamCustomerParams({ name, email, ownerId, checkoutId }) {
  return {
    name,
    email,
    metadata: { soleil_kind: TEAM_KIND, soleil_owner_id: ownerId, soleil_team_checkout: checkoutId },
  };
}

// A customer we stored for this owner is reused only while Stripe still says
// it is this owner's team customer.
export function reusableTeamCustomer(customer, ownerId) {
  return Boolean(customer) && !customer.deleted
    && customer.metadata?.soleil_kind === TEAM_KIND
    && customer.metadata?.soleil_owner_id === ownerId;
}

// The team's Customer Portal: card, invoices, billing details, and cancel at
// the period's end. No plan or seat changes there: seats are the team page's,
// so the database stays their one writer.
export const TEAM_PORTAL_TAG = "soleil-team-portal-v1";

export function teamPortalConfiguration(returnUrl) {
  return {
    business_profile: { headline: "Your team's plan on Clusters" },
    default_return_url: returnUrl,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "name", "tax_id"] },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_update: { enabled: false },
    },
    metadata: { soleil: TEAM_PORTAL_TAG },
  };
}

// What adding seats would charge, asked of Stripe before anyone confirms
// (admins see the price first). The apply reuses the preview's proration date,
// so the charge is the amount shown.
export function seatPreviewParams({ customerId, subscriptionId, seatItemId, quantity, prorationDate }) {
  return {
    customer: customerId,
    subscription: subscriptionId,
    subscription_details: {
      items: [{ id: seatItemId, quantity }],
      proration_behavior: "always_invoice",
      proration_date: prorationDate,
    },
  };
}

// Idempotency keys. A sync converges to a seat count, so its key is the count
// and the newest change it bills: a retry, or the trigger and the sweep
// racing, reuse it. A seat add is one admin's click: its key is the request.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function seatSyncKey(orgId, upto, quantity) {
  return `team-seats:${orgId}:${upto ?? 0}:${quantity}`;
}

export function seatAddKey(orgId, requestId) {
  if (!UUID_RE.test(String(requestId || ""))) return null;
  return `team-seats-add:${orgId}:${String(requestId).toLowerCase()}`;
}
