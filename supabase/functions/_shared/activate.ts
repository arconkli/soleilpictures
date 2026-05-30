// Shared activation logic — runs from both:
//   • stripe-webhook (checkout.session.completed event from Stripe)
//   • verify-checkout-session (server-side fallback called by PricingSuccess)
//
// Both paths converge here so the upsert + tier flip stay in lockstep. The
// flip is idempotent: upsert on user_id, tier='paid' is a no-op if already paid.

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

type Admin = ReturnType<typeof createClient>;

export function planFromPriceId(priceId: string | undefined): "monthly" | "annual" | null {
  if (!priceId) return null;
  const monthly = Deno.env.get("STRIPE_PRICE_MONTHLY");
  const annual  = Deno.env.get("STRIPE_PRICE_ANNUAL");
  if (priceId === monthly) return "monthly";
  if (priceId === annual)  return "annual";
  return null;
}

// Stripe API versions ≥2025-09-30 moved current_period_end from the subscription
// object onto each item. Read both so we don't throw "Invalid Date" if the
// account's pinned API version rolls forward.
export function periodEndFromSubscription(sub: Stripe.Subscription): string | null {
  const epoch = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end
    ?? null;
  return epoch ? new Date(epoch * 1000).toISOString() : null;
}

export async function resolveUserId(
  admin: Admin,
  customerId: string,
  metadataUserId: string | null | undefined,
  emailFallback: string | null,
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  const existing = await admin.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  if (existing.data?.user_id) return existing.data.user_id as string;
  if (emailFallback) {
    const r = await admin.rpc("user_id_by_email", { p_email: emailFallback.toLowerCase() });
    if (!r.error && r.data) return r.data as string;
  }
  return null;
}

export interface BillingFromSub {
  monthlyAmountCents: number | null;
  discount: Record<string, unknown> | null;
}

// True net monthly-equivalent recurring revenue for a subscription, with
// CURRENTLY-RECURRING discounts applied. A 'once' coupon is ignored because it
// only affects the first invoice — it doesn't recur, so it shouldn't reduce MRR.
// Used so a 100%-off comp counts as $0 and a 50%-off counts as half, instead of
// the flat list price. Returns {null,null} on any anomaly so activation never
// breaks; callers fall back to the list-price estimate in admin_stats.
//
// NOTE: pass a subscription retrieved with `expand: ['discounts']` so each
// applied discount carries its Coupon object (percent_off / amount_off /
// duration). Unexpanded discount ids are skipped.
export function netMonthlyFromSubscription(sub: Stripe.Subscription | null): BillingFromSub {
  if (!sub) return { monthlyAmountCents: null, discount: null };
  try {
    const perMonth = (amount: number, qty: number, price: Stripe.Price | null | undefined) => {
      const interval = price?.recurring?.interval ?? "month";
      const ic = price?.recurring?.interval_count ?? 1;
      const base = amount * qty;
      if (interval === "year") return base / (12 * ic);
      if (interval === "week") return (base * 52) / 12 / ic;
      if (interval === "day")  return (base * 365) / 12 / ic;
      return base / ic; // month
    };

    let grossMonthly = 0;
    for (const item of sub.items?.data ?? []) {
      grossMonthly += perMonth(item.price?.unit_amount ?? 0, item.quantity ?? 1, item.price);
    }

    // New API exposes `discounts` (array); older one exposes a single `discount`.
    const list: unknown[] = Array.isArray((sub as unknown as { discounts?: unknown[] }).discounts)
      ? (sub as unknown as { discounts: unknown[] }).discounts
      : [];
    const legacy = (sub as unknown as { discount?: unknown }).discount;
    if (legacy && list.length === 0) list.push(legacy);

    const firstPrice = sub.items?.data?.[0]?.price;
    let net = grossMonthly;
    let primary: Record<string, unknown> | null = null;
    for (const d of list) {
      if (!d || typeof d === "string") continue; // unexpanded id — can't read coupon
      const disc = d as { coupon?: Record<string, unknown>; promotion_code?: unknown };
      const coupon = disc.coupon;
      if (!coupon) continue;
      if (coupon.duration === "once") continue; // first invoice only — doesn't recur
      if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
        net = net * (1 - coupon.percent_off / 100);
      } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
        net = net - perMonth(coupon.amount_off as number, 1, firstPrice);
      }
      if (!primary) {
        primary = {
          coupon: coupon.id ?? coupon.name ?? null,
          name: coupon.name ?? null,
          percent_off: coupon.percent_off ?? null,
          amount_off: coupon.amount_off ?? null,
          duration: coupon.duration ?? null,
          promotion_code: disc.promotion_code ?? null,
        };
      }
    }

    return { monthlyAmountCents: Math.max(0, Math.round(net)), discount: primary };
  } catch (_e) {
    return { monthlyAmountCents: null, discount: null };
  }
}

export interface ActivateResult {
  activated: boolean;
  reason?: string;
  plan?: "monthly" | "annual" | null;
  currentPeriodEnd?: string | null;
}

// Upsert subscriptions row + flip tier to paid. Caller is responsible for
// having verified the underlying payment (signed webhook OR Stripe API
// retrieve). Safe to call repeatedly for the same user_id.
export async function activateUserFromSubscription(
  admin: Admin,
  args: {
    userId: string;
    customerId: string;
    subscription: Stripe.Subscription | null;
    subscriptionId?: string | null;
  },
): Promise<ActivateResult> {
  const { userId, customerId, subscription } = args;
  const subId = args.subscriptionId
    ?? (subscription ? subscription.id : null)
    ?? null;

  const plan   = subscription ? planFromPriceId(subscription.items.data[0]?.price?.id) : null;
  const status = subscription ? subscription.status : null;
  const currentPeriodEnd = subscription ? periodEndFromSubscription(subscription) : null;
  const cancelAtPeriodEnd = subscription ? Boolean(subscription.cancel_at_period_end) : false;
  const billing = netMonthlyFromSubscription(subscription);

  const up = await admin.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subId,
    plan,
    status,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: cancelAtPeriodEnd,
    monthly_amount_cents: billing.monthlyAmountCents,
    discount: billing.discount,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (up.error) return { activated: false, reason: `subscriptions upsert failed: ${up.error.message}` };

  // Don't downgrade admins. Returning rows is just for diagnostics.
  const tierUpdate = await admin.from("profiles")
    .update({ tier: "paid" })
    .eq("user_id", userId)
    .neq("tier", "admin");
  if (tierUpdate.error) return { activated: false, reason: `tier flip failed: ${tierUpdate.error.message}` };

  return { activated: true, plan, currentPeriodEnd };
}
