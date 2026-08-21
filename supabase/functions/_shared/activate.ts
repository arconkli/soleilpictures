// Shared activation logic — runs from both:
//   • stripe-webhook (checkout.session.completed event from Stripe)
//   • verify-checkout-session (server-side fallback called by PricingSuccess)
//
// Both paths converge here so the upsert + tier flip stay in lockstep. The
// flip is idempotent: upsert on user_id, tier='paid' is a no-op if already paid.
//
// The pure logic (plan mapping, period-end, MRR math, the liveness gate) lives
// in activateCore.mjs so `node --test` can cover it from boards/ — this file
// keeps only the Deno-specific parts: env access and the supabase writes.

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  activationDecision,
  netMonthlyFromSubscription as netMonthlyCore,
  periodEndFromSubscription as periodEndCore,
  planFromPriceId as planFromPriceIdCore,
} from "./activateCore.mjs";

type Admin = ReturnType<typeof createClient>;

export function planFromPriceId(priceId: string | undefined): "monthly" | "annual" | null {
  return planFromPriceIdCore(priceId, {
    monthly: Deno.env.get("STRIPE_PRICE_MONTHLY"),
    annual: Deno.env.get("STRIPE_PRICE_ANNUAL"),
  }) as "monthly" | "annual" | null;
}

export function periodEndFromSubscription(sub: Stripe.Subscription): string | null {
  return periodEndCore(sub as unknown as Record<string, unknown>);
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

export function netMonthlyFromSubscription(sub: Stripe.Subscription | null): BillingFromSub {
  return netMonthlyCore(sub as unknown as Record<string, unknown> | null) as BillingFromSub;
}

export interface ActivateResult {
  activated: boolean;
  reason?: string;
  // true = the refusal is a final, correct answer (dead/incomplete/absent
  // subscription) — callers must return it to the client / ack the webhook,
  // NOT retry. false/absent on activated:false = a real failure (DB write
  // error) worth a 500 so Stripe retries.
  soft?: boolean;
  plan?: "monthly" | "annual" | null;
  currentPeriodEnd?: string | null;
}

// Upsert subscriptions row + flip tier to paid. Caller is responsible for
// having verified the underlying payment (signed webhook OR Stripe API
// retrieve). Safe to call repeatedly for the same user_id.
//
// The tier flip is gated on the subscription being genuinely LIVE
// (active/trialing — activationDecision in activateCore.mjs). A paid Checkout
// Session stays 'paid' forever, so without this gate an ex-subscriber could
// replay their old success URL into a fresh paid tier, and an async-payment
// (ACH) checkout would grant paid before any money arrived. Non-live
// subscriptions still get their row mirrored (the truth is worth recording);
// a session with NO subscription writes nothing.
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
  const decision = activationDecision(subscription as unknown as Record<string, unknown> | null);
  if (!subscription) {
    return { activated: false, soft: true, reason: decision.reason ?? "no_subscription" };
  }

  const subId = args.subscriptionId ?? subscription.id ?? null;
  const plan = planFromPriceId(subscription.items.data[0]?.price?.id);
  const status = subscription.status;
  const currentPeriodEnd = periodEndFromSubscription(subscription);
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
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

  if (!decision.live) {
    return { activated: false, soft: true, reason: decision.reason ?? undefined, plan, currentPeriodEnd };
  }

  // Don't downgrade admins. Returning rows is just for diagnostics.
  const tierUpdate = await admin.from("profiles")
    .update({ tier: "paid" })
    .eq("user_id", userId)
    .neq("tier", "admin");
  if (tierUpdate.error) return { activated: false, reason: `tier flip failed: ${tierUpdate.error.message}` };

  return { activated: true, plan, currentPeriodEnd };
}
