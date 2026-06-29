// resend-webhook — POST endpoint Resend calls on email delivery events.
//
// Resend signs webhooks with svix. We verify the signature (RESEND_WEBHOOK_SECRET
// is the svix signing secret from the Resend dashboard) and then hand the event
// to the ingest_email_event RPC (migration 0175), which:
//   • dedups on the svix message id (a redelivered webhook is a no-op),
//   • creates a stub email_sends row for mail we didn't pre-log (e.g. GoTrue
//     auth mail in the same Resend account), and
//   • folds delivered/opened/clicked/bounced/complained into the send row.
//
// Event types subscribed: email.sent, email.delivered, email.delivery_delayed,
// email.opened, email.clicked, email.bounced, email.complained.
//
// Must be deployed with verify_jwt=false (see supabase/config.toml) so Resend
// can reach it without a Supabase user JWT. The svix signature is the auth
// boundary — we verify it before touching the DB.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  if (!WEBHOOK_SECRET) {
    console.error("resend-webhook: RESEND_WEBHOOK_SECRET not set");
    return new Response("service not configured", { status: 500 });
  }

  const raw           = await req.text();
  const svixId        = req.headers.get("svix-id") || "";
  const svixTimestamp = req.headers.get("svix-timestamp") || "";
  const svixSignature = req.headers.get("svix-signature") || "";
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("missing signature headers", { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    event = wh.verify(raw, {
      "svix-id":        svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (err) {
    console.warn("resend-webhook: signature verification failed", (err as Error)?.message);
    return new Response("invalid signature", { status: 400 });
  }

  const type     = String(event?.type ?? "");
  const data     = event?.data ?? {};
  const resendId = data?.email_id ? String(data.email_id) : null;
  const to       = Array.isArray(data?.to) ? (data.to[0] ?? null) : (data?.to ?? null);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const { error } = await admin.rpc("ingest_email_event", {
      p_svix_id:   svixId,
      p_resend_id: resendId,
      p_type:      type,
      p_payload:   event,
      p_recipient: to,
    });
    // A failed write returns 500 so Resend retries (ingest is idempotent on
    // svix-id, so a retry after a partial failure is safe).
    if (error) {
      console.error("resend-webhook: ingest_email_event failed", error.message);
      return new Response("ingest failed", { status: 500 });
    }
  } catch (e) {
    console.error("resend-webhook: ingest threw", (e as Error)?.message || String(e));
    return new Response("ingest error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
