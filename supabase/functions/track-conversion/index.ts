// track-conversion — POST { event_name, event_id?, fbp?, fbc? }
//
// Browser-origin server-side conversion emitter. Account creation finishes in a
// Postgres trigger (handle_new_user), so there's no edge function in the signup
// path to fire CompleteRegistration from — this small function fills that gap and
// keeps the CAPI access token server-side (never shipped to the browser).
//
// Auth: requires a Bearer user JWT (the caller just signed in). We read the
// hashed email + user id from the verified token — the client can't spoof
// someone else's identity. Event names are allowlisted.
//
// Not listed in config.toml → default verify_jwt=true at the gateway, same as
// create-checkout-session / verify-checkout-session. The browser always calls
// this with a valid session token.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { emitCapi, clientIpFromHeaders } from "../_shared/meta-capi.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY;
const APP_URL      = Deno.env.get("APP_URL") || "";

// Standard events this endpoint is allowed to forward. Keep tight — anything
// with a server-trusted dedup key + value (Purchase, Lead) is emitted from its
// own authoritative function instead.
const ALLOWED_EVENTS = new Set(["CompleteRegistration"]);

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  try {
    const auth  = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return json({ error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const u = await userClient.auth.getUser();
    if (u.error || !u.data.user?.id) return json({ error: "invalid token" }, 401);

    const userId = u.data.user.id;
    const email  = u.data.user.email || null;

    let body: { event_name?: string; event_id?: string; fbp?: string; fbc?: string };
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

    const eventName = String(body.event_name || "");
    if (!ALLOWED_EVENTS.has(eventName)) return json({ error: "event_name not allowed" }, 400);

    // Default dedup key is stable per user+event so a misfire (e.g. an existing
    // user re-firing on a new device) can never double-count: it collapses into
    // the user's original CompleteRegistration.
    const eventId = String(body.event_id || `reg:${userId}`).slice(0, 200);

    emitCapi({
      eventName,
      eventId,
      actionSource: "website",
      eventSourceUrl: APP_URL || undefined,
      userData: {
        email,
        externalId: userId,
        fbp: typeof body.fbp === "string" ? body.fbp : null,
        fbc: typeof body.fbc === "string" ? body.fbc : null,
        clientIpAddress: clientIpFromHeaders(req),
        clientUserAgent: req.headers.get("user-agent"),
      },
    });

    return json({ ok: true }, 200);
  } catch (e) {
    console.error("[track-conversion] error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
