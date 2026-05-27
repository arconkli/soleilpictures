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

  const up = await admin.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subId,
    plan,
    status,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: cancelAtPeriodEnd,
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
