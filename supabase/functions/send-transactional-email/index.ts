// send-transactional-email — single Resend-backed sender for all
// branded transactional email. Called by:
//   • other edge functions (submit-waitlist, admin-waitlist-action,
//     waitlist-accept-cron) over HTTP
//   • DB triggers on share_notifications + workspace_members via pg_net
//
// Authentication: shared bearer secret SEND_EMAIL_SECRET. NOT the user JWT
// (triggers can't supply one). Set via `supabase secrets set SEND_EMAIL_SECRET=...`.
//
// Body: { template: TemplateName, to: string, data?: Record<string, unknown>,
//         actorId?: uuid }   (actorId: who caused it — _notify_email_send, 0369)
//
// ops_alert (0369) is the exception to "to": it always goes to OPS_ALERT_TO,
// whatever the request says, from the alerts@ address.
//
// On Resend failure we log + return 502, but the *caller* is expected to
// fire-and-forget — a failed email must never roll back a DB write or
// fail a user-visible action.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderTemplate, TEMPLATE_NAMES, type TemplateName } from "../_shared/email/templates.ts";

const RESEND_API_KEY    = Deno.env.get("RESEND_API_KEY") || "";
const SEND_EMAIL_SECRET = Deno.env.get("SEND_EMAIL_SECRET") || "";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Where security alerts go. Fixed server-side: a request cannot redirect them.
const OPS_ALERT_TO      = Deno.env.get("OPS_ALERT_TO") || "andrew@andrewconklin.com";

// Service-role client used ONLY for the universal email_sends log (migration
// 0175). Created lazily so the function still runs if the env is missing.
const logDb = (SUPABASE_URL && SERVICE_KEY)
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  : null;

// Coarse bucket for the dashboard, derived from the template name.
function emailCategory(template: string): string {
  if (template === "ops_alert") return "ops";
  if (/^activate_|^reengage_|^welcome_|^board_waiting$|^nudge_dormant_early$|^whats_new$/.test(template)) return "lifecycle";
  if (template.startsWith("waitlist_"))       return "waitlist";
  return "transactional";
}

// Log every send (success or our-side failure) into email_sends. This is the
// single choke point all outbound mail passes through, so one insert here
// captures 100% of it. NON-FATAL: a logging hiccup must never turn a delivered
// email into a 502 — we only console.warn. user_id is resolved by a DB trigger
// from the recipient address.
async function logEmailSend(opts: {
  template: string; to: string; ok: boolean; resendId?: string; errorBody?: unknown; actorId?: string | null;
}): Promise<void> {
  if (!logDb) return;
  try {
    await logDb.from("email_sends").insert({
      resend_id:       opts.ok ? (opts.resendId ?? null) : null,
      template:        opts.template,
      category:        emailCategory(opts.template),
      recipient_email: opts.to,
      status:          opts.ok ? "sent" : "failed",
      error:           opts.ok ? null : JSON.stringify(opts.errorBody ?? null).slice(0, 500),
      // 0369: who caused it, so a bounce or complaint traces back to an account.
      actor_id:        opts.actorId ?? null,
    });
  } catch (e) {
    console.warn("email_sends log failed", (e as Error)?.message || String(e));
  }
}

// Per-template From routing.
//   • hello@clusters.soleilpictures.com  → onboarding-class (waitlist).
//     Replies to this inbox are deliberately welcomed.
//   • noreply@updates.soleilpictures.com → activity-class (invites, shares,
//     mentions, comment replies). Replies aren't expected; reply_to still
//     points at hello@ so any stray reply lands somewhere a human reads.
const FROM_HELLO   = "Clusters <hello@clusters.soleilpictures.com>";
const FROM_NOREPLY = "Clusters <noreply@updates.soleilpictures.com>";
// Lifecycle nudges send from the brand on the bulk subdomain — keeping
// marketing reputation off the auth domain (which carries the sign-in codes).
const FROM_LIFECYCLE = "Clusters <hello@updates.soleilpictures.com>";
// Security alerts to the owner (0369): never the bulk domain, whose reputation
// is exactly what an abuse alert is likely to be about.
const FROM_ALERTS    = "Clusters Alerts <alerts@clusters.soleilpictures.com>";
const REPLY_TO       = "hello@clusters.soleilpictures.com";

