// storage-addon — POST (signed in): change how many extra-storage blocks the
// caller's own Creator subscription carries.
//
//   { action: "preview", blocks }                              → what it costs
//   { action: "apply",   blocks, request_id, proration_date }  → do it
//
// `blocks` is the TOTAL wanted, never a delta, so a repeated request cannot
// add twice. The decisions are storageAddonCore.mjs's (tested in node); this
// file only fetches, asks Stripe and writes.
//
// Money rules (owner decision 2026-10-17, review 2026-10-17):
//   • An increase is charged now, prorated (always_invoice), with
//     payment_behavior pending_if_incomplete: if the card needs 3D Secure or
//     is declined, Stripe applies NOTHING and leaves an open invoice. The
//     caller gets its hosted URL; once it is paid Stripe applies the change and
//     the webhook mirrors it. Nothing here grants storage before money moves.
//   • The apply reuses the preview's proration_date, so the charge is the
//     amount the sheet showed. A preview older than 15 minutes is refused.
//   • A removal is credited on the next invoice (create_prorations). It is
//     refused if the files already stored would no longer fit.
//   • One idempotency key per click (addon:<user>:<request_id>).
//   • A trial, a past-due or canceling subscription, a schedule, a discount,
//     a per-account quota or a Stripe price that does not say what we sell
//     are all refused (storageAddonCore addonRefusal).
//
// Dark until the owner creates the Stripe product and prices and sets
// STRIPE_PRODUCT_STORAGE, STRIPE_PRICE_STORAGE_MONTHLY and
// STRIPE_PRICE_STORAGE_ANNUAL: until then every call answers not_configured.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import Stripe from "npm:stripe@17.7.0";
import { billingConfig, mirrorRow } from "../_shared/activate.ts";
import { failedWith, reportEdgeError, reported } from "../_shared/reportError.ts";
import { subscriptionItems } from "../_shared/activateCore.mjs";
import {
  STORAGE_ADDON_CURRENCY,
  STORAGE_ADDON_UNIT_AMOUNT,
  addonItems,
  addonRefusal,
  idempotencyKey,
  parseTarget,
  previewDiscounted,
  prorationAmount,
  prorationDateOk,
  storagePriceIdFor,
} from "../_shared/storageAddonCore.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
// Never fall back to the service-role key (see create-portal-session).
if (!ANON_KEY) throw new Error("SUPABASE_ANON_KEY is not set; refusing to fall back to the service-role key");
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

// Changes per account per hour: enough to fix a mistake, not enough to turn
// the button into a proration machine.
const APPLY_PER_HOUR = 5;

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

