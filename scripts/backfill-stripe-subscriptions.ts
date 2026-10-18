// Backfill currently-stuck paid users.
//
// Before this lands, the stripe-webhook was returning 401 at the Supabase
// gateway (the function ran with verify_jwt=true, but Stripe doesn't carry a
// user JWT), so every checkout.session.completed event was dropped on the
// floor. Users who actually paid never had their tier flipped.
//
// This script reconciles the world: for every Stripe subscription in
// active/trialing/past_due state, find the matching Supabase user (metadata
// first, then email) and upsert the local row + flip tier=paid.
//
// Dry-run by default. Pass --apply to write.
//
// Run:
//   STRIPE_SECRET_KEY=sk_live_... \
//   SUPABASE_URL=https://ehlhlmbpwwalmeisvmdp.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   STRIPE_PRICE_MONTHLY=price_... \
//   STRIPE_PRICE_ANNUAL=price_... \
//   [STRIPE_PRODUCT_CREATOR=prod_... STRIPE_PRODUCT_STORAGE=prod_... \
//    STRIPE_PRICE_STORAGE_MONTHLY=price_... STRIPE_PRICE_STORAGE_ANNUAL=price_...] \
//   deno run --allow-env --allow-net scripts/backfill-stripe-subscriptions.ts [--apply]
//
// Pinned to the SDK the edge functions run (classic billing: one interval per
// subscription, which extra storage relies on). Which item is the plan, what
// the mirror row holds and who keeps the plan come from activateCore — the
// same rules the webhook and the reconcile cron apply — so this script cannot
// write a row they would disagree with.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import Stripe from "npm:stripe@17.7.0";
import {
  entitlementFromSubscription,
  mirrorFieldsFromSubscription,
  subscriptionEventAction,
} from "../supabase/functions/_shared/activateCore.mjs";

const apply = Deno.args.includes("--apply");

const STRIPE_KEY     = mustEnv("STRIPE_SECRET_KEY");
const SUPABASE_URL   = mustEnv("SUPABASE_URL");
const SERVICE_KEY    = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const env = (k: string) => Deno.env.get(k) || null;
const CFG = {
  creatorProduct: env("STRIPE_PRODUCT_CREATOR"),
  storageProduct: env("STRIPE_PRODUCT_STORAGE"),
  creatorPrices: { monthly: env("STRIPE_PRICE_MONTHLY"), annual: env("STRIPE_PRICE_ANNUAL") },
  storagePrices: { monthly: env("STRIPE_PRICE_STORAGE_MONTHLY"), annual: env("STRIPE_PRICE_STORAGE_ANNUAL") },
};

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });
const admin  = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function mustEnv(k: string): string {
  const v = Deno.env.get(k);
  if (!v) { console.error(`Missing required env: ${k}`); Deno.exit(2); }
  return v;
}

async function resolveUserId(customerId: string, metaUid: string | null, email: string | null): Promise<string | null> {
  if (metaUid) return metaUid;
  const existing = await admin.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  if (existing.data?.user_id) return existing.data.user_id as string;
  if (email) {
    const r = await admin.rpc("user_id_by_email", { p_email: email.toLowerCase() });
    if (!r.error && r.data) return r.data as string;
  }
  return null;
}

console.log(`[backfill] mode=${apply ? "APPLY" : "DRY-RUN"} — listing Stripe subscriptions…`);

let scanned = 0;
let matched = 0;
let written = 0;
let alreadyPaid = 0;
let unresolved = 0;

