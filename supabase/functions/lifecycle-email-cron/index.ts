// lifecycle-email-cron — hourly behavioral lifecycle email scan.
//
// Sends "simple note" lifecycle emails to users who fall into a segment (see
// migrations 0173 / 0184 / 0194 / 0211): welcome_board (day-1, embeds the
// user's own board thumbnail), whats_new (news win-back — the broadest dormant
// gate, re-fires once per published edition), board_waiting (picture win-back),
// reengage_1 (text win-back), nudge_dormant_early (never-activated gap-filler),
// activate_nudge_1/2. Invoked hourly by pg_cron (job 'lifecycle-email-hourly').
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

// Signed image URL for welcome_board, served by the soleil-boards Worker's
// public /api/email-thumb route (email clients fetch <img> unauthenticated,
// possibly weeks after send — the HMAC in the URL is the whole gate). The
// HMAC secret lives in app_config 'email_thumb_hmac' (migration 0186): the
// Worker and this runtime hold DIFFERENT-format Supabase credentials, so a
// credential-derived key mismatched — a shared DB row is identical by
// construction. Derivation MIRRORS worker.js emailThumbSig — keep in lockstep:
// hmacKey = SHA-256(secret + ":email-thumb-v1"),
// sig     = hex(HMAC-SHA256(hmacKey, "email-thumb:" + boardId)).slice(0, 32).
const SITE_ORIGIN = "https://clusters.soleilpictures.com";

