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
// Only a genuinely live subscription may flip tier='paid'.
export function activationDecision(subscription) {
  if (!subscription) return { live: false, reason: "no_subscription" };
  const s = subscription.status;
  if (s === "active" || s === "trialing") return { live: true, reason: null };
  return { live: false, reason: `subscription_not_live:${s}` };
}

export function planFromPriceId(priceId, priceIds) {
  if (!priceId) return null;
  if (priceId === priceIds?.monthly) return "monthly";
  if (priceId === priceIds?.annual) return "annual";
  return null;
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
// CURRENTLY-RECURRING discounts applied. A 'once' coupon is ignored because it
// only affects the first invoice — it doesn't recur, so it shouldn't reduce
// MRR. Used so a 100%-off comp counts as $0 and a 50%-off counts as half,
// instead of the flat list price. Returns {null,null} on any anomaly so
// activation never breaks; callers fall back to the list-price estimate in
// admin_stats.
//
// NOTE: pass a subscription retrieved with `expand: ['discounts']` so each
// applied discount carries its Coupon object (percent_off / amount_off /
// duration). Unexpanded discount ids are skipped.
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
    let primary = null;
    for (const d of list) {
      if (!d || typeof d === "string") continue; // unexpanded id — can't read coupon
      const coupon = d.coupon;
      if (!coupon) continue;
      if (coupon.duration === "once") continue; // first invoice only — doesn't recur
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
          coupon: coupon.id ?? coupon.name ?? null,
          name: coupon.name ?? null,
          percent_off: coupon.percent_off ?? null,
          amount_off: coupon.amount_off ?? null,
          duration: coupon.duration ?? null,
          ...(coupon.duration === "repeating"
            ? { duration_in_months: coupon.duration_in_months ?? null }
            : {}),
          ...(currencyMismatch ? { currency_mismatch: coupon.currency } : {}),
          promotion_code: d.promotion_code ?? null,
        };
      }
    }

    return { monthlyAmountCents: Math.max(0, Math.round(net)), discount: primary };
  } catch (_e) {
    return { monthlyAmountCents: null, discount: null };
  }
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
