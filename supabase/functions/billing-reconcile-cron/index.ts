// billing-reconcile-cron — daily webhook-outage insurance (decided 2026-08-21).
//
// The subscriptions mirror (and the tier it drives) is written only by webhook
// and verify events. If the webhook endpoint is dead, Stripe retries for ~3
// days and then gives up — after that, nothing would ever demote a canceled
// subscriber or refresh a renewed one. This job re-anchors paid users to
// STRIPE truth, in both directions:
//
//   • paid + active grant                     → skip (grants aren't Stripe's)
//   • paid + no subscription row / no sub id  → billing_flag only, NEVER
//     auto-demote — that shape is an admin comp (manual tier set); policing it
//     automatically would surprise the operator
//   • paid + mirrored sub healthy (<3d slack) → skip
//   • paid + mirrored sub stale or non-live   → retrieve from Stripe:
//       live (active/trialing) → repair the mirror (activateUserFromSubscription)
//       dead / missing         → mirror the terminal status + demote
//
// Authorization: same dual contract as waitlist-accept-cron —
//   • Bearer <SUPABASE_SERVICE_ROLE_KEY>   (admin tools, manual curl)
//   • x-cron-secret: <CRON_SECRET>         (pg_cron; see migration 0253)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { activateUserFromSubscription } from "../_shared/activate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY")!;
const CRON_SECRET  = Deno.env.get("CRON_SECRET") || "";

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH = 50;

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  const cronHeader = req.headers.get("x-cron-secret") || "";
  const auth       = req.headers.get("authorization") || "";
  const bearer     = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const okCron     = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const okService  = !!SERVICE_KEY && bearer === SERVICE_KEY;
  if (!okCron && !okService) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const paid = await admin.from("profiles").select("user_id").eq("tier", "paid").limit(BATCH);
  if (paid.error) return json({ error: paid.error.message }, 500);

  let checked = 0, repaired = 0, demoted = 0, flagged = 0, skipped = 0;
  const notes: Array<Record<string, unknown>> = [];

  for (const row of paid.data || []) {
    const userId = row.user_id as string;
    checked++;
    try {
      const grantQ = await admin.rpc("user_has_active_paid_grant", { p_user_id: userId });
      if (grantQ.error) throw new Error(`grant check failed: ${grantQ.error.message}`);
      if (grantQ.data === true) { skipped++; continue; }

      const sub = await admin.from("subscriptions")
        .select("stripe_customer_id, stripe_subscription_id, status, current_period_end")
        .eq("user_id", userId).maybeSingle();
      if (sub.error) throw new Error(`mirror read failed: ${sub.error.message}`);

      const subId = (sub.data?.stripe_subscription_id as string | undefined) || null;
      if (!subId) {
        // Billing-invisible paid user (no grant, no tracked sub) — an admin
        // comp shape. Flag for the operator, never auto-demote.
        flagged++;
        await flag(admin, userId, { kind: "reconcile", action: "no_subscription_no_grant" });
        continue;
      }

      const status = (sub.data?.status as string | undefined) || null;
      const periodEnd = sub.data?.current_period_end ? Date.parse(sub.data.current_period_end as string) : null;
      const healthy = (status === "active" || status === "trialing")
        && periodEnd !== null && periodEnd > Date.now() - STALE_AFTER_MS;
      if (healthy) { skipped++; continue; }

      // Stale or non-live mirror on a still-paid tier — ask Stripe.
      let live: Stripe.Subscription | null = null;
      try {
        live = await stripe.subscriptions.retrieve(subId, { expand: ["discounts"] });
      } catch (_e) {
        live = null; // deleted long ago / no such subscription
      }

      if (live && (live.status === "active" || live.status === "trialing")) {
        // Stripe says alive (a renewal the dead webhook missed) — repair.
        const customerId = typeof live.customer === "string" ? live.customer : live.customer.id;
        const r = await activateUserFromSubscription(admin, { userId, customerId, subscription: live });
        if (!r.activated && !r.soft) throw new Error(`repair failed: ${r.reason}`);
        repaired++;
        notes.push({ userId, action: "repaired", status: live.status });
        continue;
      }

      // Stripe says dead — mirror the truth and demote (tier guard keeps
      // admins safe; the grant case was excluded above).
      const upd = await admin.from("subscriptions").update({
        status: live?.status ?? "canceled",
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId);
      if (upd.error) throw new Error(`mirror write failed: ${upd.error.message}`);
      const dem = await admin.from("profiles").update({ tier: "demo" }).eq("user_id", userId).eq("tier", "paid");
      if (dem.error) throw new Error(`demote failed: ${dem.error.message}`);
      demoted++;
      await flag(admin, userId, { kind: "reconcile", action: "demoted_stale_paid", stripe_status: live?.status ?? "missing" });
      notes.push({ userId, action: "demoted", status: live?.status ?? "missing" });
    } catch (e) {
      flagged++;
      notes.push({ userId, action: "error", message: (e as Error)?.message || String(e) });
      console.error("[billing-reconcile] user failed", userId, e);
    }
  }

  const summary = { checked, repaired, demoted, flagged, skipped, notes };
  console.log("[billing-reconcile]", JSON.stringify(summary));
  return json(summary, 200);
});

async function flag(admin: ReturnType<typeof createClient>, userId: string | null, props: Record<string, unknown>) {
  try {
    const ins = await admin.from("analytics_events").insert({
      user_id: userId, event: "billing_flag", props, path: "/billing-reconcile-cron",
    });
    if (ins.error) console.warn("[billing-reconcile] flag insert failed", ins.error.message);
  } catch (e) {
    console.warn("[billing-reconcile] flag insert threw", (e as Error)?.message || String(e));
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
