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

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import Stripe from "npm:stripe@17.7.0";
import {
  activationDecision,
  mirrorFieldsFromSubscription,
  netMonthlyFromSubscription as netMonthlyCore,
  periodEndFromSubscription as periodEndCore,
  subscriptionItems,
} from "./activateCore.mjs";

type Admin = ReturnType<typeof createClient>;

// Which Stripe item is the plan and which is extra storage (activateCore
// subscriptionItems). Products first; the price ids are the fallback for a
// project whose secrets name no products yet.
export interface BillingConfig {
  creatorProduct: string | null;
  storageProduct: string | null;
  creatorPrices: { monthly: string | null; annual: string | null };
  storagePrices: { monthly: string | null; annual: string | null };
}

export function billingConfig(): BillingConfig {
  const env = (k: string) => Deno.env.get(k) || null;
  return {
    creatorProduct: env("STRIPE_PRODUCT_CREATOR"),
    storageProduct: env("STRIPE_PRODUCT_STORAGE"),
    creatorPrices: { monthly: env("STRIPE_PRICE_MONTHLY"), annual: env("STRIPE_PRICE_ANNUAL") },
    storagePrices: { monthly: env("STRIPE_PRICE_STORAGE_MONTHLY"), annual: env("STRIPE_PRICE_STORAGE_ANNUAL") },
  };
}

// The whole subscriptions row for an observation of `sub`, for every mirror
// writer. `observedAt` is when the caller STARTED the Stripe read that
// produced `sub` — taken before the request, so a read that raced a change
// can only look older than it is, never newer. The mirror guard (0415)
// discards a write older than the stored one.
export function mirrorRow(
  sub: Stripe.Subscription,
  args: { userId: string; customerId: string; observedAt: string; subscriptionId?: string | null },
): Record<string, unknown> {
  return {
    user_id: args.userId,
    stripe_customer_id: args.customerId,
    stripe_subscription_id: args.subscriptionId ?? sub.id ?? null,
    ...mirrorFieldsFromSubscription(sub as unknown as Record<string, unknown>, billingConfig()),
    observed_at: args.observedAt,
    updated_at: new Date().toISOString(),
  };
}

// An item that is neither the configured Creator plan nor extra storage — a
// price changed in Stripe ahead of the secrets, or an item added by hand. It
// still counts as the plan (activateCore never demotes for it); the operator
// hears about it here. Best-effort, never throws.
export async function flagUnknownItems(admin: Admin, userId: string, sub: Stripe.Subscription, source: string) {
  try {
    const { unknown } = subscriptionItems(sub as unknown as Record<string, unknown>, billingConfig()) as {
      unknown: Array<{ price?: { id?: string; product?: unknown } }>;
    };
    if (!unknown.length) return;
    const ins = await admin.from("analytics_events").insert({
      user_id: userId,
      event: "billing_flag",
      props: {
        kind: "unknown_subscription_item",
        subscription_id: sub.id,
        prices: unknown.map((i) => i.price?.id ?? null),
        source,
      },
      path: `/${source}`,
    });
    if (ins.error) console.warn("[activate] unknown-item flag insert failed", ins.error.message);
  } catch (e) {
    console.warn("[activate] unknown-item flag threw", (e as Error)?.message || String(e));
  }
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
    // When the caller started the Stripe read that produced `subscription`.
    observedAt: string;
  },
): Promise<ActivateResult> {
  const { userId, customerId, subscription } = args;
  const decision = activationDecision(subscription as unknown as Record<string, unknown> | null, billingConfig());
  if (!subscription) {
    return { activated: false, soft: true, reason: decision.reason ?? "no_subscription" };
  }

  const row = mirrorRow(subscription, {
    userId, customerId, observedAt: args.observedAt, subscriptionId: args.subscriptionId,
  });
  const plan = row.plan as "monthly" | "annual" | null;
  const status = subscription.status;
  const currentPeriodEnd = row.current_period_end as string | null;

  const up = await admin.from("subscriptions").upsert(row, { onConflict: "user_id" });
  if (up.error) return { activated: false, reason: `subscriptions upsert failed: ${up.error.message}` };
  await flagUnknownItems(admin, userId, subscription, "activate");

  if (!decision.live) {
    return { activated: false, soft: true, reason: decision.reason ?? undefined, plan, currentPeriodEnd };
  }

  // Don't downgrade admins. Returning rows is just for diagnostics.
  const tierUpdate = await admin.from("profiles")
    .update({ tier: "paid" })
    .eq("user_id", userId)
    .neq("tier", "admin");
  if (tierUpdate.error) return { activated: false, reason: `tier flip failed: ${tierUpdate.error.message}` };

  // The Creator trial is one per account, and the fact that it happened is
  // stamped HERE — the first time a subscription for this user is seen in
  // status 'trialing' — not when the checkout session was created. Bouncing
  // at Stripe's card form must not burn the one offer; starting the trial
  // must. `.is(null)` keeps the first timestamp; a failed stamp is logged and
  // does not fail activation (create-checkout-session also asks Stripe whether
  // the customer ever trialed, so a lost stamp is not a second trial).
  if (status === "trialing") {
    const stamp = await admin.from("profiles")
      .update({ creator_trial_started_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("creator_trial_started_at", null);
    if (stamp.error) console.warn("[activate] creator_trial_started_at stamp failed", stamp.error.message);
  }

  return { activated: true, plan, currentPeriodEnd };
}
