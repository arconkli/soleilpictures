// activateCore — the pure, runtime-neutral half of _shared/activate.ts.
//
// Plain ESM JavaScript, no Deno APIs, no npm deps, so the SAME file runs in
// the Deno edge bundle (activate.ts re-exports thin wrappers) and under the
// repo's `node --test` gate (boards/src/lib/activateCore.test.mjs). Deno tests
// were deliberately NOT adopted: npm test is the only gate this repo runs, and
// a second toolchain it never executes would be untested-by-default code.
//
// Everything here is money- or entitlement-bearing. Change nothing without a
// matching case in activateCore.test.mjs.

// Statuses that mean "this customer already has a subscription that must be
// MANAGED, not doubled" — used by create-checkout-session's Stripe-side
// already-subscribed guard. Deliberately wider than ACTIVATION: a past_due or
// paused sub must not block-free a second checkout into existence, it must
// route to the portal where the existing one can be fixed.
export const LIVE_SUB_STATUSES = ["active", "trialing", "past_due", "unpaid", "paused"];

export function filterLiveSubscriptions(subs) {
  return (subs || []).filter((s) => s && LIVE_SUB_STATUSES.includes(s.status));
}

// The single activation liveness gate, shared by BOTH activation callers
// (stripe-webhook checkout.session.completed and verify-checkout-session).
// A Checkout Session stays payment_status='paid' / status='complete' forever,
// so "the session was paid" is NOT evidence the subscription is alive:
//   - an ex-subscriber revisiting /pricing/success from history replays a paid
//     session whose subscription is long canceled;
//   - an async payment method (ACH) completes checkout with the subscription
//     still 'incomplete' — no money has actually arrived;
//   - a subscription-mode session with no subscription at all is anomalous
//     (out-of-app session) and must never mint a paid tier over a null row.
// Only a genuinely live subscription may flip tier='paid' — and only one that
// is a Creator subscription: since extra storage became its own item
// (2026-10-17), a subscription whose only item is storage is not a plan.
export function activationDecision(subscription, cfg) {
  if (!subscription) return { live: false, reason: "no_subscription" };
  const s = subscription.status;
  if (s !== "active" && s !== "trialing") return { live: false, reason: `subscription_not_live:${s}` };
  if (!subscriptionItems(subscription, cfg).creator) return { live: false, reason: "no_creator_item" };
  return { live: true, reason: null };
}

export function planFromPriceId(priceId, priceIds) {
  if (!priceId) return null;
  if (priceId === priceIds?.monthly) return "monthly";
  if (priceId === priceIds?.annual) return "annual";
  return null;
}

// Which item is which.
// A Creator subscription can carry a second item since 2026-10-17: extra
// storage, sold in blocks (the item's quantity) on a Product of its own. Every
// reader used to take items.data[0] as "the plan", which stops being true the
// moment a second item exists — Stripe promises no item order, and the
// storage price read as an unknown plan. Items are told apart by PRODUCT, with
// the configured price ids as the fallback for a config that names no
// products.
//
// cfg = {
//   creatorProduct, storageProduct,          // prod_… (either may be unset)
//   creatorPrices: { monthly, annual },      // STRIPE_PRICE_MONTHLY / _ANNUAL
//   storagePrices: { monthly, annual },      // STRIPE_PRICE_STORAGE_MONTHLY / _ANNUAL
// }
// With no cfg at all every item is a Creator item, which is what every
// subscription before extra storage was.
function productOf(item) {
  const p = item?.price?.product;
  return typeof p === "string" ? p : p?.id ?? null;
}

function priceIn(item, prices) {
  const id = item?.price?.id;
  return Boolean(id) && [prices?.monthly, prices?.annual].includes(id);
}

export function isStorageItem(item, cfg) {
  if (!item) return false;
  if (cfg?.storageProduct && productOf(item) === cfg.storageProduct) return true;
  return priceIn(item, cfg?.storagePrices);
}

export function isCreatorItem(item, cfg) {
  if (!item || isStorageItem(item, cfg)) return false;
  if (cfg?.creatorProduct && productOf(item) === cfg.creatorProduct) return true;
  return priceIn(item, cfg?.creatorPrices);
}

