// send-transactional-email — single Resend-backed sender for all
// branded transactional email. Called by:
//   • other edge functions (submit-waitlist, admin-waitlist-action,
//     waitlist-accept-cron) over HTTP
//   • DB triggers on share_notifications + workspace_members via pg_net
//
// Authentication: shared bearer secret SEND_EMAIL_SECRET. NOT the user JWT
// (triggers can't supply one). Set via `supabase secrets set SEND_EMAIL_SECRET=...`.
//
// Body: { template: TemplateName, to: string, data?: Record<string, unknown> }
//
// On Resend failure we log + return 502, but the *caller* is expected to
// fire-and-forget — a failed email must never roll back a DB write or
// fail a user-visible action.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { renderTemplate, TEMPLATE_NAMES, type TemplateName } from "../_shared/email/templates.ts";

const RESEND_API_KEY    = Deno.env.get("RESEND_API_KEY") || "";
const SEND_EMAIL_SECRET = Deno.env.get("SEND_EMAIL_SECRET") || "";
const FROM_ADDRESS      = "Clusters <hello@clusters.soleilpictures.com>";
const REPLY_TO          = "hello@clusters.soleilpictures.com";

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
}

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
  if (token !== SEND_EMAIL_SECRET) return json({ error: "unauthorized" }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  if (!body.template || !TEMPLATE_NAMES.includes(body.template as TemplateName)) {
    return json({ error: `unknown template: ${body.template}` }, 400);
  }
  if (!body.to || !isEmail(body.to)) {
    return json({ error: "invalid 'to' address" }, 400);
  }

  const rendered = renderTemplate(body.template as TemplateName, body.data || {});

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${RESEND_API_KEY}`,
      "content-type":  "application/json",
    },
    body: JSON.stringify({
      from:     FROM_ADDRESS,
      to:       [body.to],
      subject:  rendered.subject,
      html:     rendered.html,
      text:     rendered.text,
      reply_to: REPLY_TO,
    }),
  });

  const resendBody = await resendRes.json().catch(() => ({}));
  if (!resendRes.ok) {
    console.error("resend failure", {
      status: resendRes.status,
      template: body.template,
      to: body.to,
      body: resendBody,
    });
    return json({ error: "resend failed", detail: resendBody }, 502);
  }

  return json({ ok: true, id: resendBody.id }, 200);
});
