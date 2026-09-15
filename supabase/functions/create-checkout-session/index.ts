// create-checkout-session — POST { plan: 'monthly'|'annual', trial?: boolean }
//
// Requires Bearer auth (the user OTP-verified at signup). Returns a
// Stripe-hosted Checkout URL for the requested plan, billed in
// subscription mode. The Stripe customer is auto-created on first
// checkout if one doesn't exist yet for this email.
//
// `trial: true` asks for the Creator trial (_shared/trialCore.mjs): the
// caller's OWN tier row (get_my_tier, as the caller) and Stripe's memory of the
// customer both have to agree they are eligible, or the request is refused
// with `trial_not_available` — the client's offer is a suggestion, this is the
// decision. A trial session collects a card up front and charges nothing until
// the trial ends.
//
// Success URL → APP_URL/pricing/success?session_id={CHECKOUT_SESSION_ID}
// Cancel URL  → APP_URL/pricing

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { clientIpFromHeaders, emitCapi } from "../_shared/meta-capi.ts";
import { decideCheckoutRoute, filterLiveSubscriptions, pickReusableCustomer, promoCodesAllowedForPlan } from "../_shared/activateCore.mjs";
import { CREATOR_TRIAL_DAYS, creatorTrialEligibility, customerHasTrialed } from "../_shared/trialCore.mjs";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
// Never fall back to the service-role key here: with no Authorization header
// on the request, the apikey alone selects the role, and a missing anon key
// would silently make this "user" client SERVICE ROLE. Supabase injects
// SUPABASE_ANON_KEY into every edge function, so this only fires on a broken deploy.
if (!ANON_KEY) throw new Error("SUPABASE_ANON_KEY is not set; refusing to fall back to the service-role key");
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

  // Wrap the whole body so any Stripe/DB throw returns a real JSON error WITH
  // CORS headers — otherwise a bare runtime 500 has no ACAO header and the
  // browser mislabels it a CORS failure, hiding the actual cause.
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return json({ error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const u = await userClient.auth.getUser();
    if (u.error || !u.data.user?.email) return json({ error: "invalid token" }, 401);

    const email  = u.data.user.email.toLowerCase().trim();
    const userId = u.data.user.id;

    let plan: string;
    let fbp = "", fbc = "", icEventId = "";
    let trial = false;
    try {
      const body = await req.json();
      plan = body.plan;
      trial = body.trial === true;
      // Meta match params captured client-side so the webhook/verify Purchase
      // (fired later from Stripe's request, where we DON'T have the user's IP/UA)
      // can attribute the conversion to the right Meta user.
      if (typeof body.fbp === "string") fbp = body.fbp.slice(0, 500);
      if (typeof body.fbc === "string") fbc = body.fbc.slice(0, 500);
      // Shared event_id for the InitiateCheckout CAPI mirror — the browser pixel
      // fired the same id, so Meta collapses the two into one event.
      if (typeof body.ic_event_id === "string") icEventId = body.ic_event_id.slice(0, 200);
    } catch { return json({ error: "invalid json" }, 400); }

    // IP + UA come from THIS request (the user's browser), not the later webhook.
    const clientIp = clientIpFromHeaders(req);
    const clientUa = (req.headers.get("user-agent") || "").slice(0, 500);

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

    // Resolve the Stripe customer, PROVING ownership at every step. A bare
    // email match is not ownership: an email that changed hands would hand
    // this caller the previous owner's invoices, saved payment method, and
    // portal cancel button.
    let customerId = existingSub.data?.stripe_customer_id ?? null;
    if (customerId) {
      // The mirror can hold a Dashboard-deleted customer forever (we don't
      // handle customer.deleted) — validate, or every checkout 500s on it.
      const c = await stripe.customers.retrieve(customerId).catch(() => null);
      if (!c || (c as Stripe.DeletedCustomer).deleted) customerId = null;
    }
    // Customers on this address. Needed to avoid minting duplicates, and — when
    // a trial is being asked for — to answer "has this ADDRESS had its
    // fortnight", which is a different question from "may this caller reuse
    // this customer".
    let emailCustomers: Stripe.Customer[] = [];
    if (!customerId || trial) {
      const found = await stripe.customers.list({ email, limit: 10 });
      emailCustomers = found.data.filter((c) => !(c as unknown as Stripe.DeletedCustomer).deleted);
      if (!customerId) {
        // Reuse only one that is provably this user's (metadata match) or
        // unclaimed (stamped on reuse so future matches are by user id, not
        // email).
        const pick = pickReusableCustomer(found.data, userId);
        if (pick) {
          customerId = pick.customer.id;
          if (pick.needsStamp) {
            await stripe.customers
              .update(customerId, { metadata: { supabase_user_id: userId } })
              .catch(() => {}); // best-effort: a failed stamp only delays the claim
          }
        }
      }
    }

    // Already-subscribed backstop: never create a second subscription for a
    // user who already has a live one (or is on a paid/admin tier). The mirror
    // alone is NOT enough — it's written only after a payment lands, so two
    // tabs racing through checkout both used to pass. Ask Stripe directly:
    // any live-ish subscription on the (ownership-verified) customer routes to
    // the Customer Portal instead of a second checkout.
    let liveSubCount = 0;
    let everTrialed = false;
    if (customerId) {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
      liveSubCount = filterLiveSubscriptions(subs.data).length;
      everTrialed = customerHasTrialed(subs.data);
    }
    const route = decideCheckoutRoute({
      liveSubCount,
      mirrorStatus: existingSub.data?.status ?? null,
      tier: prof.data?.tier ?? null,
      hasVerifiedCustomer: Boolean(customerId),
    });
    if (route === "already_subscribed") return json({ error: "already_subscribed" }, 409);
    if (route === "portal") {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId!,
        return_url: `${APP_URL}/?settings=billing`,
      });
      return json({ ok: true, mode: "portal", url: portal.url }, 200);
    }

    // The trial decision, server-side. The caller's own tier row (as the
    // caller, so RLS and auth.uid() apply) says whether they have a real body
    // of work and whether a trial has ever started for this account; Stripe
    // says whether this customer has ever held a trialing subscription. Either
    // "no" is final. A refusal is 403 with a stable code the client maps to
    // honest copy — Creator itself is still for sale on the same screen.
    if (trial) {
      // A trial is one per PERSON, and both of our own guards are keyed to
      // state that self-service account deletion destroys together: deleting
      // the account cascades the profile (taking creator_trial_started_at with
      // it) and leaves the old Stripe customer behind stamped with the dead
      // uuid — which pickReusableCustomer then refuses to reuse, correctly, so
      // `everTrialed` above never even looks at it. Same address, same person,
      // a fresh fortnight, repeatable.
      //
      // So ask every customer on this address, not only the one we are willing
      // to bill. Reading trial history leaks nothing back to the caller: the
      // only outcome is a 403 with a stable code. The cost is one false
      // negative — an address that genuinely changed hands denies its new owner
      // a trial — which is the right way round for a give-away.
      //
      // This closes the same-address loop only. A brand new address is still a
      // brand new person as far as any server can tell, and no amount of
      // bookkeeping changes that; the trial is deliberately cheap to give and
      // expensive to exploit (deleting the account destroys every workspace the
      // person was alone in).
      if (!everTrialed) {
        for (const c of emailCustomers) {
          if (c.id === customerId) continue;
          const prior = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 10 });
          if (customerHasTrialed(prior.data)) { everTrialed = true; break; }
        }
      }
      const t = await userClient.rpc("get_my_tier");
      const row = Array.isArray(t.data) ? t.data[0] : t.data;
      const elig = creatorTrialEligibility({
        tier: row?.tier ?? null,
        cards: row?.demo_card_count,
        cardLimit: row?.effective_card_limit,
        trialStartedAt: row?.creator_trial_started_at ?? null,
      });
      if (t.error || !elig.eligible || everTrialed) {
        return json({
          error: "trial_not_available",
          reason: t.error ? "tier_unreadable" : everTrialed ? "already_trialed" : elig.reason,
        }, 403);
      }
    }

    if (!customerId) {
      // Idempotency key collapses concurrent double-invocations (two tabs)
      // onto one customer; the 10-minute bucket lets a genuine retry after an
      // operator deleted the fresh customer escape the cached response.
      const created = await stripe.customers.create(
        {
          email,
          metadata: { supabase_user_id: userId },
        },
        { idempotencyKey: `cust-create:${userId}:${Math.floor(Date.now() / 600_000)}` },
      );
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
      // Monthly only. Stripe discounts invoices, not months — a `once` coupon
      // is half off ONE month here but half off a WHOLE YEAR on annual, and no
      // coupon can restrict itself to a plan because monthly and annual are two
      // Prices on one Product. Withholding the field IS the enforcement.
      allow_promotion_codes: promoCodesAllowedForPlan(plan),
      // Default session lifetime is 24h — a payable sibling from a two-tab race
      // or an abandoned attempt would linger all day and could still mint a
      // second subscription after the first one paid. One hour is plenty to
      // finish paying (Stripe's minimum is 30 minutes).
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      // Don't force a card on free checkouts: when a 100%-off promo makes the
      // subscription $0 (now and on renewal), Stripe collects no payment method.
      // Paid checkouts still collect a card because an amount is due. A TRIAL
      // is the one case where nothing is due today and a card is still
      // required — card-required is the trial model that converts and the one
      // that keeps a premium offer from being a free fortnight for anybody.
      payment_method_collection: trial ? "always" : "if_required",
      client_reference_id: userId,
      // Match params ride along in session metadata; stripe-webhook +
      // verify-checkout-session read them back into the CAPI Purchase. Omit
      // empties so we never write "" keys.
      metadata: {
        supabase_user_id: userId,
        plan,
        ...(trial    ? { trial: "1" }           : {}),
        ...(fbp      ? { fbp }                  : {}),
        ...(fbc      ? { fbc }                  : {}),
        ...(clientIp ? { client_ip: clientIp }  : {}),
        ...(clientUa ? { client_ua: clientUa }  : {}),
      },
      subscription_data: {
        metadata: { supabase_user_id: userId, plan, ...(trial ? { trial: "1" } : {}) },
        ...(trial
          ? {
              trial_period_days: CREATOR_TRIAL_DAYS,
              // Belt and braces: a card is collected above, but if Stripe ever
              // ends a trial with no payment method on file the subscription
              // must cancel, never limp into past_due with paid tier intact.
              trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
            }
          : {}),
      },
    });

    // Meta CAPI InitiateCheckout — higher-trust server mirror of the browser
    // pixel's InitiateCheckout (shared event_id → Meta dedups). Reached only past
    // the already-subscribed → portal short-circuit above, so a portal redirect
    // never counts as a checkout. value comes from the session Stripe just
    // priced (list price at creation — promo codes apply later inside
    // Checkout), so it self-tracks any future Stripe price change; the literal
    // fallback mirrors PRICING in billingCopy.js.
    if (icEventId) {
      emitCapi({
        eventName: "InitiateCheckout",
        eventId: icEventId,
        eventSourceUrl: APP_URL ? `${APP_URL}/pricing` : undefined,
        userData: {
          email,
          externalId: userId,
          fbp: fbp || null,
          fbc: fbc || null,
          clientIpAddress: clientIp,
          clientUserAgent: clientUa,
        },
        customData: {
          currency: "USD",
          value: typeof session.amount_total === "number"
            ? session.amount_total / 100
            : (plan === "monthly" ? 25 : 240),
          content_name: "Creator",
          content_category: plan,
        },
      });
    }

    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    console.error("[create-checkout-session] error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
