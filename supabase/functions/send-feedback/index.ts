// send-feedback — POST endpoint for the in-app Send feedback modal.
//
// Body:   { choice?: string, message?: string, context?: object,
//           contact_ok?: boolean, url?: string, viewport?: string,
//           user_agent?: string, image_data_url?: string }
// Legacy: { kind: 'bug'|'idea'|'praise'|'other', message: string, … }
//
// A one-tap TOPIC (`choice`) is a complete answer on its own — the words are
// optional. Each topic files under one of the established kinds (TOPIC_KIND),
// so every reader of bug/idea/praise/other keeps working, and the topic itself
// is kept in feedback.choice. Without a topic the legacy contract holds: a kind
// and at least two characters, which is what every client before 2026-10-01
// sends.
//
// This function keeps no copy of the labels or of the context whitelist. The
// feedback_before_write trigger (0348) gives a topic-only row its label as its
// message and cleans `context` down to the whitelisted scalars, for every writer
// at once. boards/src/lib/feedbackContract.test.mjs pins TOPIC_KIND against the
// client's topics and the server's labels.
//
// Auth is OPTIONAL in this code — anonymous visitors could flag a broken thing.
// When the request includes a valid bearer token, we attribute to that user;
// otherwise user_id is null (and contact_ok is forced false: there is nobody to
// write back to). Service role inserts so RLS doesn't fight us.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
// Never fall back to the service-role key here: with no Authorization header
// on the request, the apikey alone selects the role, and a missing anon key
// would silently make this "user" client SERVICE ROLE. Supabase injects
// SUPABASE_ANON_KEY into every edge function, so this only fires on a broken deploy.
if (!ANON_KEY) throw new Error("SUPABASE_ANON_KEY is not set; refusing to fall back to the service-role key");

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

const KINDS = new Set(["bug", "idea", "praise", "other"]);

// Topic → the kind it files under. A Map, not an object literal: `"constructor"
// in {}` is true, and a typed topic must never resolve through a prototype.
const TOPIC_KIND = new Map<string, string>([
  ["broke", "bug"],
  ["slow", "bug"],
  ["missing_feature", "idea"],
  ["love", "praise"],
  ["confusing", "other"],
  ["pricing", "other"],
  ["other", "other"],
]);

// The database keeps only its whitelisted keys; this bound just stops a client
// from shipping a megabyte for the trigger to throw away.
const MAX_CONTEXT_CHARS = 4096;

interface Body {
  kind?: string;
  choice?: string;
  message?: string;
  context?: unknown;
  contact_ok?: unknown;
  url?: string;
  viewport?: string;
  user_agent?: string;
  image_data_url?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const choice = String(body.choice || "").trim();
  let kind: string;
  if (choice) {
    const k = TOPIC_KIND.get(choice);
    if (!k) return json({ error: "invalid choice" }, 400);
    kind = k;
  } else {
    kind = String(body.kind || "").trim();
    if (!KINDS.has(kind)) return json({ error: "invalid kind" }, 400);
  }

  const message = String(body.message || "").trim();
  if (message.length > 4000) return json({ error: "message must be at most 4000 chars" }, 400);
  // A topic alone is a whole answer; the legacy shape still needs words.
  if (!choice && message.length < 2) return json({ error: "message must be 2..4000 chars" }, 400);

  let context: Record<string, unknown> | null = null;
  if (body.context && typeof body.context === "object" && !Array.isArray(body.context)) {
    try {
      if (JSON.stringify(body.context).length <= MAX_CONTEXT_CHARS) context = body.context as Record<string, unknown>;
    } catch (_) { /* unserialisable: drop it, keep the feedback */ }
  }

  // Optional screenshot — a base64 data URL the client already downscaled.
  let imageDataUrl: string | null = null;
  if (body.image_data_url) {
    const v = String(body.image_data_url);
    if (!v.startsWith("data:image/")) return json({ error: "invalid image" }, 400);
    if (v.length > 3_000_000) return json({ error: "image too large" }, 413);
    imageDataUrl = v;
  }

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
    choice: choice || null,
    // Empty for a topic-only answer: the trigger writes the topic's label.
    message: message || null,
    context,
    contact_ok: userId !== null && body.contact_ok === true,
    url:        body.url        ? String(body.url).slice(0, 1024)      : null,
    viewport:   body.viewport   ? String(body.viewport).slice(0, 64)   : null,
    user_agent: body.user_agent ? String(body.user_agent).slice(0, 512): null,
    image_data_url: imageDataUrl,
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