// { creator, storage, storageBlocks, unknown }.
//   creator  — the item identified as Creator; failing that, the first item
//              that is not storage. A Creator price changed in Stripe ahead of
//              the env must not demote anyone, so an unidentified item still
//              counts as the plan — and is reported in `unknown` so a caller
//              can flag it for the operator.
//   unknown  — items that are neither, but only when cfg names Creator at all;
//              with no ids configured there is nothing to be unknown against.
export function subscriptionItems(sub, cfg) {
  const items = (sub?.items?.data ?? []).filter(Boolean);
  const storage = items.filter((i) => isStorageItem(i, cfg));
  const rest = items.filter((i) => !isStorageItem(i, cfg));
  const creator = rest.find((i) => isCreatorItem(i, cfg)) ?? rest[0] ?? null;
  const configured = Boolean(cfg?.creatorProduct || cfg?.creatorPrices?.monthly || cfg?.creatorPrices?.annual);
  const unknown = configured ? rest.filter((i) => !isCreatorItem(i, cfg)) : [];
  let storageBlocks = 0;
  for (const i of storage) {
    const q = Math.trunc(Number(i.quantity ?? 1));
    if (Number.isFinite(q) && q > 0) storageBlocks += q;
  }
  return { creator, storage, storageBlocks, unknown };
}

// The plan the Creator item is on. The configured price ids win; a Creator
// price they do not name falls back to its billing interval, so a new price
// in Stripe still mirrors as monthly or annual rather than as nothing.
export function planFromSubscription(sub, cfg) {
  const item = subscriptionItems(sub, cfg).creator;
  if (!item) return null;
  const known = planFromPriceId(item.price?.id, cfg?.creatorPrices);
  if (known) return known;
  const r = item.price?.recurring;
  if (r && (r.interval_count ?? 1) === 1) {
    if (r.interval === "month") return "monthly";
    if (r.interval === "year") return "annual";
  }
  return null;
}

// Dunning: who keeps the plan while a payment is failing.
// One rule for every reader (the webhook, the reconcile cron, and the SQL
// twin _subscription_entitles in migration 0415): active and trialing are
// entitled, and past_due is entitled WHILE STRIPE IS STILL RETRYING — the open
// invoice has a next attempt scheduled — for at most PAST_DUE_GRACE_DAYS.
// Until 2026-10-17 the webhook kept a past_due user paid while the nightly
// reconcile demoted them the next morning, so the same account flipped
// between plans for the length of the retry schedule. Everything else
// (unpaid, paused, canceled, incomplete_expired, a past_due Stripe has given up
// on) is not entitled. `incomplete` is never entitled either; it is the state
// before a first payment, so it has nothing to demote.
export const PAST_DUE_GRACE_DAYS = 21;

// Pass a subscription retrieved with expand: ["latest_invoice"], or past_due
// cannot tell "still retrying" from "given up" and falls back to the grace
// window alone.
export function entitlementFromSubscription(sub, { cfg, now = Date.now() } = {}) {
  if (!sub) return { entitled: false, reason: "no_subscription" };
  if (!subscriptionItems(sub, cfg).creator) return { entitled: false, reason: "no_creator_item" };
  const s = sub.status;
  if (s === "active" || s === "trialing") return { entitled: true, reason: null };
  if (s === "past_due") {
    const inv = sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
    if (inv && (inv.status !== "open" || inv.next_payment_attempt == null)) {
      return { entitled: false, reason: "past_due_not_retrying" };
    }
    const since = inv?.created ?? sub.current_period_start ?? null;
    if (since != null && now - since * 1000 > PAST_DUE_GRACE_DAYS * 86_400_000) {
      return { entitled: false, reason: "past_due_beyond_grace" };
    }
    return { entitled: true, reason: "past_due_retrying" };
  }
  return { entitled: false, reason: `subscription_not_live:${s}` };
}

// Statuses that drop a non-entitled account to the free plan (after the
// paid-grant check every demotion makes). `incomplete` is absent on purpose:
// see above.
export function shouldDemote(sub, opts) {
  if (!sub) return false;
  if (entitlementFromSubscription(sub, opts).entitled) return false;
  return ["past_due", "unpaid", "paused", "canceled", "incomplete_expired"].includes(sub.status)
    || !subscriptionItems(sub, opts?.cfg).creator;
}

// The Stripe-derived half of a subscriptions mirror row. Every writer (both
// activation paths, the webhook, the reconcile cron, the admin resync and the
// storage-addon function) builds its row here so a field added for one cannot
// be forgotten by another — which is how storage_blocks would otherwise leak
// between demotion paths.
export function mirrorFieldsFromSubscription(sub, cfg) {
  const billing = netMonthlyFromSubscription(sub);
  return {
    plan: planFromSubscription(sub, cfg),
    status: sub?.status ?? null,
    current_period_end: periodEndFromSubscription(sub),
    cancel_at_period_end: Boolean(sub?.cancel_at_period_end),
    monthly_amount_cents: billing.monthlyAmountCents,
    discount: billing.discount,
    storage_blocks: subscriptionItems(sub, cfg).storageBlocks,
  };
}

// Stripe API versions ≥2025-09-30 moved current_period_end from the
// subscription object onto each item. Read both so we don't throw
// "Invalid Date" if the account's pinned API version rolls forward.
export function periodEndFromSubscription(sub) {
  const epoch = sub?.current_period_end
    ?? sub?.items?.data?.[0]?.current_period_end
    ?? null;
  return epoch ? new Date(epoch * 1000).toISOString() : null;
}

