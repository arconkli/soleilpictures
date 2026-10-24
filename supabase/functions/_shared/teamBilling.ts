// teamBilling — the Deno half of the Team plan's billing (S3). It reads Stripe
// and writes the database through 0538's functions; teamBillingCore.mjs
// decides (tested in node), and 0538 decides what Stripe's answers mean for
// who can edit. Shared by team-billing (signed in), team-billing-cron (the
// sweep and the pokes) and stripe-webhook's team branch, so all three make the
// same team from the same checkout and write the same mirror.
//
// The database owns a team's seats (organizations.seats); Stripe follows them
// (syncTeam). A payment that can't make a team (the owner has one already,
// teams closed meanwhile, a second tab paid twice) is undone here: the
// subscription is canceled, a paid invoice refunded, and the operator flagged.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import Stripe from "npm:stripe@17.7.0";
import { billingConfig } from "./activate.ts";
import {
  TEAM_KIND,
  canSyncSeats,
  isTeamObject,
  seatSyncKey,
  seatSyncPlan,
  teamItems,
  teamMirrorFields,
} from "./teamBillingCore.mjs";

type Admin = ReturnType<typeof createClient>;

const ENDED = new Set(["canceled", "incomplete_expired"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Dark until the owner creates the Team prices and sets their secrets
// (team-billing answers not_available until then).
export function teamBillingReady(cfg = billingConfig()): boolean {
  return Boolean(cfg.teamPrices.monthly && cfg.teamPrices.annual);
}

// One observation of a subscription, for 0538's mirror. `observedAt` is when
// the Stripe read STARTED, so a read that raced a change looks older, never
// newer, and the mirror guard drops it.
function mirrorOf(sub: Stripe.Subscription, observedAt: string): Record<string, unknown> {
  return { ...teamMirrorFields(sub, billingConfig()), observed_at: observedAt };
}

async function readSubscription(stripe: Stripe, id: string) {
  const observedAt = new Date().toISOString();
  const sub = await stripe.subscriptions.retrieve(id, { expand: ["latest_invoice"] });
  return { sub, observedAt };
}

// Operator-review pointer, as stripe-webhook's billing_flag. Never throws.
export async function teamFlag(admin: Admin, userId: string | null, props: Record<string, unknown>, path: string) {
  try {
    const ins = await admin.from("analytics_events").insert({
      user_id: userId,
      event: "billing_flag",
      props: { team: true, ...props },
      path,
    });
    if (ins.error) console.warn("[teamBilling] billing_flag insert failed", ins.error.message);
  } catch (e) {
    console.warn("[teamBilling] billing_flag insert threw", (e as Error)?.message || String(e));
  }
}

// Which team a subscription pays for: the one the mirror follows, else the
// one its checkout made (or, paying again, the one it was for).
export async function orgForSubscription(admin: Admin, sub: Stripe.Subscription): Promise<string | null> {
  const bySub = await admin.from("org_subscriptions").select("org_id").eq("stripe_subscription_id", sub.id).maybeSingle();
  if (bySub.error) throw new Error(`team mirror read failed: ${bySub.error.message}`);
  if (bySub.data?.org_id) return bySub.data.org_id as string;
  const checkout = sub.metadata?.soleil_team_checkout;
  if (!checkout || !UUID_RE.test(checkout)) return null;
  const c = await admin.from("team_checkouts").select("org_id").eq("id", checkout).maybeSingle();
  if (c.error) throw new Error(`team checkout read failed: ${c.error.message}`);
  return (c.data?.org_id as string | undefined) ?? null;
}

// The team a Stripe customer belongs to, for the charge-trouble flag.
export async function orgForCustomer(admin: Admin, customerId: string): Promise<string | null> {
  const r = await admin.from("org_subscriptions").select("org_id").eq("stripe_customer_id", customerId).limit(1);
  if (r.error) throw new Error(`team mirror read failed: ${r.error.message}`);
  return (r.data?.[0]?.org_id as string | undefined) ?? null;
}

// Cancel now and refund what was paid: a payment that bought nothing.
async function undoTeamSubscription(
  admin: Admin, stripe: Stripe, sub: Stripe.Subscription, reason: string, ownerId: string | null,
) {
  if (!ENDED.has(sub.status)) {
    await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false }, { idempotencyKey: `team-undo:${sub.id}` });
  }
  let refunded = 0;
  const inv = sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  const pi = inv?.payment_intent ?? null;
  if (inv && inv.status === "paid" && (inv.amount_paid ?? 0) > 0 && pi) {
    const refund = await stripe.refunds.create({
      payment_intent: typeof pi === "string" ? pi : pi.id,
      metadata: { soleil_kind: TEAM_KIND, soleil_reason: reason },
    }, { idempotencyKey: `team-undo-refund:${inv.id}` });
    refunded = refund.amount ?? 0;
  }
  await teamFlag(admin, ownerId, {
    kind: "team_checkout_undone", reason, subscription_id: sub.id,
    refunded_cents: refunded, currency: inv?.currency ?? null,
  }, "/team-billing");
}

