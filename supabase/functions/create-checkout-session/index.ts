// create-checkout-session — POST { plan: 'monthly'|'annual' }
//
// Requires Bearer auth (the user OTP-verified at signup). Returns a
// Stripe-hosted Checkout URL for the requested plan, billed in
// subscription mode. The Stripe customer is auto-created on first
// checkout if one doesn't exist yet for this email.
//
// Success URL → APP_URL/pricing/success?session_id={CHECKOUT_SESSION_ID}
// Cancel URL  → APP_URL/pricing

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY      = Deno.env.get("STRIPE_SECRET_KEY")!;
const PRICE_MONTHLY   = Deno.env.get("STRIPE_PRICE_MONTHLY")!;
const PRICE_ANNUAL    = Deno.env.get("STRIPE_PRICE_ANNUAL")!;
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

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return json({ error: "auth required" }, 401);

  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const u = await userClient.auth.getUser();
  if (u.error || !u.data.user?.email) return json({ error: "invalid token" }, 401);

  const email  = u.data.user.email.toLowerCase().trim();
  const userId = u.data.user.id;

  let plan: string;
  try {
    const body = await req.json();
    plan = body.plan;
  } catch { return json({ error: "invalid json" }, 400); }

  const price = plan === "monthly" ? PRICE_MONTHLY
              : plan === "annual"  ? PRICE_ANNUAL
              : null;
  if (!price) return json({ error: "plan must be 'monthly' or 'annual'" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Reuse an existing Stripe customer if we have one mapped to this user, and
  // read its status so we can short-circuit already-subscribed users.
  const existingSub = await admin.from("subscriptions")
    .select("stripe_customer_id, status")
    .eq("user_id", userId)
    .maybeSingle();
  const prof = await admin.from("profiles").select("tier").eq("user_id", userId).maybeSingle();

  let customerId = existingSub.data?.stripe_customer_id ?? null;
  if (!customerId) {
    // Also check Stripe directly by email so we don't end up with dupe customers.
    const found = await stripe.customers.list({ email, limit: 1 });
    if (found.data.length > 0) customerId = found.data[0].id;
  }

  // Already-subscribed backstop: never create a second subscription for a user
  // who already has an active/trialing one (or is already on a paid/admin tier).
  // Send them to the Customer Portal instead so they manage the plan they have.
  const hasActiveSub = ["active", "trialing"].includes(existingSub.data?.status ?? "");
  const alreadyPaid  = hasActiveSub || ["paid", "admin"].includes(prof.data?.tier ?? "");
  if (alreadyPaid) {
    if (!customerId) return json({ error: "already_subscribed" }, 409);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/settings/billing`,
    });
    return json({ ok: true, mode: "portal", url: portal.url }, 200);
  }

  if (!customerId) {
    const created = await stripe.customers.create({
      email,
      metadata: { supabase_user_id: userId },
    });
    customerId = created.id;
  }

  const successUrl = `${APP_URL}/pricing/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `${APP_URL}/pricing`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: successUrl,
    cancel_url:  cancelUrl,
    allow_promotion_codes: true,
    client_reference_id: userId,
    metadata: { supabase_user_id: userId, plan },
    subscription_data: {
      metadata: { supabase_user_id: userId, plan },
    },
  });

  return json({ ok: true, url: session.url }, 200);
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