// Iterate every subscription Stripe has for this account, regardless of
// status — we want to capture canceled subs too so the local row reflects
// reality (status='canceled' should be visible in admin / billing UI).
// Every row this run writes was observed no earlier than this.
const listedAt = new Date().toISOString();
for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100, expand: ["data.customer"] })) {
  scanned++;
  const customer = sub.customer as Stripe.Customer | Stripe.DeletedCustomer | string;
  const customerId = typeof customer === "string" ? customer : customer.id;
  const email = (typeof customer === "object" && !("deleted" in customer)) ? (customer.email || null) : null;
  const metaUid = (sub.metadata?.supabase_user_id as string | undefined) || null;

  const userId = await resolveUserId(customerId, metaUid, email);
  if (!userId) {
    unresolved++;
    console.log(`  ? sub=${sub.id} customer=${customerId} email=${email ?? "?"} → no matching Supabase user`);
    continue;
  }
  matched++;

  const fields = mirrorFieldsFromSubscription(sub, CFG);
  const plan   = fields.plan;
  const periodEnd = fields.current_period_end;
  const cancelAtPeriodEnd = fields.cancel_at_period_end;
  // A listed subscription carries no expanded latest_invoice, so a past_due
  // one is judged on the grace window alone (activateCore).
  const entitled = entitlementFromSubscription(sub, { cfg: CFG }).entitled;
  const shouldFlipTier = entitled && (sub.status === "active" || sub.status === "trialing");

  // What does the local DB say right now?
  const localProfile = await admin.from("profiles").select("tier").eq("user_id", userId).maybeSingle();
  const localSub     = await admin.from("subscriptions").select("status, plan, current_period_end, cancel_at_period_end, stripe_subscription_id").eq("user_id", userId).maybeSingle();
  const currentTier  = localProfile.data?.tier as string | undefined;

  const localSummary  = localSub.data
    ? `tier=${currentTier ?? "?"} sub=${localSub.data.stripe_subscription_id ?? "—"} status=${localSub.data.status ?? "—"}`
    : `tier=${currentTier ?? "?"} sub=(none)`;
  const remoteSummary = `status=${sub.status} plan=${plan ?? "?"} ends=${periodEnd ?? "?"} cancel_pending=${cancelAtPeriodEnd}`;
  console.log(`  • ${email ?? userId} → ${localSummary}  vs  ${remoteSummary}`);

  if (currentTier === "paid" && localSub.data?.status === sub.status && localSub.data?.stripe_subscription_id === sub.id && Boolean(localSub.data?.cancel_at_period_end) === cancelAtPeriodEnd) {
    alreadyPaid++;
    continue;
  }

  // One mirror row per user: a second subscription on the same customer may
  // only take the row over from a terminal one (activateCore), or a canceled
  // duplicate listed after the live one would demote a paying user.
  const action = subscriptionEventAction({
    kind: "updated",
    eventSubId: sub.id,
    storedSubId: (localSub.data?.stripe_subscription_id as string | undefined) ?? null,
    storedStatus: (localSub.data?.status as string | undefined) ?? null,
  });
  if (action === "skip") {
    console.log(`    – skipped: the mirror tracks ${localSub.data?.stripe_subscription_id}, which is still live`);
    continue;
  }

  if (!apply) continue;

  const upsert = await admin.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    ...fields,
    observed_at: listedAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (upsert.error) { console.error(`    ✗ subscriptions upsert: ${upsert.error.message}`); continue; }

  if (shouldFlipTier && currentTier !== "admin" && currentTier !== "paid") {
    const flip = await admin.from("profiles").update({ tier: "paid" }).eq("user_id", userId).neq("tier", "admin");
    if (flip.error) { console.error(`    ✗ tier flip: ${flip.error.message}`); continue; }
    console.log(`    ✓ flipped tier=paid`);
  } else if (!entitled && currentTier === "paid") {
    // Stripe says the plan is not paid for any more — drop to demo, unless a
    // paid grant carries the account (the check every demotion path makes).
    const grantQ = await admin.rpc("user_has_active_paid_grant", { p_user_id: userId });
    if (grantQ.error) { console.error(`    ✗ grant check: ${grantQ.error.message}`); continue; }
    if (grantQ.data === true) { console.log(`    ✓ subscription row synced (a paid grant keeps the tier)`); written++; continue; }
    const flip = await admin.from("profiles").update({ tier: "demo" }).eq("user_id", userId).eq("tier", "paid");
    if (flip.error) { console.error(`    ✗ tier drop: ${flip.error.message}`); continue; }
    console.log(`    ✓ dropped tier=demo (Stripe status=${sub.status})`);
  } else {
    console.log(`    ✓ subscription row synced (tier unchanged)`);
  }
  written++;
}

console.log("");
console.log(`[backfill] scanned=${scanned} matched=${matched} unresolved=${unresolved} alreadyOk=${alreadyPaid} written=${written}`);
console.log(`[backfill] ${apply ? "Wrote changes." : "Dry run only. Re-run with --apply to write."}`);
