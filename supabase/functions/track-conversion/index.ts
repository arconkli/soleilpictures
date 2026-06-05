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

// Standard events this endpoint forwards. CompleteRegistration fires for any
// signed-in new account; Lead is the ad-cohort parallel to the waitlist Lead
// (submit-waitlist owns the organic one) — gated below to ad_signups members so
// an arbitrary authed client can't fire it. Purchase stays in its own fn.
const ALLOWED_EVENTS = new Set(["CompleteRegistration", "Lead"]);

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

    // Server-trusted dedup keys. Lead is ad-cohort only: verify ad_signups
    // membership with the service role, then FORCE lead:<uid> so it can't be
    // spoofed and dedups with the organic waitlist Lead (same key). Others
    // default to reg:<uid> but accept a caller key.
    let eventId: string;
    if (eventName === "Lead") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const { data: adRow, error: adErr } = await admin.from("ad_signups").select("user_id").eq("user_id", userId).maybeSingle();
      if (adErr) return json({ error: "membership lookup failed" }, 500);   // surface real DB errors, don't silently drop the Lead
      if (!adRow) return json({ ok: true, skipped: "not_ad_cohort" }, 200);
      eventId = `lead:${userId}`;
    } else {
      eventId = String(body.event_id || `reg:${userId}`).slice(0, 200);
    }

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
