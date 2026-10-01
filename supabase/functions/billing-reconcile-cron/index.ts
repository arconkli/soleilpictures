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
//
// It also sends the TRIAL-ENDING reminder (migration 0345): one email per
// trialing subscription, about three days before its first charge. Read off
// the subscriptions mirror on purpose — stripe-webhook has no trial_will_end
// case, and which events the endpoint is subscribed to is a Dashboard setting.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { activateUserFromSubscription } from "../_shared/activate.ts";
import { renderTrialEnding } from "../_shared/email/trialEnding.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY")!;
const CRON_SECRET  = Deno.env.get("CRON_SECRET") || "";

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH = 50;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
// Same sender identity send-transactional-email gives its hello@-class mail:
// a billing notice should land where a reply reaches a person.
const FROM_HELLO = "Clusters <hello@clusters.soleilpictures.com>";
const REPLY_TO   = "hello@clusters.soleilpictures.com";
// Remind when the first charge is at most this far out. The job runs daily, so
// a subscription enters the window roughly three days ahead, and a failed send
// gets two or three more daily attempts before the charge.
const REMIND_AHEAD_MS = 3.5 * 24 * 60 * 60 * 1000;

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

  const reminders = await sendTrialReminders(admin);

  const summary = { checked, repaired, demoted, flagged, skipped, notes, reminders };
  console.log("[billing-reconcile]", JSON.stringify(summary));
  return json(summary, 200);
});

// One trial_ending email per trialing subscription whose first charge is
// within REMIND_AHEAD_MS. The stamp is CLAIMED before the send (an atomic
// update that only one run can win) and RELEASED if the send fails, so each
// subscription is reminded once and a failure retries tomorrow. Canceled-at-
// period-end trials are skipped: nobody is going to be charged.
async function sendTrialReminders(admin: ReturnType<typeof createClient>) {
  const out = { due: 0, sent: 0, failed: 0, skipped: 0 };
  if (!RESEND_API_KEY) { console.warn("[billing-reconcile] RESEND_API_KEY missing; reminders skipped"); return out; }
  const now = new Date();
  const due = await admin.from("subscriptions")
    .select("user_id, stripe_subscription_id, plan, current_period_end")
    .eq("status", "trialing")
    .eq("cancel_at_period_end", false)
    .is("trial_reminder_sent_at", null)
    .gt("current_period_end", now.toISOString())
    .lte("current_period_end", new Date(now.getTime() + REMIND_AHEAD_MS).toISOString())
    .limit(BATCH);
  if (due.error) { console.error("[billing-reconcile] reminder query failed", due.error.message); return out; }
  out.due = (due.data || []).length;

  for (const row of due.data || []) {
    const userId = row.user_id as string;
    try {
      const claim = await admin.from("subscriptions")
        .update({ trial_reminder_sent_at: new Date().toISOString() })
        .eq("user_id", userId).is("trial_reminder_sent_at", null)
        .select("user_id");
      if (claim.error) throw new Error(`claim failed: ${claim.error.message}`);
      if (!claim.data?.length) { out.skipped++; continue; }   // another run won it

      const u = await admin.auth.admin.getUserById(userId);
      const email = u.data?.user?.email;
      if (!email) { out.skipped++; continue; }                // keep the claim: nobody to tell

      const firstChargeDate = new Date(row.current_period_end as string)
        .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
      const amountLabel = await chargeLabel(row.stripe_subscription_id as string | null, row.plan as string | null);

      // Sent from here rather than through send-transactional-email so that
      // adding a billing notice never means redeploying the sender every other
      // email depends on. The log row it writes is the same one that function
      // writes, so the admin email views see this send like any other.
      const mail = renderTrialEnding({ firstChargeDate, amountLabel });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "authorization": `Bearer ${RESEND_API_KEY}`,
          "content-type": "application/json",
          "Idempotency-Key": `trial_ending:${userId}:${row.current_period_end}`,
        },
        body: JSON.stringify({
          from: FROM_HELLO, to: [email], reply_to: REPLY_TO,
          subject: mail.subject, html: mail.html, text: mail.text,
        }),
      });
      const body = await res.json().catch(() => ({}));
      await logEmailSend(admin, { to: email, ok: res.ok, resendId: body?.id, errorBody: res.ok ? null : body });
      if (!res.ok) throw new Error(`send failed: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      out.sent++;
    } catch (e) {
      out.failed++;
      console.error("[billing-reconcile] trial reminder failed", userId, e);
      // Release the claim so tomorrow's run tries again, inside the window.
      await admin.from("subscriptions").update({ trial_reminder_sent_at: null }).eq("user_id", userId);
    }
  }
  return out;
}

// What the first charge will actually be, read from Stripe's price rather than
// typed here — a hand-typed amount is exactly how public copy drifts from the
// thing that charges. Falls back to the plan's cadence alone if Stripe can't
// be reached, never to a guessed number.
async function chargeLabel(subId: string | null, plan: string | null): Promise<string> {
  const cadence = plan === "annual" ? "year" : "month";
  if (!subId) return `the Creator ${plan === "annual" ? "annual" : "monthly"} price`;
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const price = sub.items?.data?.[0]?.price;
    const cents = price?.unit_amount;
    const interval = price?.recurring?.interval || cadence;
    if (typeof cents === "number") {
      const amount = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
      const symbol = (price?.currency || "usd").toLowerCase() === "usd" ? "$" : "";
      const suffix = symbol ? "" : ` ${(price?.currency || "").toUpperCase()}`;
      return `${symbol}${amount}${suffix}/${interval}`;
    }
  } catch (e) {
    console.warn("[billing-reconcile] price lookup failed", subId, (e as Error)?.message || String(e));
  }
  return `the Creator ${cadence === "year" ? "annual" : "monthly"} price`;
}

// The universal email_sends row (migration 0175), written exactly as
// send-transactional-email writes it. Non-fatal: a logging hiccup must never
// turn a delivered reminder into a failure that releases the claim and resends.
async function logEmailSend(
  admin: ReturnType<typeof createClient>,
  o: { to: string; ok: boolean; resendId?: string; errorBody?: unknown },
) {
  try {
    const ins = await admin.from("email_sends").insert({
      resend_id: o.ok ? (o.resendId ?? null) : null,
      template: "trial_ending",
      category: "transactional",
      recipient_email: o.to,
      status: o.ok ? "sent" : "failed",
      error: o.ok ? null : JSON.stringify(o.errorBody ?? null).slice(0, 500),
    });
    if (ins.error) console.warn("[billing-reconcile] email_sends log failed", ins.error.message);
  } catch (e) {
    console.warn("[billing-reconcile] email_sends log threw", (e as Error)?.message || String(e));
  }
}

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
