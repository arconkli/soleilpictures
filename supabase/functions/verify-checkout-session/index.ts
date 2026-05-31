// verify-checkout-session — POST { session_id }
//
// Server-side activation fallback. The PricingSuccess page calls this on
// mount (and again on Retry) with the Stripe Checkout Session id passed in
// the success URL. We retrieve the session from Stripe and, if it's truly
// paid, run the same activation path as the stripe-webhook. This makes
// activation robust to webhook outages, signing-secret rotations, and any
// future API-version drift.
//
// Auth: requires Bearer user JWT. We compare session.metadata.supabase_user_id
// to the caller's id so one user can't activate another's checkout.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { activateUserFromSubscription } from "../_shared/activate.ts";
import { emitCapi } from "../_shared/meta-capi.ts";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY      = Deno.env.get("STRIPE_SECRET_KEY")!;
const APP_URL         = Deno.env.get("APP_URL") || "";

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  // Wrap the whole body so any throw (e.g. subscriptions.retrieve) returns a
  // real JSON error WITH CORS headers, not a bare runtime 500 the browser
  // mislabels as a CORS failure.
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return json({ error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const u = await userClient.auth.getUser();
    if (u.error || !u.data.user?.id) return json({ error: "invalid token" }, 401);
    const callerId = u.data.user.id;

    let sessionId: string;
    try {
      const body = await req.json();
      sessionId = String(body.session_id || "");
    } catch { return json({ error: "invalid json" }, 400); }
    if (!sessionId.startsWith("cs_")) return json({ error: "session_id required" }, 400);

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    } catch (e) {
      return json({ activated: false, reason: `stripe retrieve failed: ${(e as Error).message}` }, 200);
    }

    // Owner check — session.metadata.supabase_user_id is set by create-checkout-session.
    // client_reference_id is also set as a backup. Either must match the caller.
    const ownerId = (session.metadata?.supabase_user_id as string | undefined)
      || (session.client_reference_id as string | null)
      || null;
    if (ownerId && ownerId !== callerId) {
      return json({ activated: false, reason: "session does not belong to caller" }, 403);
    }

    if (session.payment_status !== "paid" || session.status !== "complete") {
      return json({
        activated: false,
        reason: "not_paid_yet",
        payment_status: session.payment_status,
        status: session.status,
      }, 200);
    }

    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (!customerId) return json({ activated: false, reason: "no customer on session" }, 200);

    const subscription = typeof session.subscription === "string"
      ? await stripe.subscriptions.retrieve(session.subscription, { expand: ["discounts"] })
      : (session.subscription as Stripe.Subscription | null);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const result = await activateUserFromSubscription(admin, {
      userId: callerId,
      customerId,
      subscription,
      subscriptionId: subscription?.id ?? null,
    });

    // Meta CAPI Purchase — same event_id (session.id) as the stripe-webhook
    // Purchase and the browser pixel Purchase below, so Meta collapses all three
    // into one conversion. Match params were stashed in session.metadata at
    // checkout-start. We reach here only for genuinely-paid sessions; $0-promo
    // checkouts (no_payment_required) are emitted by the webhook instead.
    if (result.activated) {
      const m = session.metadata ?? {};
      emitCapi({
        eventName: "Purchase",
        eventId: session.id,
        eventSourceUrl: APP_URL ? `${APP_URL}/pricing/success` : undefined,
        userData: {
          email: u.data.user.email ?? null,
          externalId: callerId,
          fbp: m.fbp ?? null,
          fbc: m.fbc ?? null,
          clientIpAddress: m.client_ip ?? null,
          clientUserAgent: m.client_ua ?? null,
        },
        customData: {
          currency: (session.currency || "usd").toUpperCase(),
          value: (session.amount_total ?? 0) / 100,
          plan: m.plan ?? result.plan ?? null,
          subscription_id: subscription?.id ?? null,
        },
      });
    }

    return json({
      activated: result.activated,
      reason: result.reason ?? null,
      plan: result.plan ?? null,
      current_period_end: result.currentPeriodEnd ?? null,
      // For the deduped browser Purchase on the success page (same event_id).
      amount_total: session.amount_total ?? null,
      currency: session.currency ?? null,
    }, result.activated ? 200 : 500);
  } catch (e) {
    console.error("[verify-checkout-session] error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
