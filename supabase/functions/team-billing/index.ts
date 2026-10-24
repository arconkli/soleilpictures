// team-billing — POST (signed in): a team's plan (S3).
//
//   { action: "checkout", name, color, workspace_ids, seats, plan, end_creator?, org_id?, return_origin? }
//                                         → a Stripe Checkout URL (org_id: a lapsed team paying again)
//   { action: "verify", session_id }       → the success page finishing the checkout, if the webhook hasn't
//   { action: "portal", org_id, return_origin? }       → the team's Customer Portal (the owner only)
//   { action: "seats_preview", org_id, seats }         → what buying up to `seats` costs today
//   { action: "seats_add", org_id, seats, request_id, proration_date? } → buy them, at the price shown
//   { action: "sync", org_id }             → put the team's seats on Stripe now (after an admin's other seat adds)
//
// Who may do what is the database's: start_team_checkout, get_team_billing and
// set_team_seats run as the caller (0538), and Stripe is asked only after they
// agree. `seats` is always the TOTAL wanted, so a retried request can't buy
// twice. Never a client_reference_id or a person's id on a team's Stripe
// objects: the personal billing path must never see a team's payment.
//
// Dark until the owner creates the Team prices and sets STRIPE_PRICE_TEAM_MONTHLY
// and STRIPE_PRICE_TEAM_ANNUAL (with STRIPE_PRODUCT_TEAM): until then every call
// answers 404 not_available. And while teams stay closed, start_team_checkout
// refuses everyone (teams_closed).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import Stripe from "npm:stripe@17.7.0";
import { billingConfig } from "../_shared/activate.ts";
import { prorationAmount, prorationDateOk } from "../_shared/storageAddonCore.mjs";
import {
  TEAM_PORTAL_TAG,
  isTeamObject,
  reusableTeamCustomer,
  seatAddKey,
  seatPreviewParams,
  teamCheckoutParams,
  teamCustomerParams,
  teamItems,
  teamPortalConfiguration,
  teamPriceIdFor,
  teamPriceMatches,
} from "../_shared/teamBillingCore.mjs";
import { completeTeamCheckout, syncTeam, teamBillingReady, teamFlag } from "../_shared/teamBilling.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
// Never fall back to the service-role key (see create-portal-session).
if (!ANON_KEY) throw new Error("SUPABASE_ANON_KEY is not set; refusing to fall back to the service-role key");
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const APP_URL    = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
// Where else Stripe may send the buyer back to (the preview host, for a test
// owner): exact origins, comma-separated. Anything else returns to APP_URL.
const RETURN_ORIGINS = (Deno.env.get("TEAM_RETURN_ORIGINS") || "")
  .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

type Body = Record<string, unknown>;
type PgError = { code?: string; message?: string; hint?: string; details?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return json({ error: "auth required" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const u = await userClient.auth.getUser();
    if (u.error || !u.data.user) return json({ error: "invalid token" }, 401);
    const user = u.data.user;

    let body: Body;
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

    const cfg = billingConfig();
    if (!teamBillingReady(cfg)) return json({ error: "not_available" }, 404);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    switch (body.action) {
      case "checkout":      return await checkout(userClient, admin, user, body);
      case "verify":        return await verify(admin, user.id, body);
      case "portal":        return await portal(admin, user.id, body);
      case "seats_preview": return await seatsPreview(userClient, admin, body);
      case "seats_add":     return await seatsAdd(userClient, admin, body);
      case "sync":          return await sync(userClient, admin, body);
      default:              return json({ error: "bad_request" }, 400);
    }
  } catch (e) {
    if (e instanceof Stripe.errors.StripeIdempotencyError) return json({ error: "retry" }, 409);
    if (e instanceof Stripe.errors.StripeError) {
      console.error("[team-billing] stripe error", e.type, e.code, e.message);
      return json({ error: "stripe_error", code: e.code ?? null }, 502);
    }
    console.error("[team-billing] error", e);
    return json({ error: "server_error" }, 500);
  }
});

type Client = ReturnType<typeof createClient>;