Deno.serve(reported("storage-addon", async (req) => {
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
    const userId = u.data.user.id;

    let body: { action?: string; blocks?: unknown; request_id?: unknown; proration_date?: unknown };
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
    const action = body.action;
    if (action !== "preview" && action !== "apply") return json({ error: "bad_request" }, 400);

    const cfg = billingConfig();
    const configured = Boolean(cfg.storageProduct && cfg.storagePrices.monthly && cfg.storagePrices.annual);
    if (!configured) return failedWith(json({ error: "not_configured" }, 503), new Error("the storage add-on's prices are not set"), { what: "billing config" });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    if (action === "apply") {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const tries = await admin.from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("event", "storage_addon_attempt").gte("occurred_at", since);
      if (tries.error) throw new Error(`attempt count failed: ${tries.error.message}`);
      if ((tries.count ?? 0) >= APPLY_PER_HOUR) return json({ error: "rate_limited" }, 429);
    }

    const profileQ = await admin.from("profiles").select("tier, storage_quota_bytes").eq("user_id", userId).maybeSingle();
    if (profileQ.error) throw new Error(`profile read failed: ${profileQ.error.message}`);
    const mirrorQ = await admin.from("subscriptions")
      .select("stripe_subscription_id, stripe_customer_id").eq("user_id", userId).maybeSingle();
    if (mirrorQ.error) throw new Error(`mirror read failed: ${mirrorQ.error.message}`);
    const grantQ = await admin.rpc("user_has_active_paid_grant", { p_user_id: userId });
    if (grantQ.error) throw new Error(`grant check failed: ${grantQ.error.message}`);
    const cfgRow = await admin.from("app_config").select("value").eq("key", "storage_addon").maybeSingle();
    if (cfgRow.error) throw new Error(`config read failed: ${cfgRow.error.message}`);
    const usedQ = await admin.rpc("_storage_used_bytes", { p_owner: userId });
    if (usedQ.error) throw new Error(`usage read failed: ${usedQ.error.message}`);
    const pendingQ = await admin.rpc("_storage_pending_bytes", { p_owner: userId });
    if (pendingQ.error) throw new Error(`pending read failed: ${pendingQ.error.message}`);

    const addonCfg = (cfgRow.data?.value ?? {}) as { max_blocks?: number; block_bytes?: number };
    const maxBlocks = Number(addonCfg.max_blocks ?? 10);
    const blockBytes = Number(addonCfg.block_bytes ?? 1099511627776);
    const target = parseTarget(body.blocks, maxBlocks);
    const usedBytes = Number(usedQ.data ?? 0) + Number(pendingQ.data ?? 0);

    const subId = (mirrorQ.data?.stripe_subscription_id as string | undefined) || null;
    const sub = subId
      ? await stripe.subscriptions.retrieve(subId, { expand: ["latest_invoice", "discounts"] })
      : null;
    const items = sub ? subscriptionItems(sub, cfg) : null;
    const current = (items?.storageBlocks as number | undefined) ?? 0;
    const priceId = items?.creator ? storagePriceIdFor(items.creator, cfg) : null;
    const price = priceId && target != null && target > current ? await stripe.prices.retrieve(priceId) : null;
    let quotaIfBytes: number | null = null;
    if (target != null && target < current) {
      const q = await admin.rpc("_storage_quota_if_blocks", { p_owner: userId, p_purchased: target });
      if (q.error) throw new Error(`quota read failed: ${q.error.message}`);
      quotaIfBytes = Number(q.data);
    }

    const refusal = addonRefusal({
      configured, profile: profileQ.data, grantActive: grantQ.data === true, mirror: mirrorQ.data,
      sub, cfg, target, current, maxBlocks, usedBytes, quotaIfBytes, price,
    });
    if (refusal) return json({ error: refusal.code, ...refusal }, 409);

    const customerId = typeof sub!.customer === "string" ? sub!.customer : sub!.customer.id;
    const interval = items.creator.price.recurring.interval as "month" | "year";
    const base = {
      current_blocks: current,
      target_blocks: target,
      max_blocks: maxBlocks,
      block_bytes: blockBytes,
      interval,
      unit_amount: STORAGE_ADDON_UNIT_AMOUNT[interval],
      currency: STORAGE_ADDON_CURRENCY,
      used_bytes: usedBytes,
    };
    if (target === current) return json({ ok: true, unchanged: true, ...base }, 200);

    const increase = (target as number) > current;
    const changeItems = addonItems({ storageItem: items.storage[0] ?? null, priceId, target });
    const prorationBehavior = increase ? "always_invoice" : "create_prorations";
    const nowS = Math.floor(Date.now() / 1000);

    // The preview runs on apply too: it is the one check that sees a discount
    // on the CUSTOMER, which the subscription object does not carry.
    const prorationDate = action === "apply" ? body.proration_date : nowS;
    if (action === "apply" && !prorationDateOk(prorationDate, nowS)) return json({ error: "stale_preview" }, 409);
    const preview = await stripe.invoices.createPreview({
      customer: customerId,
      subscription: subId!,
      subscription_details: {
        items: changeItems,
        proration_behavior: prorationBehavior,
        proration_date: prorationDate as number,
      },
    });
    if (increase && previewDiscounted(preview)) return json({ error: "discounted_subscription" }, 409);
    const amount = prorationAmount(preview);

    if (action === "preview") {
      return json({
        ok: true,
        ...base,
        proration_date: prorationDate,
        amount_today: increase ? Math.max(0, amount) : 0,
        credit_next: increase ? 0 : Math.max(0, -amount),
      }, 200);
    }

    const key = idempotencyKey(userId, body.request_id);
    if (!key) return json({ error: "bad_request" }, 400);

    // Counted before Stripe is asked, so a run of failures still spends the
    // hour's budget. Best-effort: a failed insert must not block a purchase.
    const attempt = await admin.from("analytics_events").insert({
      user_id: userId, event: "storage_addon_attempt", props: { from: current, to: target }, path: "/storage-addon",
    });
    if (attempt.error) {
      console.warn("[storage-addon] attempt insert failed", attempt.error.message);
      void reportEdgeError("storage-addon", { what: "insert analytics_events", error: attempt.error, severity: "warning" });
    }

    const updated = await stripe.subscriptions.update(subId!, {
      items: changeItems,
      proration_behavior: prorationBehavior,
      proration_date: prorationDate as number,
      ...(increase ? { payment_behavior: "pending_if_incomplete" as const } : {}),
      expand: ["latest_invoice"],
    }, { idempotencyKey: key });

    if (updated.pending_update) {
      // 3D Secure or a decline: nothing changed. The hosted invoice takes the
      // payment (with any card), and the webhook mirrors the change once paid.
      const inv = updated.latest_invoice && typeof updated.latest_invoice === "object" ? updated.latest_invoice : null;
      return json({ ok: false, status: "requires_payment", hosted_invoice_url: inv?.hosted_invoice_url ?? null }, 200);
    }

    // The change is made. Everything below is bookkeeping, and a failure in it
    // must not read as a failed purchase: the webhook writes the same row from
    // customer.subscription.updated, so the drive catches up within seconds.
    let blocksNow: number = target as number;
    let quotaBytes: unknown = null;
    try {
      // A fresh read, not the update's own answer: with an idempotency key a
      // retried request returns the FIRST response, which may be stale.
      const observedAt = new Date().toISOString();
      const fresh = await stripe.subscriptions.retrieve(subId!, { expand: ["discounts", "latest_invoice"] });
      blocksNow = subscriptionItems(fresh, cfg).storageBlocks;
      const up = await admin.from("subscriptions")
        .update(mirrorRow(fresh, { userId, customerId, observedAt }))
        .eq("user_id", userId).eq("stripe_subscription_id", subId!);
      if (up.error) {
        console.warn("[storage-addon] mirror write failed", up.error.message);
        void reportEdgeError("storage-addon", { what: "update subscriptions", error: up.error, severity: "warning" });
      }
      const quotaQ = await admin.rpc("_storage_quota_bytes", { p_owner: userId });
      if (!quotaQ.error) quotaBytes = quotaQ.data;
    } catch (e) {
      console.warn("[storage-addon] post-update bookkeeping failed", (e as Error)?.message || String(e));
      void reportEdgeError("storage-addon", { what: "after the change", error: e, severity: "warning" });
    }
    return json({ ok: true, blocks: blocksNow, quota_bytes: quotaBytes, charged: increase ? Math.max(0, amount) : 0 }, 200);
  } catch (e) {
    if (e instanceof Stripe.errors.StripeIdempotencyError) return json({ error: "retry" }, 409);
    if (e instanceof Stripe.errors.StripeError) {
      console.error("[storage-addon] stripe error", e.type, e.code, e.message);
      return failedWith(json({ error: "stripe_error", code: e.code ?? null }, 502), e);
    }
    console.error("[storage-addon] error", e);
    return failedWith(json({ error: "server_error" }, 500), e);
  }
}));

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
