// lifecycle-email-cron — daily behavioral lifecycle email scan.
//
// Sends three "simple note" emails to users who fall into a lifecycle segment
// (see migration 0173): activate_nudge_1, activate_nudge_2, reengage_1.
// Invoked once a day by pg_cron (job 'lifecycle-email-daily').
//
// Per email type: query the eligibility RPC, then for each recipient
//   1. CLAIM via lifecycle_claim_send (atomic cap lock + consent re-check).
//      Returns a log id, or null if a cap was hit / consent was withdrawn.
//   2. Only if claimed: POST to send-transactional-email.
//   3. Mark the log row 'sent' (on success) or 'failed' (on error).
// The row exists BEFORE the send (claim-first), so a crash after a successful
// send can never re-send — combined with the unique indexes this is at-most-once.
//
// Authorization (mirrors waitlist-accept-cron): EITHER
//   • x-cron-secret: <CRON_SECRET>          (pg_cron)
//   • Bearer <SUPABASE_SERVICE_ROLE_KEY>    (manual curl / admin tools)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET       = Deno.env.get("CRON_SECRET") || "";
const SEND_EMAIL_SECRET = Deno.env.get("SEND_EMAIL_SECRET") || "";

const PER_TYPE_LIMIT = 500;   // cap recipients per type per run
const MAX_SENDS      = 800;   // cap total sends per run
const SEND_GAP_MS    = 120;   // ~8/s, comfortably under Resend's ceiling

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendOne(
  template: string, to: string, data: Record<string, unknown>, idempotencyKey: string,
): Promise<{ ok: boolean; id?: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-transactional-email`, {
    method: "POST",
    headers: { "authorization": `Bearer ${SEND_EMAIL_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ template, to, data, idempotencyKey }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) console.warn(`send ${template} failed: ${res.status}`, body);
  return { ok: res.ok, id: body?.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  const cronHeader = req.headers.get("x-cron-secret") || "";
  const auth       = req.headers.get("authorization") || "";
  const bearer     = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const okCron     = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const okService  = !!SERVICE_KEY && bearer === SERVICE_KEY;
  if (!okCron && !okService) return json({ error: "unauthorized" }, 401);
  if (!SEND_EMAIL_SECRET)    return json({ error: "SEND_EMAIL_SECRET not set" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const mailed = new Set<string>();   // user_ids already mailed this run (cohorts can overlap)
  let totalSent = 0;
  const summary: Record<string, unknown> = {};

  async function runType(
    emailType: string,
    rpcName: string,
    // deno-lint-ignore no-explicit-any
    toData: (row: any) => Record<string, unknown>,
  ) {
    let eligible = 0, sent = 0, skipped = 0, failed = 0;
    let errMsg: string | undefined;

    if (totalSent < MAX_SENDS) {
      const { data, error } = await admin.rpc(rpcName, {});
      if (error) {
        errMsg = error.message;
      } else {
        // deno-lint-ignore no-explicit-any
        const rows: any[] = data || [];
        eligible = rows.length;

        for (const row of rows.slice(0, PER_TYPE_LIMIT)) {
          if (totalSent >= MAX_SENDS) break;
          const userId = String(row.user_id);
          if (mailed.has(userId)) { skipped++; continue; }

          const claim = await admin.rpc("lifecycle_claim_send", {
            p_user_id: userId, p_email_type: emailType, p_recipient_email: row.email,
          });
          if (claim.error) { failed++; continue; }
          const logId = claim.data as number | null;
          if (!logId) { skipped++; continue; }   // cap hit or consent withdrawn
          mailed.add(userId);

          const payload = { ...toData(row), firstName: row.display_name, unsubscribeToken: row.unsub_token };
          let ok = false, resendId: string | undefined;
          try {
            const r = await sendOne(emailType, String(row.email), payload, `lifecycle:${userId}:${emailType}`);
            ok = r.ok; resendId = r.id;
          } catch (e) { console.warn(`send threw for ${userId}`, e); }

          await admin.from("lifecycle_email_log")
            .update({ status: ok ? "sent" : "failed", resend_id: resendId ?? null })
            .eq("id", logId);

          if (ok) { sent++; totalSent++; } else { failed++; }
          await sleep(SEND_GAP_MS);
        }
      }
    }
    summary[emailType] = errMsg ? { eligible, sent, skipped, failed, error: errMsg }
                                : { eligible, sent, skipped, failed };
  }

  // Priority order: win-back first, then the final activation nudge, then the
  // first — the per-run `mailed` set guarantees a user gets at most one today.
  await runType("reengage_1", "lifecycle_due_reengage_1", (row) => ({
    workspaceId: row.workspace_id, boardId: row.board_id, boardName: row.board_name,
  }));
  await runType("activate_nudge_2", "lifecycle_due_activate_nudge_2", (row) => ({
    workspaceId: row.workspace_id,
  }));
  await runType("activate_nudge_1", "lifecycle_due_activate_nudge_1", (row) => ({
    workspaceId: row.workspace_id,
  }));

  return json({ ok: true, totalSent, summary }, 200);
});
