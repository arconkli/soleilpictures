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

  // Meta CAPI Purchase. The payment is real regardless of whether our DB tier
  // flip succeeded, so emit even if activation reported a soft failure. Keyed on
  // session.id so it dedups against verify-checkout-session's Purchase, the
  // browser pixel Purchase on the success page, and Stripe webhook retries.
  // fbp/fbc/IP/UA were captured at checkout-start and stashed in session.metadata
  // by create-checkout-session.
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

  // Surface DB failures as a 500 AFTER the CAPI emit so Stripe retries the
  // event instead of treating the lost write as delivered (emitCapi dedups
  // on session.id across retries, so the emit stays single-counted).
  if (!result.activated) throw new Error(`activation failed: ${result.reason}`);
}

async function onSubscriptionUpdated(admin: ReturnType<typeof createClient>, sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await resolveUserId(admin, customerId, sub.metadata?.supabase_user_id, null);
  if (!userId) return;

  // Re-retrieve with discounts expanded so the captured net amount reflects any
  // promo (the event payload may carry discounts as bare ids). Best-effort.
  let full = sub;
  try { full = await stripe.subscriptions.retrieve(sub.id, { expand: ["discounts"] }); } catch (_) { /* use event copy */ }

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

// Best-effort: pull a user_id out of any Stripe event so the audit
// log can correlate to our user model. Returns null when the event
// doesn't carry an identifiable customer (e.g., setup_intent events
// that happen pre-checkout).
async function extractUserIdFromEvent(admin: ReturnType<typeof createClient>, event: Stripe.Event): Promise<string | null> {
  const obj = event.data?.object as Record<string, unknown> | undefined;
  if (!obj) return null;
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
