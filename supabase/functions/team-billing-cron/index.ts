// team-billing-cron — keeps every team's Stripe subscription following its
// database (S3).
//
//   { org_id }  → sync that team now. 0538's triggers post this the moment a
//                 seat change that no checkout or priced purchase billed is
//                 written, or a team closes.
//   {}          → the sweep, every 10 minutes while a team exists
//                 (0538 _team_billing_tick, which applies the grace first):
//       • a checkout paid but never finished (the webhook lost, the tab closed)
//       • teams with seat changes not yet on Stripe
//       • closed teams still billing (cancel now)
//       • unused seats, trimmed before a renewal (teamBillingCore trimDue)
//       • a mirror nobody has re-read for a day (a missed webhook)
//       • a trial ending within three days: the owner and admins are told once
//     inside a time budget; a run that runs out says so (`truncated`).
//
// Authorization: same dual contract as billing-reconcile-cron —
//   • Bearer <SUPABASE_SERVICE_ROLE_KEY>   (admin tools, manual curl)
//   • x-cron-secret: <CRON_SECRET>         (pg_cron and pg_net, via _cron_edge_post)
// Deployed with verify_jwt = false (supabase/config.toml): the cron secret is
// not a JWT.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import Stripe from "npm:stripe@17.7.0";
import { trialEndingSoon, trimDue } from "../_shared/teamBillingCore.mjs";
import { completeTeamCheckout, mirrorTeamSubscription, syncTeam, teamBillingReady } from "../_shared/teamBilling.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY")!;
const CRON_SECRET  = Deno.env.get("CRON_SECRET") || "";

const TIME_BUDGET_MS = 100_000;
const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000;
const LIVE = ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