function fromAddress(template: string): string {
  switch (template) {
    case "waitlist_submitted":
    case "waitlist_accepted":
      return FROM_HELLO;
    case "activate_nudge_1":
    case "activate_nudge_2":
    case "reengage_1":
    case "welcome_board":
    case "board_waiting":
    case "nudge_dormant_early":
    case "whats_new":
      return FROM_LIFECYCLE;
    // Activity-class, not marketing: both are triggered by something that
    // happened rather than by a schedule, so they belong on the same
    // from-address as shares and mentions.
    case "schedule_update":
    case "share_activity":
      return FROM_NOREPLY;
    case "ops_alert":
      return FROM_ALERTS;
    default:
      return FROM_NOREPLY;
  }
}

// One-click List-Unsubscribe (RFC 8058) — required by Gmail/Yahoo for bulk
// senders. Only attached to lifecycle (marketing) templates, and only when a
// valid 64-hex unsubscribe token is present. Transactional/auth mail gets none.
//
// schedule_update is here despite being activity-class: a published call sheet
// reaches an entire crew at once, which is exactly the volume shape Gmail's
// bulk-sender rules are about, and a crew member who wants out needs one click
// rather than a Settings tab they have never opened.
//
// mention_email and comment_reply_email joined in 0369: one person can cause
// them, so the person receiving them gets the same one-click way out.
const LIST_UNSUB_TEMPLATES = new Set(["activate_nudge_1", "activate_nudge_2", "reengage_1", "welcome_board", "board_waiting", "nudge_dormant_early", "whats_new", "schedule_update", "share_activity", "mention_email", "comment_reply_email"]);

// WHICH preference the one-click link turns off. This used to be hardcoded to
// email_lifecycle, so the moment a second unsubscribable template existed the
// header would have silently muted the wrong thing — someone opting out of
// call sheets would have stopped getting product tips instead, and kept the
// call sheets.
const UNSUB_KEY_BY_TEMPLATE: Record<string, string> = {
  schedule_update:     "email_schedule",
  share_activity:      "email_share_activity",
  mention_email:       "email_mentions",
  comment_reply_email: "email_comment_replies",
};

