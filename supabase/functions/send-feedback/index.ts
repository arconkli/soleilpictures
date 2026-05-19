// send-feedback — POST endpoint for the in-app feedback widget.
//
// Body: { kind: 'bug'|'idea'|'praise'|'other', message: string,
//         url?: string, viewport?: string, user_agent?: string }
//
// Auth is OPTIONAL — anonymous visitors should still be able to
// flag a broken thing. When the request includes a valid bearer
// token, we attribute to that user; otherwise user_id is null.
// Service role inserts so RLS doesn't fight us.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY;

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

const KINDS = new Set(["bug", "idea", "praise", "other"]);

interface Body {
  kind?: string;
  message?: string;
  url?: string;
  viewport?: string;
  user_agent?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const kind = String(body.kind || "").trim();
  const message = String(body.message || "").trim();
  if (!KINDS.has(kind)) return json({ error: "invalid kind" }, 400);
  if (message.length < 2 || message.length > 4000) return json({ error: "message must be 2..4000 chars" }, 400);

  // Resolve user_id from bearer if present; no auth required.
  let userId: string | null = null;
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (token) {
    try {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      });
      const u = await userClient.auth.getUser();
      if (!u.error && u.data.user) userId = u.data.user.id;
    } catch (_) { /* anonymous OK */ }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const ins = await admin.from("feedback").insert({
    user_id: userId,
    kind,
    message,
    url:        body.url        ? String(body.url).slice(0, 1024)      : null,
    viewport:   body.viewport   ? String(body.viewport).slice(0, 64)   : null,
    user_agent: body.user_agent ? String(body.user_agent).slice(0, 512): null,
  });
  if (ins.error) return json({ error: ins.error.message }, 500);
  return json({ ok: true }, 200);
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