export interface CompleteResult {
  ok: boolean;
  error?: string;
  org_id?: string;
  kind?: string;
  created?: boolean;
  status?: string;
  subscription?: string;
  moved?: number;
  skipped?: number;
  undone?: boolean;
}

// A team checkout is done (stripe-webhook, team-billing's verify, the sweep,
// or the subscription's own event once an unfinished payment goes through):
// 0538 makes the team, or lets a lapsed one edit again, once. What it refuses
// is undone in Stripe here; what isn't paid yet waits.
export async function completeTeamCheckout(admin: Admin, stripe: Stripe, args: {
  checkoutId: string; sessionId: string | null; subscriptionId: string;
}): Promise<CompleteResult> {
  if (!UUID_RE.test(args.checkoutId)) return { ok: false, error: "no_checkout" };
  const { sub, observedAt } = await readSubscription(stripe, args.subscriptionId);
  if (!isTeamObject(sub) || sub.metadata?.soleil_team_checkout !== args.checkoutId) {
    return { ok: false, error: "not_this_checkout" };
  }
  const ck = await admin.from("team_checkouts").select("kind, org_id, owner_id").eq("id", args.checkoutId).maybeSingle();
  if (ck.error) throw new Error(`team checkout read failed: ${ck.error.message}`);
  // Paying again replaces the subscription the team had: which one, before.
  let previous: string | null = null;
  if (ck.data?.kind === "renew" && ck.data.org_id) {
    const prev = await admin.from("org_subscriptions").select("stripe_subscription_id").eq("org_id", ck.data.org_id).maybeSingle();
    if (prev.error) throw new Error(`team mirror read failed: ${prev.error.message}`);
    previous = (prev.data?.stripe_subscription_id as string | undefined) ?? null;
  }

  const r = await admin.rpc("_team_checkout_complete", {
    p_checkout: args.checkoutId,
    p_session: args.sessionId,
    p_mirror: mirrorOf(sub, observedAt),
  });
  if (r.error) throw new Error(`team checkout complete failed: ${r.error.message}`);
  const out = r.data as CompleteResult;
  const ownerId = (ck.data?.owner_id as string | undefined) ?? sub.metadata?.soleil_owner_id ?? null;

  if (!out.ok) {
    if (out.error !== "not_paid" && out.error !== "session_mismatch") {
      await undoTeamSubscription(admin, stripe, sub, out.error ?? "refused", ownerId);
      return { ...out, undone: true };
    }
    return out;
  }
  if (out.subscription && out.subscription !== sub.id) {
    // Another checkout's subscription already pays for this team.
    await undoTeamSubscription(admin, stripe, sub, "duplicate", ownerId);
    return { ...out, undone: true };
  }
  if (previous && previous !== sub.id) {
    // The lapsed subscription (unpaid, paused) must not start collecting again.
    const old = await stripe.subscriptions.retrieve(previous);
    if (!ENDED.has(old.status)) {
      await stripe.subscriptions.cancel(previous, { invoice_now: false, prorate: false },
        { idempotencyKey: `team-replaced:${previous}` });
    }
  }
  return out;
}

// One fresh read of a team's subscription into the mirror, and what it means.
export async function mirrorTeamSubscription(admin: Admin, stripe: Stripe, orgId: string, subscriptionId: string) {
  const { sub, observedAt } = await readSubscription(stripe, subscriptionId);
  const r = await admin.rpc("_team_mirror_upsert", { p_org: orgId, p_mirror: mirrorOf(sub, observedAt) });
  if (r.error) throw new Error(`team mirror upsert failed: ${r.error.message}`);
  return { status: r.data as string | null, sub };
}

export interface SyncResult {
  action: "none" | "update" | "cancel";
  seats?: number;
  billed?: number;
  marked?: number;
  status?: string | null;
  invoice_status?: string | null;
  hosted_invoice_url?: string | null;
  reason?: string;
}