async function checkout(userClient: Client, admin: Client, user: { id: string; email?: string }, body: Body) {
  const cfg = billingConfig();
  const start = await userClient.rpc("start_team_checkout", {
    p_name: typeof body.name === "string" ? body.name : null,
    p_color: typeof body.color === "string" ? body.color : null,
    p_workspace_ids: Array.isArray(body.workspace_ids) ? body.workspace_ids.filter((x) => typeof x === "string" && UUID_RE.test(x)) : [],
    p_seats: Number.isInteger(body.seats) ? body.seats : null,
    p_plan: typeof body.plan === "string" ? body.plan : null,
    p_end_creator: body.end_creator === true,
    p_org_id: typeof body.org_id === "string" && UUID_RE.test(body.org_id) ? body.org_id : null,
  });
  if (start.error) return refusal(start.error as PgError);
  const ck = start.data as {
    checkout_id: string; kind: "new" | "renew"; org_id: string | null; name: string;
    seats: number; plan: "monthly" | "annual"; trial: boolean; customer_id: string | null;
  };

  // The price must say exactly what the page shows (teamBillingCore).
  const priceId = teamPriceIdFor(ck.plan, cfg);
  const price = priceId ? await stripe.prices.retrieve(priceId) : null;
  if (!teamPriceMatches(price, ck.plan)) {
    await teamFlag(admin, user.id, { kind: "team_price_mismatch", plan: ck.plan, price_id: priceId }, "/team-billing");
    return json({ error: "price_mismatch" }, 503);
  }

  // The team's own customer: the one this checkout's team (or an abandoned
  // checkout of this owner's) already has, while Stripe still says it is.
  let customerId: string | null = null;
  if (ck.customer_id) {
    try {
      const c = await stripe.customers.retrieve(ck.customer_id);
      const usable = ck.kind === "renew"
        ? !(c as Stripe.DeletedCustomer).deleted && isTeamObject(c)
        : reusableTeamCustomer(c, user.id);
      if (usable) customerId = c.id;
    } catch (e) {
      if (!(e instanceof Stripe.errors.StripeInvalidRequestError)) throw e;
    }
  }
  if (!customerId) {
    const c = await stripe.customers.create(
      teamCustomerParams({ name: ck.name, email: user.email ?? undefined, ownerId: user.id, checkoutId: ck.checkout_id }),
      { idempotencyKey: `team-customer:${ck.checkout_id}` },
    );
    customerId = c.id;
  }

  const origin = returnOrigin(body.return_origin);
  const session = await stripe.checkout.sessions.create(teamCheckoutParams({
    customerId,
    priceId: priceId!,
    seats: ck.seats,
    trial: ck.trial,
    checkoutId: ck.checkout_id,
    ownerId: user.id,
    orgId: ck.org_id,
    successUrl: `${origin}/team?checkout={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/team?checkout=canceled`,
  }), { idempotencyKey: `team-checkout:${ck.checkout_id}` });

  const up = await admin.from("team_checkouts")
    .update({ stripe_customer_id: customerId, stripe_session_id: session.id })
    .eq("id", ck.checkout_id);
  if (up.error) throw new Error(`checkout row update failed: ${up.error.message}`);
  return json({ ok: true, url: session.url, checkout_id: ck.checkout_id, kind: ck.kind, seats: ck.seats, plan: ck.plan, trial: ck.trial }, 200);
}

async function verify(admin: Client, userId: string, body: Body) {
  const sessionId = String(body.session_id || "");
  if (!sessionId.startsWith("cs_")) return json({ error: "bad_request" }, 400);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!isTeamObject(session) || session.metadata?.soleil_owner_id !== userId) return json({ error: "not_yours" }, 403);
  if (session.status !== "complete") return json({ ok: false, error: "not_complete", status: session.status }, 200);
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const checkoutId = session.metadata?.soleil_team_checkout;
  if (!subId || !checkoutId) return json({ ok: false, error: "no_subscription" }, 200);
  const out = await completeTeamCheckout(admin, stripe, { checkoutId, sessionId: session.id, subscriptionId: subId });
  return json(out, 200);
}

// The portal is the owner's: card, invoices, billing details, cancel.
let portalConfigId: string | null = null;

async function portal(admin: Client, userId: string, body: Body) {
  const orgId = typeof body.org_id === "string" && UUID_RE.test(body.org_id) ? body.org_id : null;
  if (!orgId) return json({ error: "bad_request" }, 400);
  const org = await admin.from("organizations").select("owner_id, closed_at").eq("id", orgId).maybeSingle();
  if (org.error) throw new Error(`team read failed: ${org.error.message}`);
  if (!org.data || org.data.closed_at || org.data.owner_id !== userId) return json({ error: "team_not_owner" }, 403);
  const row = await admin.from("org_subscriptions").select("stripe_customer_id").eq("org_id", orgId).maybeSingle();
  if (row.error) throw new Error(`team mirror read failed: ${row.error.message}`);
  if (!row.data?.stripe_customer_id) return json({ error: "no_plan" }, 404);

  const returnUrl = `${returnOrigin(body.return_origin)}/team?billing=1`;
  if (!portalConfigId) {
    for await (const c of stripe.billingPortal.configurations.list({ active: true, limit: 100 })) {
      if (c.metadata?.soleil === TEAM_PORTAL_TAG) { portalConfigId = c.id; break; }
    }
  }
  if (!portalConfigId) {
    const c = await stripe.billingPortal.configurations.create(teamPortalConfiguration(returnUrl),
      { idempotencyKey: `team-portal-config:${TEAM_PORTAL_TAG}` });
    portalConfigId = c.id;
  }
  const s = await stripe.billingPortal.sessions.create({
    customer: row.data.stripe_customer_id as string,
    configuration: portalConfigId,
    return_url: returnUrl,
  });
  return json({ ok: true, url: s.url }, 200);
}

