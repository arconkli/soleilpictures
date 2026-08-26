// delete-own-account — a person removing their own account.
//
// The erasure itself is the same sequence admin-account-action performs for the
// `delete` action, and the ORDER is load-bearing:
//
//   1. prepare_account_deletion  — hand shared workspaces to their longest-
//                                  standing other member; delete the ones only
//                                  this account is in, which cascades every
//                                  board, card, comment, tag and image row.
//   2. cancel the Stripe sub     — never strand a subscription billing an
//                                  account that no longer exists.
//   3. anonymize analytics       — MUST run while user_id is still set. After
//      + client errors             deletion the FKs only SET NULL, which leaves
//                                  the rows correlatable by session_id.
//   4. auth.admin.deleteUser     — cascades profiles, tokens, memberships, the
//                                  lot.
//
// WHY A SEPARATE FUNCTION FROM admin-account-action. That one is shaped around
// acting on somebody else: it takes a user_id in the body and gates on the
// caller being an admin. This one takes NO user_id at all — the subject is
// derived from the caller's own JWT and cannot be pointed anywhere else, so no
// bug in a branch here can ever reach another person's account. The two
// concerns do not belong behind one auth check.
//
// Step 1 lives in Postgres rather than here because it must be atomic: a
// transfer that half-succeeded would leave a workspace ownerless, which is the
// exact outcome the transfer exists to prevent.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

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

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

// Cancel the caller's Stripe subscription now (if one is live) and mark our row
// canceled. Idempotent — tolerates a sub Stripe already canceled. Same shape as
// admin-account-action's helper, deliberately: a divergence here would mean one
// of the two paths quietly kept billing.
async function cancelStripeSub(admin: Admin, userId: string): Promise<boolean> {
  const row = await admin.from("subscriptions")
    .select("stripe_subscription_id, status").eq("user_id", userId).maybeSingle();
  const subId  = (row.data?.stripe_subscription_id as string | null) ?? null;
  const status = (row.data?.status as string | null) ?? null;
  const live = ["active", "trialing", "past_due", "unpaid", "paused"].includes(status ?? "");
  if (!subId || !live) return false;

  try {
    await stripe.subscriptions.cancel(subId);
  } catch (e) {
    const msg = (e as Error)?.message || "";
    if (!/no such subscription|resource_missing|already canceled|canceled/i.test(msg)) throw e;
  }
  await admin.from("subscriptions").update({
    status: "canceled",
    cancel_at_period_end: false,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return true;
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

    // The ONLY subject this function will ever act on.
    const userId = u.data.user.id;
    const email  = (u.data.user.email || "").trim().toLowerCase();

    let body: { confirm_email?: string };
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

    // Re-typing the address is the confirmation. Checked HERE and not only in
    // the dialog, so the endpoint cannot delete an account on an empty POST —
    // a mis-wired fetch, a replayed request, or anything that reaches it
    // without a person having read the screen.
    const confirm = (body?.confirm_email || "").trim().toLowerCase();
    if (!email) {
      // A Scout shell account has no address to re-type. It also has no way to
      // sign back in, so deleting it from here would be irreversible on the
      // strength of a session alone.
      return json({ error: "add an email address to your account before deleting it" }, 409);
    }
    if (confirm !== email) return json({ error: "confirmation does not match your email" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Refuse on an admin account. Losing the last admin to a mistyped-but-
    // matching confirmation is not recoverable from inside the product.
    const me = await admin.from("profiles").select("tier").eq("user_id", userId).maybeSingle();
    if (me.data?.tier === "admin") {
      return json({ error: "admin accounts are removed by another admin, not from here" }, 409);
    }

    // 1. Hand over / clear out. Transactional inside Postgres.
    const prep = await admin.rpc("prepare_account_deletion", { p_user_id: userId });
    if (prep.error) return json({ error: `could not prepare deletion: ${prep.error.message}` }, 500);

    // 2. Stop the billing.
    let canceled = false;
    try {
      canceled = await cancelStripeSub(admin, userId);
    } catch (e) {
      // Deleting the account while a subscription keeps charging is the one
      // outcome worth refusing over — the workspaces are already handled and
      // this is retryable, whereas a deleted auth user is not.
      return json({ error: `could not cancel your subscription: ${(e as Error).message}` }, 502);
    }

    // 3. GDPR erasure of the behavioural trail, BEFORE the FKs null out.
    const anon = await admin.rpc("anonymize_user_analytics", { p_user_id: userId });
    if (anon.error) console.error("[delete-own-account] anonymize_user_analytics", anon.error.message);
    const anonErr = await admin.rpc("anonymize_user_client_errors", { p_user_id: userId });
    if (anonErr.error) console.error("[delete-own-account] anonymize_user_client_errors", anonErr.error.message);

    // 4. The account itself.
    const del = await admin.auth.admin.deleteUser(userId);
    if (del.error) return json({ error: `could not delete the account: ${del.error.message}` }, 500);

    return json({
      ok: true,
      workspaces_transferred: prep.data?.workspaces_transferred ?? 0,
      workspaces_deleted: prep.data?.workspaces_deleted ?? 0,
      subscription_canceled: canceled,
      analytics_anonymized: anon.data ?? null,
      errors_anonymized: anonErr.data ?? null,
    }, 200);
  } catch (e) {
    console.error("[delete-own-account]", e);
    return json({ error: (e as Error)?.message || "unexpected error" }, 500);
  }
});
