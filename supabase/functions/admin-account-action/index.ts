// admin-account-action — POST (admin-authed) account-lifecycle actions that need
// the service role and/or the Stripe API, so they can't be plain RPCs.
//
// Body: { user_id: uuid, action, reason? }
//   action:
//     • cancel_subscription → cancel the user's Stripe sub immediately (stop
//                             billing). Used by the Users-tab downgrade flow
//                             BEFORE admin_set_tier(demo|waitlist).
//     • ban                 → cancel any active sub, set profiles.banned_*, and
//                             native-ban the auth user (blocks sign-in + token
//                             refresh). Tier is preserved so unban restores it.
//     • unban               → clear profiles.banned_* + lift the native ban.
//                             Does NOT resurrect the canceled subscription.
//     • delete              → cancel any active sub, then hard-delete the auth
//                             user (cascades profiles/subscriptions/grants/…;
//                             content they authored persists with created_by NULL).
//     • resync_subscription → re-pull the sub from Stripe and recompute
//                             status/period/plan + net monthly amount + discount
//                             (fixes MRR for legacy/comped rows on demand).
//
// Auth: caller's Bearer JWT must resolve to a profile with tier='admin'
// (same pattern as admin-waitlist-action). Refuses acting on yourself; refuses
// ban/delete on other admins. Every billing-affecting path cancels Stripe first
// so we never strand a subscription billing a blocked/removed account.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  netMonthlyFromSubscription,
  periodEndFromSubscription,
  planFromPriceId,
} from "../_shared/activate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY")!;

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

type Admin = ReturnType<typeof createClient>;

interface Body {
  user_id?: string;
  action?: "cancel_subscription" | "ban" | "unban" | "delete" | "resync_subscription";
  reason?: string;
}

// Cancel the user's Stripe subscription now (if one is live) and mark our row
// canceled. Idempotent — tolerates a sub Stripe already canceled.
async function cancelStripeSub(admin: Admin, userId: string): Promise<{ canceled: boolean; subId: string | null }> {
  const row = await admin.from("subscriptions")
    .select("stripe_subscription_id, status").eq("user_id", userId).maybeSingle();
  const subId  = (row.data?.stripe_subscription_id as string | null) ?? null;
  const status = (row.data?.status as string | null) ?? null;
  const live = ["active", "trialing", "past_due", "unpaid", "paused"].includes(status ?? "");
  if (!subId || !live) return { canceled: false, subId };

  try {
    await stripe.subscriptions.cancel(subId);
  } catch (e) {
    const msg = (e as Error)?.message || "";
    // Already gone/canceled in Stripe → fine, we still mark our row canceled.
    if (!/no such subscription|resource_missing|already canceled|canceled/i.test(msg)) throw e;
  }
  await admin.from("subscriptions").update({
    status: "canceled",
    cancel_at_period_end: false,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return { canceled: true, subId };
}

async function resyncSubscription(admin: Admin, userId: string) {
  const row = await admin.from("subscriptions")
    .select("stripe_subscription_id").eq("user_id", userId).maybeSingle();
  const subId = (row.data?.stripe_subscription_id as string | null) ?? null;
  if (!subId) return { ok: false, reason: "no subscription on file" };

  const sub = await stripe.subscriptions.retrieve(subId, { expand: ["discounts"] });
  const billing = netMonthlyFromSubscription(sub);
  const upd = await admin.from("subscriptions").update({
    plan: planFromPriceId(sub.items.data[0]?.price?.id),
    status: sub.status,
    current_period_end: periodEndFromSubscription(sub),
    cancel_at_period_end: sub.cancel_at_period_end,
    monthly_amount_cents: billing.monthlyAmountCents,
    discount: billing.discount,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  if (upd.error) return { ok: false, reason: upd.error.message };
  return { ok: true, status: sub.status, monthly_amount_cents: billing.monthlyAmountCents, discount: billing.discount };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

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
    const callerId = u.data.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const me = await admin.from("profiles").select("tier").eq("user_id", callerId).maybeSingle();
    if (me.error || me.data?.tier !== "admin") return json({ error: "admin only" }, 403);

    let body: Body;
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
    if (!body.user_id || !body.action) return json({ error: "missing user_id or action" }, 400);
    if (body.user_id === callerId)     return json({ error: "you cannot perform this action on your own account" }, 400);

    // Target details + guard against acting on other admins for destructive ops.
    const tgt = await admin.from("profiles").select("tier").eq("user_id", body.user_id).maybeSingle();
    const targetTier = tgt.data?.tier as string | undefined;
    if ((body.action === "ban" || body.action === "delete") && targetTier === "admin") {
      return json({ error: "refusing to ban/delete an admin account" }, 409);
    }

    switch (body.action) {
      case "cancel_subscription": {
        const r = await cancelStripeSub(admin, body.user_id);
        return json({ ok: true, action: "cancel_subscription", ...r }, 200);
      }

      case "ban": {
        const r = await cancelStripeSub(admin, body.user_id);
        const upd = await admin.from("profiles").update({
          banned_at: new Date().toISOString(),
          banned_by: callerId,
          banned_reason: (body.reason || "").trim() || null,
        }).eq("user_id", body.user_id);
        if (upd.error) return json({ error: upd.error.message }, 500);
        // Native ban: blocks sign-in + token refresh server-side (~100 years).
        const ban = await admin.auth.admin.updateUserById(body.user_id, { ban_duration: "876000h" });
        if (ban.error) return json({ error: `banned in app, but auth ban failed: ${ban.error.message}` }, 500);
        return json({ ok: true, action: "ban", subscription_canceled: r.canceled }, 200);
      }

      case "unban": {
        const upd = await admin.from("profiles").update({
          banned_at: null, banned_by: null, banned_reason: null,
        }).eq("user_id", body.user_id);
        if (upd.error) return json({ error: upd.error.message }, 500);
        const unban = await admin.auth.admin.updateUserById(body.user_id, { ban_duration: "none" });
        if (unban.error) return json({ error: `unbanned in app, but auth unban failed: ${unban.error.message}` }, 500);
        return json({ ok: true, action: "unban" }, 200);
      }

      case "delete": {
        const r = await cancelStripeSub(admin, body.user_id);
        const del = await admin.auth.admin.deleteUser(body.user_id);
        if (del.error) return json({ error: del.error.message }, 500);
        return json({ ok: true, action: "delete", subscription_canceled: r.canceled }, 200);
      }

      case "resync_subscription": {
        const r = await resyncSubscription(admin, body.user_id);
        return json({ ...r, action: "resync_subscription" }, r.ok ? 200 : 409);
      }

      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error("[admin-account-action] error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