function listUnsubHeaders(template: string, data: Record<string, unknown> = {}): Record<string, string> {
  const tok = String(data.unsubscribeToken ?? "");
  if (!LIST_UNSUB_TEMPLATES.has(template) || !/^[0-9a-f]{64}$/.test(tok)) return {};
  const key = UNSUB_KEY_BY_TEMPLATE[template] ?? "email_lifecycle";
  const url = `https://clusters.soleilpictures.com/api/unsubscribe?u=${tok}&k=${key}`;
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

interface Body {
  template?: string;
  to?: string;
  data?: Record<string, unknown>;
  idempotencyKey?: string;   // optional Resend dedup key (lifecycle cron sets it)
  actorId?: string | null;   // the account that caused it (0369)
}

// The email a person's action sends to someone else. The database gate
// (_outbound_gate, 0369) decides each one; this is the backstop behind it: if
// more than USER_TRIGGERED_HOURLY_CEILING of them have gone out in the last
// hour, something got past the gate, so refuse and page instead of sending.
// Far above any real hour, far below a blast.
const USER_TRIGGERED = ["pending_invite", "board_shared", "workspace_invite", "mention_email",
                        "comment_reply_email", "schedule_update", "invite_accepted"];
const USER_TRIGGERED_HOURLY_CEILING = 200;

async function overHourlyCeiling(template: string): Promise<boolean> {
  if (!logDb || !USER_TRIGGERED.includes(template)) return false;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await logDb.from("email_sends")
    .select("id", { count: "exact", head: true })
    .in("template", USER_TRIGGERED)
    .gte("sent_at", since);
  if (error || count == null) return false;   // a counting failure must not stop mail
  if (count < USER_TRIGGERED_HOURLY_CEILING) return false;
  const { error: alertErr } = await logDb.rpc("ops_alert_raise", {
    p_kind: "edge_ceiling",
    p_title: `The email sender refused mail: ${count} user-triggered emails in the last hour`,
    p_body: `send-transactional-email stops user-triggered mail above ${USER_TRIGGERED_HOURLY_CEILING} an hour. ` +
            `Something sent more than the database gate should allow. Latest template: ${template}.`,
    p_page: true,
    p_dedupe_key: "edge_ceiling",
    p_dedupe_window: "1 hour",
  });
  if (alertErr) console.warn("ops_alert_raise failed", alertErr.message);
  return true;
}

// Constant-time: the comparison must not tell a caller how much of the secret
// it got right.
function secretMatches(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  if (!SEND_EMAIL_SECRET) {
    console.error("send-transactional-email: SEND_EMAIL_SECRET not set");
    return json({ error: "service not configured" }, 500);
  }
  if (!RESEND_API_KEY) {
    console.error("send-transactional-email: RESEND_API_KEY not set");
    return json({ error: "service not configured" }, 500);
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!secretMatches(token, SEND_EMAIL_SECRET)) return json({ error: "unauthorized" }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  if (!body.template || !TEMPLATE_NAMES.includes(body.template as TemplateName)) {
    return json({ error: `unknown template: ${body.template}` }, 400);
  }
  // ops_alert goes to the owner and nowhere else, whatever `to` says.
  const to = body.template === "ops_alert" ? OPS_ALERT_TO : body.to;
  if (!to || !isEmail(to)) {
    return json({ error: "invalid 'to' address" }, 400);
  }
  const actorId = typeof body.actorId === "string" && UUID_RE.test(body.actorId) ? body.actorId : null;

  if (await overHourlyCeiling(body.template)) {
    console.error("send-transactional-email: hourly ceiling reached; refused", { template: body.template });
    return json({ error: "hourly ceiling reached" }, 429);
  }

  const rendered = renderTemplate(body.template as TemplateName, body.data || {});

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${RESEND_API_KEY}`,
      "content-type":  "application/json",
      ...(body.idempotencyKey ? { "Idempotency-Key": body.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from:     fromAddress(body.template as TemplateName),
      to:       [to],
      subject:  rendered.subject,
      html:     rendered.html,
      text:     rendered.text,
      reply_to: REPLY_TO,
      headers:  listUnsubHeaders(body.template as TemplateName, body.data || {}),
    }),
  });

  const resendBody = await resendRes.json().catch(() => ({}));
  if (!resendRes.ok) {
    console.error("resend failure", {
      status: resendRes.status,
      template: body.template,
      to,
      body: resendBody,
    });
    await logEmailSend({ template: body.template, to, ok: false, errorBody: resendBody, actorId });
    return json({ error: "resend failed", detail: resendBody }, 502);
  }

  await logEmailSend({ template: body.template, to, ok: true, resendId: resendBody.id, actorId });
  // An alert counts as delivered once Resend has it; until then the
  // dispatcher retries it (0369).
  const alertId = Number((body.data || {}).alertId);
  if (body.template === "ops_alert" && logDb && Number.isSafeInteger(alertId) && alertId > 0) {
    const { error } = await logDb.from("ops_alerts").update({ paged_at: new Date().toISOString() })
      .eq("id", alertId).is("paged_at", null);
    if (error) console.warn("ops_alerts paged_at stamp failed", error.message);
  }
  return json({ ok: true, id: resendBody.id }, 200);
});