// Stripe follows the database: a closed team's subscription is canceled now,
// and the seat item's quantity becomes organizations.seats (teamBillingCore
// seatSyncPlan says how it is charged). The changes it covered are marked
// billed, and the mirror is refreshed. `prorationDate` and `idempotencyKey`
// come from an admin's priced purchase (team-billing seats_add); every other
// sync converges on the seat count, so a retry and a racing poke share a key.
export async function syncTeam(admin: Admin, stripe: Stripe, orgId: string, opts: {
  prorationDate?: number; idempotencyKey?: string;
} = {}): Promise<SyncResult> {
  // The newest change first, then the seats: whatever the seats say covers it.
  const pend = await admin.from("org_seat_changes").select("id")
    .eq("org_id", orgId).is("billed_at", null).order("id", { ascending: false }).limit(1);
  if (pend.error) throw new Error(`seat changes read failed: ${pend.error.message}`);
  const upto = (pend.data?.[0]?.id as number | undefined) ?? null;
  const org = await admin.from("organizations").select("seats, closed_at").eq("id", orgId).maybeSingle();
  if (org.error) throw new Error(`team read failed: ${org.error.message}`);
  if (!org.data) return { action: "none", reason: "no_team" };
  const row = await admin.from("org_subscriptions").select("stripe_subscription_id").eq("org_id", orgId).maybeSingle();
  if (row.error) throw new Error(`team mirror read failed: ${row.error.message}`);
  const subId = (row.data?.stripe_subscription_id as string | undefined) ?? null;
  if (!subId) return { action: "none", reason: "no_subscription" };

  const desired = Number(org.data.seats);
  const closed = Boolean(org.data.closed_at);
  const { sub } = await readSubscription(stripe, subId);
  const { seat, seatsBilled } = teamItems(sub, billingConfig());
  const plan = seatSyncPlan({ desired, billed: seatsBilled, status: sub.status, closed });

  let invoice: Stripe.Invoice | null = null;
  if (plan.action === "cancel") {
    await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false }, { idempotencyKey: `team-close:${sub.id}` });
  } else if (plan.action === "update") {
    if (!seat) {
      await teamFlag(admin, null, { kind: "team_no_seat_item", org_id: orgId, subscription_id: sub.id }, "/team-billing-cron");
      return { action: "none", reason: "no_seat_item" };
    }
    // Default payment behaviour (allow_incomplete): the seats change at once
    // and a failed charge leaves an open invoice that Stripe retries, so the
    // team goes past_due and through the grace like any unpaid renewal.
    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: seat.id, quantity: plan.quantity }],
      proration_behavior: plan.proration as Stripe.SubscriptionUpdateParams.ProrationBehavior,
      ...(opts.prorationDate && plan.proration !== "none" ? { proration_date: opts.prorationDate } : {}),
      expand: ["latest_invoice"],
    }, { idempotencyKey: opts.idempotencyKey ?? seatSyncKey(orgId, upto, plan.quantity) });
    invoice = updated.latest_invoice && typeof updated.latest_invoice === "object" ? updated.latest_invoice : null;
  }

  // A fresh read, not the update's own answer: with an idempotency key a
  // retried request returns the FIRST response, which may be stale.
  const fresh = await mirrorTeamSubscription(admin, stripe, orgId, sub.id);
  const billedNow = teamItems(fresh.sub, billingConfig()).seatsBilled;
  let marked = 0;
  // Covered when Stripe bills what the database says, or when the
  // subscription can't take a change (closed, ended, unpaid, paused: a
  // renewal checkout counts the seats afresh).
  if (upto != null && (billedNow === desired || closed || !canSyncSeats(fresh.sub.status))) {
    const m = await admin.rpc("_team_mark_seats_billed", { p_org: orgId, p_upto: upto });
    if (m.error) throw new Error(`mark billed failed: ${m.error.message}`);
    marked = Number(m.data ?? 0);
  }
  return {
    action: plan.action as SyncResult["action"],
    seats: desired,
    billed: billedNow,
    marked,
    status: fresh.status,
    invoice_status: invoice?.status ?? null,
    hosted_invoice_url: invoice?.status === "open" ? invoice.hosted_invoice_url ?? null : null,
  };
}

// A team subscription changed (stripe-webhook): finish its checkout if that
// is still waiting on this payment, else mirror it onto its team.
export async function onTeamSubscriptionEvent(admin: Admin, stripe: Stripe, sub: Stripe.Subscription) {
  const checkout = sub.metadata?.soleil_team_checkout;
  if (checkout && UUID_RE.test(checkout)) {
    const c = await admin.from("team_checkouts").select("completed_at").eq("id", checkout).maybeSingle();
    if (c.error) throw new Error(`team checkout read failed: ${c.error.message}`);
    if (c.data && !c.data.completed_at) {
      const out = await completeTeamCheckout(admin, stripe, { checkoutId: checkout, sessionId: null, subscriptionId: sub.id });
      console.log("[teamBilling] checkout completed from its subscription", { checkout, ok: out.ok, error: out.error ?? null });
      return;
    }
  }
  const orgId = await orgForSubscription(admin, sub);
  if (!orgId) {
    console.warn("[teamBilling] team subscription with no team", { sub: sub.id });
    return;
  }
  // The mirror guard drops an older observation and a subscription the team
  // no longer follows, so a stale or stray event can't flip the team.
  await mirrorTeamSubscription(admin, stripe, orgId, sub.id);
}
