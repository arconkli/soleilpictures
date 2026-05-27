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
//   deno run --allow-env --allow-net scripts/backfill-stripe-subscriptions.ts [--apply]

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const apply = Deno.args.includes("--apply");

const STRIPE_KEY     = mustEnv("STRIPE_SECRET_KEY");
const SUPABASE_URL   = mustEnv("SUPABASE_URL");
const SERVICE_KEY    = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const PRICE_MONTHLY  = Deno.env.get("STRIPE_PRICE_MONTHLY") || "";
const PRICE_ANNUAL   = Deno.env.get("STRIPE_PRICE_ANNUAL")  || "";

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });
const admin  = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function mustEnv(k: string): string {
  const v = Deno.env.get(k);
  if (!v) { console.error(`Missing required env: ${k}`); Deno.exit(2); }
  return v;
}

function planFromPriceId(priceId: string | undefined): "monthly" | "annual" | null {
  if (!priceId) return null;
  if (priceId === PRICE_MONTHLY) return "monthly";
  if (priceId === PRICE_ANNUAL)  return "annual";
  return null;
}

function periodEndFromSubscription(sub: Stripe.Subscription): string | null {
  const epoch = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end
    ?? null;
  return epoch ? new Date(epoch * 1000).toISOString() : null;
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

  const plan   = planFromPriceId(sub.items.data[0]?.price?.id);
  const periodEnd = periodEndFromSubscription(sub);
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
  const shouldFlipTier = (sub.status === "active" || sub.status === "trialing");

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

  if (!apply) continue;

  const upsert = await admin.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    plan,
    status: sub.status,
    current_period_end: periodEnd,
    cancel_at_period_end: cancelAtPeriodEnd,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (upsert.error) { console.error(`    ✗ subscriptions upsert: ${upsert.error.message}`); continue; }

  if (shouldFlipTier && currentTier !== "admin" && currentTier !== "paid") {
    const flip = await admin.from("profiles").update({ tier: "paid" }).eq("user_id", userId).neq("tier", "admin");
    if (flip.error) { console.error(`    ✗ tier flip: ${flip.error.message}`); continue; }
    console.log(`    ✓ flipped tier=paid`);
  } else if (!shouldFlipTier && currentTier === "paid") {
    // Stripe says canceled/unpaid but we have them as paid — drop to demo.
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
