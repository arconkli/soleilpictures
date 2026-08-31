// stripe-webhook — POST endpoint Stripe calls on subscription events.
//
// Handles:
//   • checkout.session.completed       → flip tier=paid, insert subscription
//   • customer.subscription.updated    → mirror status / period / cancel-pending
//   • customer.subscription.deleted    → flip tier=demo, mark canceled
//   • invoice.payment_failed           → log only (Stripe retries)
//
// Must be deployed with verify_jwt=false (see supabase/config.toml) so Stripe
// can reach it without a Supabase user JWT. The Stripe signature header is
// the auth boundary — we verify it before doing anything.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  activateUserFromSubscription,
  netMonthlyFromSubscription,
  periodEndFromSubscription,
  planFromPriceId,
  resolveUserId,
} from "../_shared/activate.ts";
import { filterLiveSubscriptions, subscriptionEventAction } from "../_shared/activateCore.mjs";
import { emitCapi } from "../_shared/meta-capi.ts";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY      = Deno.env.get("STRIPE_SECRET_KEY")!;
const WEBHOOK_SECRET  = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const APP_URL         = Deno.env.get("APP_URL") || "";

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Durable audit log — every Stripe event we receive, even ones we don't
  // act on. Unique (stripe_id) flags replays/retries; we still process them
  // (handlers are idempotent and the checkout path re-checks live
  // subscription status) so a 500-then-retry still completes. Note that
  // supabase-js reports failures via .error, not by throwing.
  try {
    const logged = await admin.from("stripe_webhook_events").insert({
      stripe_id: event.id,
      type: event.type,
      user_id: await extractUserIdFromEvent(admin, event),
      payload: event as unknown as Record<string, unknown>,
    });
    if (logged.error) {
      if ((logged.error as { code?: string }).code === "23505") {
        console.log("[stripe-webhook] replay/retry of", event.id, event.type);
      } else {
        console.warn("[stripe-webhook] event log insert failed", logged.error.message);
      }
    }
  } catch (e) {
    console.warn("[stripe-webhook] event log insert threw", (e as Error)?.message || String(e));
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(admin, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
        await onSubscriptionUpdated(admin, event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await onSubscriptionDeleted(admin, event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        console.warn("[stripe] invoice.payment_failed", (event.data.object as Stripe.Invoice).id);
        break;
      case "charge.refunded":
        await onChargeTrouble(admin, event.data.object as Stripe.Charge, "refund");
        break;
      case "charge.dispute.created":
        await onChargeTrouble(admin, event.data.object as Stripe.Dispute, "dispute");
        break;
      default:
        // Ignore other events but return 200 so Stripe doesn't retry.
        break;
    }
  } catch (e) {
    console.error("[stripe-webhook] handler error", event.type, e);
    return new Response("handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

async function onCheckoutCompleted(admin: ReturnType<typeof createClient>, session: Stripe.Checkout.Session) {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) return;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const email = session.customer_details?.email || session.customer_email || null;
  const metaUid = (session.metadata?.supabase_user_id as string | undefined) || (session.client_reference_id as string | null);
  const userId = await resolveUserId(admin, customerId, metaUid, email);
  if (!userId) {
    console.warn("[stripe] checkout.session.completed: no user", { customerId, email });
    return;
  }

  // Expand discounts so we can record the real net amount (100%-off → $0).
  const subscription = subId ? await stripe.subscriptions.retrieve(subId, { expand: ["discounts"] }) : null;

  // Replay guard: Stripe (or an operator re-send) can deliver an old
  // checkout.session.completed long after the subscription was canceled.
  // Activating from the stale event would silently re-grant paid tier —
  // trust the subscription's LIVE status, not the event.
  if (subscription && (subscription.status === "canceled" || subscription.status === "incomplete_expired")) {
    console.warn("[stripe] skipping activation: subscription no longer live", { userId, subId, status: subscription.status });
    return;
  }

  const result = await activateUserFromSubscription(admin, {
    userId,
    customerId,
    subscription,
    subscriptionId: subId ?? null,
  });

  // A soft refusal (dead/incomplete/absent subscription — activateCore's
  // liveness gate) is a final, correct answer: no paid tier yet, so no
  // Purchase conversion either, and a 200 so Stripe stops retrying. For an
  // async payment (ACH) the customer.subscription.updated → active event will
  // activate and the invoice-side conversion follows the money.
  if (!result.activated && result.soft) {
    console.warn("[stripe] activation refused", { userId, subId, reason: result.reason });
    return;
  }

  // Durable discount-redemption record. Same reasoning as the Purchase emit
  // below: past the soft-refusal return the payment is real, so the redemption
  // is real and worth recording even if our own tier flip later fails.
  await recordDiscountRedemption(admin, { session, subscription, userId, subId: subId ?? null });

  // Meta CAPI Purchase. The payment is real regardless of whether our DB tier
  // flip succeeded, so emit even on a HARD activation failure (DB write error).
  // Keyed on session.id so it dedups against verify-checkout-session's
  // Purchase, the browser pixel Purchase on the success page, and Stripe
  // webhook retries. fbp/fbc/IP/UA were captured at checkout-start and stashed
  // in session.metadata by create-checkout-session.
  const m = session.metadata ?? {};
  emitCapi({
    eventName: "Purchase",
    eventId: session.id,
    eventSourceUrl: APP_URL ? `${APP_URL}/pricing/success` : undefined,
    userData: {
      email,
      externalId: userId,
      fbp: m.fbp ?? null,
      fbc: m.fbc ?? null,
      clientIpAddress: m.client_ip ?? null,
      clientUserAgent: m.client_ua ?? null,
    },
    customData: {
      currency: (session.currency || "usd").toUpperCase(),
      value: (session.amount_total ?? 0) / 100,
      plan: m.plan ?? null,
      subscription_id: subId ?? null,
    },
  });

  // First-party conversion analytics (subscription_started) — server-side so a
  // buyer who never lands back on /pricing/success still counts (the client
  // checkout_* events miss that path entirely). Deduped on the checkout
  // session id so Stripe retries / operator re-sends stay single-counted.
  // Best-effort: an analytics failure must never fail the webhook.
  try {
    const seen = await admin.from("analytics_events")
      .select("id").eq("event", "subscription_started")
      .eq("props->>session_id", session.id).limit(1);
    if (!seen.error && !(seen.data?.length)) {
      const ins = await admin.from("analytics_events").insert({
        user_id: userId,
        event: "subscription_started",
        props: {
          plan: m.plan ?? result.plan ?? null,
          amount_total_cents: session.amount_total ?? null,
          currency: (session.currency || "usd"),
          session_id: session.id,
          source: "stripe_webhook",
        },
        path: "/stripe-webhook",
      });
      if (ins.error) console.warn("[stripe-webhook] subscription_started insert failed", ins.error.message);
    }
  } catch (e) {
    console.warn("[stripe-webhook] subscription_started insert threw", (e as Error)?.message || String(e));
  }

  // Surface DB failures as a 500 AFTER the CAPI emit so Stripe retries the
  // event instead of treating the lost write as delivered (emitCapi dedups
  // on session.id across retries, so the emit stays single-counted).
  if (!result.activated) throw new Error(`activation failed: ${result.reason}`);
}

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
      if (!d || typeof d === "string") continue; // unexpanded id
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

    if (!couponId) return; // no discount on this checkout — nothing to record

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

async function onSubscriptionUpdated(admin: ReturnType<typeof createClient>, sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await resolveUserId(admin, customerId, sub.metadata?.supabase_user_id, null);
  if (!userId) return;

  // The mirror is one row per user — only the subscription it tracks (or a
  // successor to a terminal one) may write through, or two subs on one
  // customer flip-flop the row and the wrong one's status drives the tier.
  const stored = await admin.from("subscriptions")
    .select("stripe_subscription_id, status").eq("user_id", userId).maybeSingle();
  if (stored.error) throw new Error(`stored sub read failed: ${stored.error.message}`);
  const action = subscriptionEventAction({
    kind: "updated",
    eventSubId: sub.id,
    storedSubId: (stored.data?.stripe_subscription_id as string | undefined) ?? null,
    storedStatus: (stored.data?.status as string | undefined) ?? null,
  });
  if (action === "skip") {
    console.warn("[stripe] updated for non-mirrored subscription — skipped", { userId, eventSub: sub.id });
    return;
  }

  // Re-retrieve with discounts expanded so the captured net amount reflects
  // any promo (the event payload carries discounts as bare id strings).
  // MANDATORY, not best-effort: writing the event copy on retrieve failure
  // meant a stale retried `updated(active)` could re-grant paid tier to a
  // canceled user forever, and discounted subs recorded list-price MRR.
  // A throw here 500s and Stripe retries — same contract as onCheckoutCompleted.
  const full = await stripe.subscriptions.retrieve(sub.id, { expand: ["discounts"] });

  const plan = planFromPriceId(full.items.data[0]?.price?.id);
  const billing = netMonthlyFromSubscription(full);
  const up = await admin.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: full.id,
    plan,
    status: full.status,
    current_period_end: periodEndFromSubscription(full),
    cancel_at_period_end: full.cancel_at_period_end,
    monthly_amount_cents: billing.monthlyAmountCents,
    discount: billing.discount,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (up.error) throw new Error(`subscriptions upsert failed: ${up.error.message}`);

  // Active subs → ensure tier='paid' (unless admin).
  if (full.status === "active" || full.status === "trialing") {
    const flip = await admin.from("profiles").update({ tier: "paid" }).eq("user_id", userId).neq("tier", "admin");
    if (flip.error) throw new Error(`tier flip failed: ${flip.error.message}`);
  }
  // Past-due / unpaid → leave tier as-is, the cancel event will drop them.
}

// charge.refunded / charge.dispute.created — money went backwards. Policy
// (decided 2026-08-21): if the customer still has a live subscription this is
// a partial/goodwill refund — flag only. If nothing is live, drop the tier
// (grant check first, same contract as the deleted path) and flag. Clawback of
// referral rewards stays a manual operator call — the billing_flag row is the
// pointer. NOTE: these events reach us only if the Stripe webhook endpoint is
// subscribed to them (operator checklist).
async function onChargeTrouble(
  admin: ReturnType<typeof createClient>,
  obj: Stripe.Charge | Stripe.Dispute,
  kind: "refund" | "dispute",
) {
  let charge: Stripe.Charge | null;
  if (kind === "dispute") {
    const d = obj as Stripe.Dispute;
    const chargeId = typeof d.charge === "string" ? d.charge : d.charge?.id ?? null;
    charge = chargeId ? await stripe.charges.retrieve(chargeId) : null;
  } else {
    charge = obj as Stripe.Charge;
  }
  const customerId = typeof charge?.customer === "string" ? charge.customer : charge?.customer?.id;
  if (!customerId) {
    console.warn("[stripe] charge trouble with no customer", { kind, charge: charge?.id });
    return;
  }
  const userId = await resolveUserId(admin, customerId, null, null);

  const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  const live = filterLiveSubscriptions(subs.data as unknown as Array<{ status: string }>);
  // A partial refund never demotes — the charge object says whether the FULL
  // amount went back (charge.refunded flips true only then).
  const fullReversal = kind === "dispute" || charge?.refunded === true;

  let action = "flag_only";
  if (userId && fullReversal && live.length === 0) {
    const grantQ = await admin.rpc("user_has_active_paid_grant", { p_user_id: userId });
    if (grantQ.error) throw new Error(`grant check failed: ${grantQ.error.message}`);
    if (grantQ.data === true) {
      action = "grant_kept";
    } else {
      const demote = await admin.from("profiles").update({ tier: "demo" }).eq("user_id", userId).eq("tier", "paid");
      if (demote.error) throw new Error(`tier demote failed: ${demote.error.message}`);
      action = "demoted";
    }
  }

  console.warn("[stripe] charge trouble", { kind, action, userId, customerId, charge: charge?.id, liveSubs: live.length });
  // Operator-review pointer — best-effort, never fails the webhook.
  try {
    const ins = await admin.from("analytics_events").insert({
      user_id: userId,
      event: "billing_flag",
      props: {
        kind,
        action,
        charge_id: charge?.id ?? null,
        customer_id: customerId,
        amount_cents: (kind === "dispute" ? (obj as Stripe.Dispute).amount : charge?.amount_refunded) ?? null,
        currency: charge?.currency ?? null,
        live_subs: live.length,
      },
      path: "/stripe-webhook",
    });
    if (ins.error) console.warn("[stripe-webhook] billing_flag insert failed", ins.error.message);
  } catch (e) {
    console.warn("[stripe-webhook] billing_flag insert threw", (e as Error)?.message || String(e));
  }
}

// Best-effort: pull a user_id out of any Stripe event so the audit
// log can correlate to our user model. Returns null when the event
// doesn't carry an identifiable customer (e.g., setup_intent events
// that happen pre-checkout).
async function extractUserIdFromEvent(admin: ReturnType<typeof createClient>, event: Stripe.Event): Promise<string | null> {
  const obj = event.data?.object as Record<string, unknown> | undefined;
  if (!obj) return null;
  // Our own sessions/subscriptions carry the uid in metadata (and sessions in
  // client_reference_id too) — prefer it. The customer-map fallback below only
  // works once a subscriptions row exists, which by construction excludes the
  // most important row of all: the first checkout.session.completed.
  const metaUid = (obj.metadata as Record<string, string> | undefined)?.supabase_user_id
    || (typeof obj.client_reference_id === "string" ? obj.client_reference_id : undefined);
  if (metaUid) return metaUid;
  const customerId = (typeof obj.customer === "string") ? obj.customer
                  : (obj.customer as { id?: string } | undefined)?.id;
  if (!customerId) return null;
  try {
    const r = await admin.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    return (r.data?.user_id as string | undefined) || null;
  } catch (_) {
    return null;
  }
}

async function onSubscriptionDeleted(admin: ReturnType<typeof createClient>, sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await resolveUserId(admin, customerId, sub.metadata?.supabase_user_id, null);
  if (!userId) return;

  // Only the subscription the mirror tracks may cancel-and-demote. A deleted
  // event for a DIFFERENT sub (a cleaned-up duplicate, a redelivered event
  // from before a resubscribe) used to mark the row canceled and demote a
  // user whose real subscription was alive and billing.
  const stored = await admin.from("subscriptions")
    .select("stripe_subscription_id, status").eq("user_id", userId).maybeSingle();
  if (stored.error) throw new Error(`stored sub read failed: ${stored.error.message}`);
  const action = subscriptionEventAction({
    kind: "deleted",
    eventSubId: sub.id,
    storedSubId: (stored.data?.stripe_subscription_id as string | undefined) ?? null,
    storedStatus: (stored.data?.status as string | undefined) ?? null,
  });
  if (action === "skip") {
    console.warn("[stripe] deleted for non-mirrored subscription — skipped", { userId, eventSub: sub.id });
    return;
  }

  const cancelUpd = await admin.from("subscriptions").update({
    status: "canceled",
    cancel_at_period_end: false,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  if (cancelUpd.error) throw new Error(`subscription cancel write failed: ${cancelUpd.error.message}`);

  // Don't drop to demo if the user still has an active admin grant —
  // their paid access comes from the grant, independent of Stripe. A
  // transient RPC failure must NOT demote a grant-holder: bail to 500 and
  // let Stripe retry rather than guessing.
  const grantQ = await admin.rpc("user_has_active_paid_grant", { p_user_id: userId });
  if (grantQ.error) throw new Error(`grant check failed: ${grantQ.error.message}`);
  if (grantQ.data === true) return;

  // Drop tier to demo (existing data preserved per spec; cap re-enforced on adds).
  const demote = await admin.from("profiles").update({ tier: "demo" }).eq("user_id", userId).eq("tier", "paid");
  if (demote.error) throw new Error(`tier demote failed: ${demote.error.message}`);
}
