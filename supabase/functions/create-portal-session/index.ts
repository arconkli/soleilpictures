// create-portal-session — POST (authed) → Stripe Customer Portal URL.
//
// User must be signed in. We look up their stripe_customer_id from
// subscriptions, create a Customer Portal session, and return the URL.
// 404 if no subscription exists (the user hasn't paid yet).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY")!;
const APP_URL      = Deno.env.get("APP_URL") || "";

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

  // Wrap the body so any Stripe/DB throw returns a real JSON error WITH CORS
  // headers (a bare runtime 500 lacks ACAO and the browser mislabels it CORS).
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return json({ error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const u = await userClient.auth.getUser();
    if (u.error || !u.data.user) return json({ error: "invalid token" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const sub = await admin.from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", u.data.user.id)
      .maybeSingle();
    if (sub.error) return json({ error: sub.error.message }, 500);
    if (!sub.data?.stripe_customer_id) return json({ error: "no subscription found" }, 404);

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.data.stripe_customer_id,
      return_url: `${APP_URL}/settings/billing`,
    });

    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    console.error("[create-portal-session] error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