let emailThumbSecretCache = { secret: "", at: 0 };
async function emailThumbSecret(): Promise<string> {
  if (emailThumbSecretCache.secret && Date.now() - emailThumbSecretCache.at < 300_000) {
    return emailThumbSecretCache.secret;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_config?key=eq.email_thumb_hmac&select=value`, {
    headers: { "apikey": SERVICE_KEY, "authorization": `Bearer ${SERVICE_KEY}`, "accept": "application/json" },
  });
  if (!res.ok) throw new Error(`email_thumb_hmac fetch ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const rows: any[] = await res.json().catch(() => []);
  const secret = rows?.[0]?.value?.secret || "";
  if (!secret) throw new Error("email_thumb_hmac missing");
  emailThumbSecretCache = { secret, at: Date.now() };
  return secret;
}

async function emailThumbUrl(boardId: string, thumbUpdatedAt?: string | null): Promise<string> {
  const enc = new TextEncoder();
  const secret = await emailThumbSecret();
  const keyBytes = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}:email-thumb-v1`));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`email-thumb:${boardId}`));
  const sig = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  const v = thumbUpdatedAt ? (Date.parse(thumbUpdatedAt) || 0) : 0;
  return `${SITE_ORIGIN}/api/email-thumb/${boardId}?v=${v}&s=${sig}`;
}

// whats_new's copy lives in app_config 'lifecycle_whats_new' (migration 0211)
// so publishing an edition is a row update rather than a deploy. image_path is
// OPTIONAL and must sit under /email/ — templates.ts only embeds an image whose
// URL starts with the app origin + /email/, and anything else degrades to a
// text note. An edition with no items is not news, so we skip the type entirely
// rather than send "your stuff is still here" under a news subject line.
interface WhatsNewConfig {
  enabled: boolean; version: string; items: string[];
  imageUrl?: string; ctaLabel?: string;
}

// ignoreEnabled is for the testTo preview path ONLY: an edition is authored
// disabled and must be renderable to a test inbox before it is switched on.
// The batch path never passes it.
async function whatsNewConfig(
  admin: ReturnType<typeof createClient>, ignoreEnabled = false,
): Promise<WhatsNewConfig | null> {
  const { data, error } = await admin
    .from("app_config").select("value").eq("key", "lifecycle_whats_new").maybeSingle();
  if (error) { console.warn("lifecycle_whats_new fetch failed", error.message); return null; }
  // deno-lint-ignore no-explicit-any
  const v: any = data?.value;
  if (!v) return null;
  if (!ignoreEnabled && v.enabled !== true) return null;
  const version = String(v.version ?? "").trim();
  const items = Array.isArray(v.items) ? v.items.map((i: unknown) => String(i ?? "")).filter(Boolean) : [];
  if (!version || !items.length) return null;
  const path = String(v.image_path ?? "").trim();
  return {
    enabled: true, version, items,
    imageUrl: path.startsWith("/email/") ? `${SITE_ORIGIN}${path}` : undefined,
    ctaLabel: v.cta_label ? String(v.cta_label) : undefined,
  };
}

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

// Weighted random pick from a { arm: weight } map. Returns "" if the map is
// empty or every weight is zero, so callers can fall back.
// deno-lint-ignore no-explicit-any
function weightedPick(weights: any): string {
  const entries = Object.entries(weights || {}).filter(([, w]) => Number(w) > 0);
  if (!entries.length) return "";
  const total = entries.reduce((s, [, w]) => s + Number(w), 0);
  let r = Math.random() * total;
  for (const [arm, w] of entries) { r -= Number(w); if (r <= 0) return arm; }
  return String(entries[0][0]);
}

// Pick the copy variant for one send.
//
// Factorial types (migration 0219) carry a `factors` object and draw the
// subject and body arms INDEPENDENTLY, logging the pair as "<subject>.<body>"
// — e.g. "s3.b2". Independence is the whole point: it lets the optimizer score
// each factor marginally, pooling over the other, so five subjects cost the
// sample of five arms rather than fifteen.
//
// Flat types (the low-volume ones, still A/B) keep the old single-draw path.
// deno-lint-ignore no-explicit-any
function pickVariant(cfg: any, emailType: string): string {
  const conf = cfg?.[emailType];
  const factors = conf?.factors;
  if (factors) {
    const s = weightedPick(factors.subject?.weights) || "s1";
    const b = weightedPick(factors.body?.weights)    || "b1";
    return `${s}.${b}`;
  }
  return weightedPick(conf?.weights) || "A";
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

  // Test hook: POST { testTo, testType?, workspaceId?, boardId?, boardName? }
  // sends ONE email to a chosen address, bypassing eligibility/claim/log — for
  // previewing render + From + deliverability before a real batch.
  // deno-lint-ignore no-explicit-any
  const reqBody: any = await req.json().catch(() => ({}));
  if (reqBody && reqBody.testTo) {
    const type = String(reqBody.testType || "activate_nudge_1");
    // welcome_board previews get a real signed thumb URL (or an explicit
    // override) so the embedded image can be verified end to end.
    let thumbUrl = reqBody.thumbUrl ? String(reqBody.thumbUrl) : undefined;
    if (!thumbUrl && (type === "welcome_board" || type === "board_waiting" || type === "whats_new") && reqBody.boardId) {
      thumbUrl = await emailThumbUrl(String(reqBody.boardId),
        reqBody.thumbUpdatedAt ? String(reqBody.thumbUpdatedAt) : null);
    }
    // whats_new previews pull the LIVE published edition, so what lands in the
    // test inbox is exactly what the batch would send.
    let newsPreview: WhatsNewConfig | null = null;
    if (type === "whats_new") {
      const previewDb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      newsPreview = await whatsNewConfig(previewDb, /* ignoreEnabled */ true);
      if (!newsPreview) return json({ error: "no lifecycle_whats_new edition authored" }, 409);
    }
    const r = await sendOne(type, String(reqBody.testTo), {
      firstName: "there",
      workspaceId: reqBody.workspaceId ? String(reqBody.workspaceId) : undefined,
      boardId: reqBody.boardId ? String(reqBody.boardId) : undefined,
      boardName: reqBody.boardName ? String(reqBody.boardName) : undefined,
      thumbUrl,
      imageUrl: newsPreview?.imageUrl,
      items: newsPreview?.items,
      ctaLabel: newsPreview?.ctaLabel,
      version: newsPreview?.version,
      variant: reqBody.variant ? String(reqBody.variant) : undefined,
      unsubscribeToken: "0".repeat(64),
      // Date.now() in the key: repeat test sends must not be swallowed by
      // Resend's idempotency window while iterating on copy.
    }, `test:${String(reqBody.testTo)}:${type}:${reqBody.variant || "A"}:${Date.now()}`);
    return json({ ok: r.ok, test: true, id: r.id, thumbUrl }, r.ok ? 200 : 502);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Per-user send timing: only email users whose preferred active hour == now.
  const hour = new Date().getUTCHours();
  // Current bandit weights for the copy variants (per email type).
  const variantCfg = (await admin.rpc("lifecycle_email_variant_weights")).data || {};

  const mailed = new Set<string>();   // user_ids already mailed this run (cohorts can overlap)
  let totalSent = 0;
  const summary: Record<string, unknown> = {};

  async function runType(
    emailType: string,
    rpcName: string,
    // deno-lint-ignore no-explicit-any
    toData: (row: any) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ) {
    let eligible = 0, sent = 0, skipped = 0, failed = 0;
    let errMsg: string | undefined;

    if (totalSent < MAX_SENDS) {
      const { data, error } = await admin.rpc(rpcName, { p_hour: hour });
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

          const variant = pickVariant(variantCfg, emailType);
          // Only whats_new returns a content_version — it's what makes that type
          // re-fire once per published edition (unique index in 0211). Taken from
          // the eligibility row rather than re-read here, so a config edit
          // mid-run can't claim one version and send another.
          const contentVersion = row.content_version != null ? String(row.content_version) : null;
          const claim = await admin.rpc("lifecycle_claim_send", {
            p_user_id: userId, p_email_type: emailType, p_recipient_email: row.email, p_variant: variant,
            p_content_version: contentVersion,
          });
          if (claim.error) { failed++; continue; }
          const logId = claim.data as number | null;
          if (!logId) { skipped++; continue; }   // cap hit or consent withdrawn
          mailed.add(userId);

          const payload = { ...(await toData(row)), firstName: row.display_name, unsubscribeToken: row.unsub_token, variant };
          let ok = false, resendId: string | undefined;
          try {
            // The version rides in the idempotency key: a second edition to the
            // same user is a DIFFERENT email and must not be swallowed by
            // Resend's dedup window on the first one's key.
            const idem = contentVersion
              ? `lifecycle:${userId}:${emailType}:${contentVersion}`
              : `lifecycle:${userId}:${emailType}`;
            const r = await sendOne(emailType, String(row.email), payload, idem);
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

  // Priority order (highest-intent / most-perishable first — it wins the
  // one-per-day unique index AND the `mailed` set): day-1 welcome, then the
  // picture win-back, then the text win-back, then the never-activated gap-
  // filler, then the final activation nudge, then the first.
  await runType("welcome_board", "lifecycle_due_welcome_board", async (row) => {
    // Best-effort image: a secret-fetch hiccup degrades to a text-only note
    // rather than crashing the run mid-claim (claims are once-ever).
    let thumbUrl: string | undefined;
    try {
      if (row.board_id) {
        thumbUrl = await emailThumbUrl(String(row.board_id),
          row.thumb_updated_at ? String(row.thumb_updated_at) : null);
      }
    } catch (e) { console.warn("emailThumbUrl failed", e); }
    return { workspaceId: row.workspace_id, boardId: row.board_id, boardName: row.board_name, thumbUrl };
  });
  // whats_new is the broadest dormant gate (any activation state, no account-age
  // ceiling), so it runs FIRST among the win-backs and wins the one-per-day
  // index and the `mailed` set. The narrower legacy types below stay in place as
  // fallbacks for users who already have this edition. Skipped entirely when no
  // edition is published — never send a news email with no news.
  const news = await whatsNewConfig(admin);
  if (news) {
    await runType("whats_new", "lifecycle_due_whats_new", async (row) => {
      let thumbUrl: string | undefined;
      try {
        if (row.board_id && row.thumb_key) {
          thumbUrl = await emailThumbUrl(String(row.board_id),
            row.thumb_updated_at ? String(row.thumb_updated_at) : null);
        }
      } catch (e) { console.warn("emailThumbUrl failed", e); }
      return {
        workspaceId: row.workspace_id, boardId: row.board_id, boardName: row.board_name,
        thumbUrl, imageUrl: news.imageUrl, items: news.items,
        ctaLabel: news.ctaLabel, version: news.version,
      };
    });
  } else {
    summary["whats_new"] = { eligible: 0, sent: 0, skipped: 0, failed: 0, note: "no published edition" };
  }
  // board_waiting embeds the user's own board thumbnail, exactly like
  // welcome_board — same best-effort degrade path.
  await runType("board_waiting", "lifecycle_due_board_waiting", async (row) => {
    let thumbUrl: string | undefined;
    try {
      if (row.board_id) {
        thumbUrl = await emailThumbUrl(String(row.board_id),
          row.thumb_updated_at ? String(row.thumb_updated_at) : null);
      }
    } catch (e) { console.warn("emailThumbUrl failed", e); }
    return { workspaceId: row.workspace_id, boardId: row.board_id, boardName: row.board_name, thumbUrl };
  });
  await runType("reengage_1", "lifecycle_due_reengage_1", (row) => ({
    workspaceId: row.workspace_id, boardId: row.board_id, boardName: row.board_name,
  }));
  await runType("nudge_dormant_early", "lifecycle_due_nudge_dormant_early", (row) => ({
    workspaceId: row.workspace_id, boardId: row.board_id, boardName: row.board_name,
  }));
  await runType("activate_nudge_2", "lifecycle_due_activate_nudge_2", (row) => ({
    workspaceId: row.workspace_id, boardId: row.board_id, boardName: row.board_name,
  }));
  await runType("activate_nudge_1", "lifecycle_due_activate_nudge_1", (row) => ({
    workspaceId: row.workspace_id, boardId: row.board_id, boardName: row.board_name,
  }));

  return json({ ok: true, totalSent, summary }, 200);
});