// The caller's view of the team's plan (owner or admin, 0538 get_team_billing)
// and the subscription it follows.
async function teamPlan(userClient: Client, admin: Client, orgId: string) {
  const bill = await userClient.rpc("get_team_billing", { p_org_id: orgId });
  if (bill.error) return { refused: refusal(bill.error as PgError) };
  const row = await admin.from("org_subscriptions")
    .select("stripe_subscription_id, stripe_customer_id").eq("org_id", orgId).maybeSingle();
  if (row.error) throw new Error(`team mirror read failed: ${row.error.message}`);
  return {
    bill: bill.data as { status: string; seats: number; seat_ceiling: number },
    subId: (row.data?.stripe_subscription_id as string | undefined) ?? null,
    customerId: (row.data?.stripe_customer_id as string | undefined) ?? null,
  };
}

async function seatsPreview(userClient: Client, admin: Client, body: Body) {
  const orgId = typeof body.org_id === "string" && UUID_RE.test(body.org_id) ? body.org_id : null;
  const want = Number.isInteger(body.seats) ? body.seats as number : null;
  if (!orgId || want == null) return json({ error: "bad_request" }, 400);
  const plan = await teamPlan(userClient, admin, orgId);
  if (plan.refused) return plan.refused;
  const { bill, subId, customerId } = plan;
  if (bill!.status !== "active") return json({ error: "team_view_only" }, 409);
  if (want <= bill!.seats) return json({ error: "bad_request", seats: bill!.seats }, 400);
  if (want > bill!.seat_ceiling) return json({ error: "team_seats_ceiling", ceiling: bill!.seat_ceiling }, 409);
  if (!subId || !customerId) return json({ error: "no_plan" }, 404);

  const sub = await stripe.subscriptions.retrieve(subId);
  const { seat } = teamItems(sub, billingConfig());
  if (!seat) return json({ error: "no_seat_item" }, 409);
  const base = {
    seats: want,
    from_seats: bill!.seats,
    unit_amount: seat.price?.unit_amount ?? null,
    interval: seat.price?.recurring?.interval ?? null,
    currency: seat.price?.currency ?? null,
  };
  // In a trial nothing is charged now: the first invoice bills the seats the
  // trial ends with (teamBillingCore seatSyncPlan).
  if (sub.status === "trialing") {
    return json({ ok: true, ...base, trialing: true, amount_today: 0, trial_end: sub.trial_end ?? null }, 200);
  }
  const nowS = Math.floor(Date.now() / 1000);
  const preview = await stripe.invoices.createPreview(seatPreviewParams({
    customerId, subscriptionId: subId, seatItemId: seat.id, quantity: want, prorationDate: nowS,
  }));
  return json({ ok: true, ...base, proration_date: nowS, amount_today: Math.max(0, prorationAmount(preview)) }, 200);
}

async function seatsAdd(userClient: Client, admin: Client, body: Body) {
  const orgId = typeof body.org_id === "string" && UUID_RE.test(body.org_id) ? body.org_id : null;
  const want = Number.isInteger(body.seats) ? body.seats as number : null;
  const key = orgId ? seatAddKey(orgId, body.request_id) : null;
  if (!orgId || want == null || !key) return json({ error: "bad_request" }, 400);
  const row = await admin.from("org_subscriptions").select("status").eq("org_id", orgId).maybeSingle();
  if (row.error) throw new Error(`team mirror read failed: ${row.error.message}`);
  // The price shown is the price charged: outside a trial the preview's
  // proration date comes back with the purchase, at most 15 minutes old.
  const nowS = Math.floor(Date.now() / 1000);
  const trialing = row.data?.status === "trialing";
  const prorationDate = Number.isInteger(body.proration_date) ? body.proration_date as number : null;
  if (!trialing && !prorationDateOk(prorationDate, nowS)) return json({ error: "stale_preview" }, 409);

  const set = await userClient.rpc("set_team_seats", { p_org_id: orgId, p_seats: want });
  if (set.error) return refusal(set.error as PgError);
  const result = await syncTeam(admin, stripe, orgId, {
    prorationDate: trialing ? undefined : prorationDate!,
    idempotencyKey: key,
  });
  return json({ ok: true, seats: set.data, ...result }, 200);
}

async function sync(userClient: Client, admin: Client, body: Body) {
  const orgId = typeof body.org_id === "string" && UUID_RE.test(body.org_id) ? body.org_id : null;
  if (!orgId) return json({ error: "bad_request" }, 400);
  const bill = await userClient.rpc("get_team_billing", { p_org_id: orgId });
  if (bill.error) return refusal(bill.error as PgError);
  return json({ ok: true, ...(await syncTeam(admin, stripe, orgId)) }, 200);
}

// The database's refusal, readable: its hint is the stable reason
// (teamHints.js reads the same words), its detail the number it is about.
function refusal(e: PgError) {
  if (e.code === "42501" || e.code === "22023" || e.code === "P0002") {
    return json({ error: e.hint || "refused", message: e.message ?? null, detail: e.details ?? null }, 409);
  }
  console.error("[team-billing] database error", e.code, e.message);
  return json({ error: "server_error" }, 500);
}

function returnOrigin(asked: unknown): string {
  const a = typeof asked === "string" ? asked.trim().replace(/\/$/, "") : "";
  return a && RETURN_ORIGINS.includes(a) ? a : APP_URL;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
