// stripe-webhook — POST endpoint Stripe calls on subscription events.
//
// Handles:
//   • checkout.session.completed       → flip tier=paid, insert subscription
//   • customer.subscription.updated    → mirror status / period
//   • customer.subscription.deleted    → flip tier=demo, mark canceled
//   • invoice.payment_failed           → log only (Stripe retries)
//
// Configure this function as "no JWT required" in Supabase Edge Function
// settings so Stripe can reach it unauthenticated. The Stripe signature
// header is the auth boundary — we verify it before doing anything.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY      = Deno.env.get("STRIPE_SECRET_KEY")!;
const WEBHOOK_SECRET  = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

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

function planFromPriceId(priceId: string | undefined): "monthly" | "annual" | null {
  if (!priceId) return null;
  const monthly = Deno.env.get("STRIPE_PRICE_MONTHLY");
  const annual  = Deno.env.get("STRIPE_PRICE_ANNUAL");
  if (priceId === monthly) return "monthly";
  if (priceId === annual)  return "annual";
  return null;
}

async function resolveUserId(
  admin: ReturnType<typeof createClient>,
  customerId: string,
  metadataUserId: string | null | undefined,
  emailFallback: string | null,
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  const existing = await admin.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  if (existing.data?.user_id) return existing.data.user_id;
  if (emailFallback) {
    const r = await admin.rpc("user_id_by_email", { p_email: emailFallback.toLowerCase() });
    if (!r.error && r.data) return r.data as string;
  }
  return null;
}

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

  // Fetch subscription details (line items, status, period end).
  let plan: "monthly" | "annual" | null = null;
  let status: string | null = null;
  let currentPeriodEnd: string | null = null;
  if (subId) {
    const sub = await stripe.subscriptions.retrieve(subId);
    plan = planFromPriceId(sub.items.data[0]?.price?.id);
    status = sub.status;
    currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
  }

  await admin.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subId ?? null,
    plan,
    status,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  // Flip tier — but don't downgrade admins.
  await admin.from("profiles")
    .update({ tier: "paid" })
    .eq("user_id", userId)
    .neq("tier", "admin");
}

async function onSubscriptionUpdated(admin: ReturnType<typeof createClient>, sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await resolveUserId(admin, customerId, sub.metadata?.supabase_user_id, null);
  if (!userId) return;

  const plan = planFromPriceId(sub.items.data[0]?.price?.id);
  await admin.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    plan,
    status: sub.status,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  // Active subs → ensure tier='paid' (unless admin).
  if (sub.status === "active" || sub.status === "trialing") {
    await admin.from("profiles").update({ tier: "paid" }).eq("user_id", userId).neq("tier", "admin");
  }
  // Past-due / unpaid → leave tier as-is, the cancel event will drop them.
}

async function onSubscriptionDeleted(admin: ReturnType<typeof createClient>, sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await resolveUserId(admin, customerId, sub.metadata?.supabase_user_id, null);
  if (!userId) return;

  await admin.from("subscriptions").update({
    status: "canceled",
    cancel_at_period_end: false,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);

  // Drop tier to demo (existing data preserved per spec; cap re-enforced on adds).
  await admin.from("profiles").update({ tier: "demo" }).eq("user_id", userId).eq("tier", "paid");
}
