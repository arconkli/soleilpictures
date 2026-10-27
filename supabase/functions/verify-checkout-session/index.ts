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
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import Stripe from "npm:stripe@17.7.0";
import { activateUserFromSubscription } from "../_shared/activate.ts";
import { emitCapi, gpcFrom } from "../_shared/meta-capi.ts";
import { failedWith, reportEdgeError, reported } from "../_shared/reportError.ts";
import { earlyAnswer, settle, tokenClaims } from "../_shared/earlyReads.mjs";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
// Never fall back to the service-role key here: with no Authorization header
// on the request, the apikey alone selects the role, and a missing anon key
// would silently make this "user" client SERVICE ROLE. Supabase injects
// SUPABASE_ANON_KEY into every edge function, so this only fires on a broken deploy.
if (!ANON_KEY) throw new Error("SUPABASE_ANON_KEY is not set; refusing to fall back to the service-role key");
const STRIPE_KEY      = Deno.env.get("STRIPE_SECRET_KEY")!;
const APP_URL         = Deno.env.get("APP_URL") || "";

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

Deno.serve(reported("verify-checkout-session", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  // Wrap the whole body so any throw (e.g. subscriptions.retrieve) returns a
  // real JSON error WITH CORS headers, not a bare runtime 500 the browser
  // mislabels as a CORS failure.
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return json({ error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // The session id is in the body, which is already here, so Stripe is asked
    // about the session beside getUser instead of after it: the buyer is
    // watching the success page wait for this answer. Only for a signed-in
    // user's token (_shared/earlyReads.mjs), and nothing it returns is used
    // before getUser has answered and the owner check below has run. The
    // body's errors still answer after the token's, as they always have.
    let sessionId = "";
    let badBody = false;
    try {
      const body = await req.json();
      sessionId = String(body.session_id || "");
    } catch { badBody = true; }
    // Before the read: the subscription arrives expanded on the session.
    const observedAt = new Date().toISOString();
    const early = !badBody && sessionId.startsWith("cs_") && tokenClaims(token)
      ? settle(stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] }))
      : null;

    const u = await userClient.auth.getUser();
    if (u.error || !u.data.user?.id) return json({ error: "invalid token" }, 401);
    const callerId = u.data.user.id;
    if (badBody) return json({ error: "invalid json" }, 400);
    if (!sessionId.startsWith("cs_")) return json({ error: "session_id required" }, 400);

    let session: Stripe.Checkout.Session;
    try {
      session = early
        ? await earlyAnswer(early)
        : await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    } catch (e) {
      // A session id nobody made is the caller's; anything else is ours.
      void reportEdgeError("verify-checkout-session", {
        what: "stripe checkout.sessions.retrieve", error: e, request: req,
        ...((e as { code?: string })?.code === "resource_missing" ? { severity: "warning" } : {}),
      });
      return json({ activated: false, reason: `stripe retrieve failed: ${(e as Error).message}` }, 200);
    }

    // A Team checkout (S3) is the team's: team-billing's verify activates it.
    // It carries neither owner field below, so it would fail the owner check
    // anyway; this says why, and keeps it so if that ever changes.
    if (session.metadata?.soleil_kind === "team") {
      return json({ activated: false, reason: "team_session" }, 409);
    }

    // Owner check — session.metadata.supabase_user_id is set by create-checkout-session.
    // client_reference_id is also set as a backup. Either must match the caller.
    // A session with NEITHER is not ours (Dashboard payment link, foreign
    // integration) and must never activate the caller off someone else's
    // payment — requiring a non-null owner also keeps the caller's row from
    // being cross-wired to a foreign stripe_customer_id, which would route all
    // of that customer's future webhook events onto this user.
    const ownerId = (session.metadata?.supabase_user_id as string | undefined)
      || (session.client_reference_id as string | null)
      || null;
    if (!ownerId || ownerId !== callerId) {
      return json({ activated: false, reason: "session does not belong to caller" }, 403);
    }

    // "Settled", not "paid". A TRIAL checkout collects a card and charges
    // nothing, so Stripe settles it with amount_total 0 and payment_status
    // 'no_payment_required' — and this gate used to reject exactly that, which
    // made the whole webhook-outage fallback inert for the one kind of checkout
    // that collects no money. If the webhook were lost, a trialing customer
    // would sit on the free tier until Stripe charged them a fortnight later.
    // The 100%-off promo checkout settles the same way.
    //
    // Nothing is loosened by this: activateUserFromSubscription still refuses
    // anything whose subscription is not active or trialing, so a replayed old
    // session and an unfunded ACH checkout are rejected exactly as before.
    const settled = session.payment_status === "paid"
                 || session.payment_status === "no_payment_required";
    if (!settled || session.status !== "complete") {
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
      observedAt,
    });

    // Meta CAPI Purchase — same event_id (session.id) as the stripe-webhook
    // Purchase and the browser pixel Purchase below, so Meta collapses all three
    // into one conversion. Match params were stashed in session.metadata at
    // checkout-start. $0 sessions (a trial, or a 100%-off promo) reach here too
    // now; the emit is harmless because it shares eventId: session.id with the
    // webhook's Purchase and the browser pixel, so Meta collapses all three.
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
        // GPC at checkout (stamped by create-checkout-session), or now.
        optOut: m.gpc === "1" || gpcFrom(req),
      });
    }

    const answer = json({
      activated: result.activated,
      reason: result.reason ?? null,
      plan: result.plan ?? null,
      current_period_end: result.currentPeriodEnd ?? null,
      // For the deduped browser Purchase on the success page (same event_id).
      amount_total: session.amount_total ?? null,
      currency: session.currency ?? null,
      // soft refusals (dead/incomplete/absent subscription) are final, correct
      // answers — 200 so the client shows the reason instead of retrying; 500
      // stays reserved for real failures (DB write errors) worth a retry.
    }, result.activated || result.soft ? 200 : 500);
    // A real failure (the database refused a write): by its first words,
    // which name the write, never the row.
    return result.activated || result.soft
      ? answer
      : failedWith(answer, new Error(String(result.reason || "failed").split(":")[0]), { what: "activate" });
  } catch (e) {
    console.error("[verify-checkout-session] error", e);
    return failedWith(json({ error: String((e as Error)?.message ?? e) }, 500), e);
  }
}));

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