// True net monthly-equivalent recurring revenue for a subscription, with
// CURRENTLY-RECURRING discounts applied. A 'once' coupon does not move the
// figure — it only affects the first invoice, so it doesn't recur — but it IS
// still returned as `discount`, because a first-month promo that goes unrecorded
// is invisible to every downstream readout. Used so a 100%-off comp counts as $0
// and a 50%-off counts as half, instead of the flat list price. Returns
// {null,null} on any anomaly so activation never breaks; callers fall back to
// the list-price estimate in admin_stats.
//
// NOTE: pass a subscription retrieved with `expand: ['discounts']` so each
// applied discount carries its Coupon object (percent_off / amount_off /
// duration). Unexpanded discount ids are skipped.
//
// Every item counts toward the gross, extra storage included, and a recurring
// coupon is taken to apply to all of them. That holds for anything we sell:
// storage-addon refuses a subscription that carries a discount, so the only
// way to meet a coupon beside extra storage is an operator adding one by hand
// (coupon.applies_to is not expanded on these paths).
//
// A 'repeating' coupon is applied — it IS reducing revenue right now — but its
// duration_in_months rides along in the recorded discount so the readout can
// tell a 3-month promo from a forever comp; the figure is "net monthly as of
// this event", not a forecast.
export function netMonthlyFromSubscription(sub) {
  if (!sub) return { monthlyAmountCents: null, discount: null };
  try {
    const perMonth = (amount, qty, price) => {
      const interval = price?.recurring?.interval ?? "month";
      const ic = price?.recurring?.interval_count ?? 1;
      const base = amount * qty;
      if (interval === "year") return base / (12 * ic);
      if (interval === "week") return (base * 52) / 12 / ic;
      if (interval === "day") return (base * 365) / 12 / ic;
      return base / ic; // month
    };

    let grossMonthly = 0;
    for (const item of sub.items?.data ?? []) {
      grossMonthly += perMonth(item.price?.unit_amount ?? 0, item.quantity ?? 1, item.price);
    }

    // New API exposes `discounts` (array); older one exposes a single `discount`.
    const list = Array.isArray(sub.discounts) ? [...sub.discounts] : [];
    const legacy = sub.discount;
    if (legacy && list.length === 0) list.push(legacy);

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
  } catch (_e) {
    return { monthlyAmountCents: null, discount: null };
  }
}

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

// Should a customer.subscription.updated/deleted event write through to the
// single per-user mirror row? The mirror is keyed on user_id, so with two
// subscriptions on one customer (double-checkout race, resubscribe overlap,
// operator cleanup) the events of the WRONG one used to clobber the row —
// a Dashboard-cancel of a duplicate demoted a user whose real sub was live.
// Rules: first write and same-sub writes apply; a DIFFERENT sub applies only
// when the stored one is terminal (a fresher sub legitimately takes over the
// row — the resubscribe path); a deleted event for a sub we don't mirror
// touches nothing.
export function subscriptionEventAction({ kind, eventSubId, storedSubId = null, storedStatus = null }) {
  if (!storedSubId || storedSubId === eventSubId) return "apply";
  if (kind === "updated" && (storedStatus === "canceled" || storedStatus === "incomplete_expired")) return "apply";
  return "skip";
}

// Which of an email-matched customer list may be reused for this user.
// A customer stamped with a DIFFERENT user's id means the email changed hands —
// reusing it would hand this caller the other account's invoices, saved payment
// method, and portal cancel button. An unstamped customer is claimable (we
// stamp it on reuse); a deleted customer is dead.
export function pickReusableCustomer(customers, userId) {
  const list = (customers || []).filter((c) => c && !c.deleted);
  const own = list.find((c) => c.metadata?.supabase_user_id === userId);
  if (own) return { customer: own, needsStamp: false };
  const unclaimed = list.find((c) => !c.metadata?.supabase_user_id);
  if (unclaimed) return { customer: unclaimed, needsStamp: true };
  return null;
}

// The already-subscribed branch decision in create-checkout-session.
// 'portal' requires a VERIFIED-own customer — mirror-sourced or
// metadata-matched — never a bare email match, or the portal button becomes a
// window into a stranger's billing.
export function decideCheckoutRoute({ liveSubCount = 0, mirrorStatus = null, tier = null, hasVerifiedCustomer = false } = {}) {
  const alreadyPaid = liveSubCount > 0
    || ["active", "trialing"].includes(mirrorStatus ?? "")
    || ["paid", "admin"].includes(tier ?? "");
  if (!alreadyPaid) return "checkout";
  return hasVerifiedCustomer ? "portal" : "already_subscribed";
}