type Admin = ReturnType<typeof createClient>;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const cronHeader = req.headers.get("x-cron-secret") || "";
  const auth       = req.headers.get("authorization") || "";
  const bearer     = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const okCron     = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const okService  = !!SERVICE_KEY && bearer === SERVICE_KEY;
  if (!okCron && !okService) return json({ error: "unauthorized" }, 401);
  if (!teamBillingReady()) return json({ ok: true, skipped: "not_available" }, 200);

  let body: { org_id?: unknown } = {};
  try { body = await req.json(); } catch { /* the sweep */ }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    if (typeof body.org_id === "string") {
      if (!UUID_RE.test(body.org_id)) return json({ error: "bad_request" }, 400);
      return json({ ok: true, ...(await syncTeam(admin, stripe, body.org_id)) }, 200);
    }
    return json(await sweep(admin), 200);
  } catch (e) {
    console.error("[team-billing-cron] error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

async function sweep(admin: Admin) {
  const startedAt = Date.now();
  const late = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const synced = new Set<string>();
  const notes: Array<Record<string, unknown>> = [];
  let completed = 0, trimmed = 0, reread = 0, noticed = 0, truncated = false;

  const syncOnce = async (orgId: string, why: string) => {
    if (synced.has(orgId)) return;
    synced.add(orgId);
    try {
      const r = await syncTeam(admin, stripe, orgId);
      if (r.action !== "none") notes.push({ org_id: orgId, why, action: r.action, seats: r.seats });
    } catch (e) {
      notes.push({ org_id: orgId, why, error: String((e as Error)?.message ?? e) });
    }
  };

  // 1. Checkouts Stripe finished that we never heard about.
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const pending = await admin.from("team_checkouts").select("id, stripe_session_id")
    .is("completed_at", null).not("stripe_session_id", "is", null).gte("created_at", since)
    .order("created_at", { ascending: true }).limit(25);
  if (pending.error) throw new Error(`checkouts read failed: ${pending.error.message}`);
  for (const c of pending.data ?? []) {
    if (late()) { truncated = true; break; }
    try {
      const s = await stripe.checkout.sessions.retrieve(c.stripe_session_id as string);
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
      if (s.status !== "complete" || !subId) continue;
      const out = await completeTeamCheckout(admin, stripe, { checkoutId: c.id as string, sessionId: s.id, subscriptionId: subId });
      if (out.ok) completed++;
      notes.push({ checkout: c.id, ok: out.ok, error: out.error ?? null, undone: out.undone ?? false });
    } catch (e) {
      notes.push({ checkout: c.id, error: String((e as Error)?.message ?? e) });
    }
  }

  // 2. Seat changes not on Stripe yet.
  const unbilled = await admin.from("org_seat_changes").select("org_id").is("billed_at", null).limit(1000);
  if (unbilled.error) throw new Error(`seat changes read failed: ${unbilled.error.message}`);
  for (const orgId of new Set((unbilled.data ?? []).map((r) => r.org_id as string))) {
    if (late()) { truncated = true; break; }
    await syncOnce(orgId, "unbilled");
  }

  // 3–6. Every subscription a team still has.
  const subs = await admin.from("org_subscriptions")
    .select("org_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, trial_end, observed_at, organizations(name, seats, closed_at)")
    .in("status", LIVE).limit(1000);
  if (subs.error) throw new Error(`team mirror read failed: ${subs.error.message}`);

  for (const s of subs.data ?? []) {
    if (late()) { truncated = true; break; }
    const orgId = s.org_id as string;
    const org = s.organizations as unknown as { name: string; seats: number; closed_at: string | null } | null;
    if (!org) continue;
    try {
      if (org.closed_at) { await syncOnce(orgId, "closed"); continue; }

      if (trimDue({ status: s.status as string, cancelAtPeriodEnd: Boolean(s.cancel_at_period_end), periodEnd: s.current_period_end as string })) {
        const t = await admin.rpc("_team_trim_seats", { p_org: orgId });
        if (t.error) throw new Error(`trim failed: ${t.error.message}`);
        if (Number(t.data) < Number(org.seats)) { trimmed++; synced.delete(orgId); await syncOnce(orgId, "renewal"); continue; }
      }

      const seen = Date.parse((s.observed_at as string | null) ?? "");
      if (!synced.has(orgId) && (!Number.isFinite(seen) || Date.now() - seen > REVERIFY_AFTER_MS)) {
        await mirrorTeamSubscription(admin, stripe, orgId, s.stripe_subscription_id as string);
        reread++;
      }

      if (trialEndingSoon({ status: s.status as string, trialEnd: s.trial_end as string })) {
        if (await trialNotice(admin, orgId, org.name as string, s.trial_end as string, Number(org.seats))) noticed++;
      }
    } catch (e) {
      notes.push({ org_id: orgId, error: String((e as Error)?.message ?? e) });
    }
  }

  return { ok: true, completed, synced: synced.size, trimmed, reread, noticed, truncated, notes: notes.slice(0, 50) };
}

// Once per trial: the owner and admins hear when the card is first charged.
async function trialNotice(admin: Admin, orgId: string, name: string, trialEnd: string, seats: number) {
  const prior = await admin.from("notifications").select("id", { count: "exact", head: true })
    .eq("kind", "team.trial_ending").eq("data->>org_id", orgId)
    .gte("created_at", new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString());
  if (prior.error) throw new Error(`notice read failed: ${prior.error.message}`);
  if ((prior.count ?? 0) > 0) return false;
  const people = await admin.from("org_members").select("user_id").eq("org_id", orgId).in("role", ["owner", "admin"]);
  if (people.error) throw new Error(`team people read failed: ${people.error.message}`);
  const day = new Date(trialEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  for (const p of people.data ?? []) {
    const n = await admin.rpc("_team_notify", {
      p_user: p.user_id, p_kind: "team.trial_ending", p_org: orgId, p_workspace: null, p_actor: null,
      p_title: `${name}'s trial ends ${day}`,
      p_body: `On ${day} the card on file is charged for ${seats} seats. The owner can cancel from the team's billing before then.`,
    });
    if (n.error) throw new Error(`notice failed: ${n.error.message}`);
  }
  return true;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
