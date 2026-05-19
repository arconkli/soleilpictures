// waitlist-accept-cron — invoked by pg_cron every 10 minutes.
//
// For every waitlist_entries row where status='pending' and
// scheduled_accept_at <= now(), this function:
//   1. Looks up the user_id by email (the user already exists — they
//      OTP-verified at signup, which created the auth.users row).
//   2. Flips profile.tier from 'waitlist' to 'demo'. Skips users whose
//      tier is already 'admin' or 'paid' (defensive).
//   3. Marks the waitlist row accepted.
//   4. Sends a branded "you're in" welcome email via send-transactional-email.
//      No OTP is included — the user clicks through to /sign-in and requests
//      a fresh code via the existing magic_link.html flow.
//
// Authorization: accept EITHER
//   • Bearer <SUPABASE_SERVICE_ROLE_KEY>          (admin tools, manual curl)
//   • x-cron-secret: <CRON_SECRET>                (pg_cron)
// The cron.job row at id 6 sends the latter; for months prior to this
// fix the function only accepted the former, so every scheduled tick
// returned 401 and the auto-accept flow never worked end-to-end.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET       = Deno.env.get("CRON_SECRET") || "";
const SEND_EMAIL_SECRET = Deno.env.get("SEND_EMAIL_SECRET") || "";

async function sendEmail(template: string, to: string, data: Record<string, unknown> = {}) {
  if (!SEND_EMAIL_SECRET) { console.warn("SEND_EMAIL_SECRET not set; skipping " + template); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: { "authorization": `Bearer ${SEND_EMAIL_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ template, to, data }),
    });
    if (!res.ok) console.warn(`send-transactional-email ${template} -> ${to} failed: ${res.status}`);
  } catch (e) { console.warn(`send-transactional-email ${template} -> ${to} threw`, e); }
}

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

  const due = await admin.from("waitlist_entries")
    .select("id, email")
    .eq("status", "pending")
    .lte("scheduled_accept_at", new Date().toISOString())
    .limit(50);
  if (due.error) return json({ error: due.error.message }, 500);

  const results: Array<{ email: string; ok: boolean; reason?: string }> = [];
  for (const row of due.data || []) {
    try {
      await acceptOne(admin, row.id, row.email);
      results.push({ email: row.email, ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ email: row.email, ok: false, reason: msg });
    }
  }
  return json({ ok: true, processed: results.length, results }, 200);
});

async function acceptOne(admin: ReturnType<typeof createClient>, entryId: string, email: string) {
  // User already exists (auth.users row was created when they OTP-verified
  // at signup, BEFORE submitting the socials form). Look them up via the
  // existing user_id_by_email RPC.
  const lookup = await admin.rpc("user_id_by_email", { p_email: email });
  if (lookup.error) throw lookup.error;
  const userId = lookup.data as string | null;
  if (!userId) throw new Error("no auth.users row for " + email);

  // Flip tier: only 'waitlist' → 'demo'. Don't touch 'admin'/'paid'.
  const tierUpd = await admin.from("profiles")
    .update({ tier: "demo" })
    .eq("user_id", userId)
    .eq("tier", "waitlist");
  if (tierUpd.error) throw tierUpd.error;

  const entryUpd = await admin.from("waitlist_entries")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", entryId);
  if (entryUpd.error) throw entryUpd.error;

  // Welcome email — branded "you're in" message with a CTA to /sign-in.
  // The user requests a fresh OTP at sign-in via the existing magic_link.html flow.
  await sendEmail("waitlist_accepted", email);
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
