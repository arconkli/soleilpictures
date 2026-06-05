// Meta Conversions API (CAPI) sender — shared by every server-side conversion
// emit point (stripe-webhook, verify-checkout-session, submit-waitlist,
// track-conversion). Complements the browser pixel in boards/index.html so
// conversions survive ad blockers, Safari/iOS, and the off-domain Stripe
// Checkout page.
//
// Contract & safety:
//   • Fire-and-forget. emitCapi() never blocks the caller and never throws —
//     a CAPI outage or bad token must never break a checkout, activation,
//     waitlist write, or registration.
//   • PII (email, external_id) is SHA-256 hashed per Meta's requirement.
//     fbp / fbc / client IP / user-agent are sent RAW (Meta hashes/uses them
//     as-is for matching).
//   • If META_CAPI_TOKEN is unset, every call is a logged no-op. This file is
//     therefore safe to deploy BEFORE the access token exists — nothing sends
//     until the secret is added in the Supabase dashboard.
//
// Dedup: every event carries an event_id. Browser-pixel counterparts (Purchase
// on the success page, CompleteRegistration post-signup) reuse the SAME
// event_id so Meta collapses server + browser into one conversion. Deterministic
// ids (Stripe session id, reg:<uid>, lead:<uid>) also dedup webhook retries.

const PIXEL_ID  = Deno.env.get("META_PIXEL_ID")            || "1671656413978924";
const TOKEN     = Deno.env.get("META_CAPI_TOKEN")          || "";
const GRAPH_VER = Deno.env.get("META_GRAPH_VERSION")       || "v21.0";
const TEST_CODE = Deno.env.get("META_CAPI_TEST_EVENT_CODE") || "";

// First-party delivery log (meta_capi_log). Best-effort + service-role, written
// via PostgREST so this module stays dependency-light. NEVER affects the send.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")              || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const LOG_URL      = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/meta_capi_log` : "";

// Keep a detached promise alive past the response on Supabase Edge; no-op locally.
function keepAlive(p: Promise<unknown>): void {
  const er = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (er?.waitUntil) { try { er.waitUntil(p); } catch (_) { /* run detached */ } }
}

async function logCapi(eventName: string, eventId: string, ok: boolean, status: number | null, error: string | null): Promise<void> {
  if (!LOG_URL || !SERVICE_KEY) return;
  try {
    await fetch(LOG_URL, {
      method:  "POST",
      headers: {
        apikey:         SERVICE_KEY,
        authorization:  `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        prefer:         "return=minimal",
      },
      body: JSON.stringify({ event_name: eventName, event_id: eventId, ok, status, error: error ? error.slice(0, 500) : null }),
    });
  } catch (_) { /* best-effort: a logging failure must never affect the send */ }
}

// Fire the delivery log WITHOUT awaiting (so it can never add latency to the
// send path) but keep it alive via waitUntil so the row isn't lost.
function fireLog(eventName: string, eventId: string, ok: boolean, status: number | null, error: string | null): void {
  keepAlive(logCapi(eventName, eventId, ok, status, error));
}

export interface CapiUserData {
  email?: string | null;
  externalId?: string | null;     // our Supabase user id (hashed → external_id)
  fbp?: string | null;            // _fbp cookie (raw)
  fbc?: string | null;            // _fbc cookie (raw)
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
}

export interface CapiEvent {
  eventName: string;              // 'Purchase' | 'Lead' | 'CompleteRegistration' | ...
  eventId: string;                // dedup key
  eventTime?: number;             // unix seconds; defaults to now
  actionSource?: string;          // default 'website'
  eventSourceUrl?: string | null;
  userData: CapiUserData;
  customData?: Record<string, unknown>;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Normalize (trim + lowercase) then SHA-256 hex. Returns undefined for empties
// so we never send a hash of "".
async function hashedField(value: string | null | undefined): Promise<string | undefined> {
  const v = (value ?? "").trim().toLowerCase();
  return v ? await sha256Hex(v) : undefined;
}

async function buildUserData(u: CapiUserData): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const em  = await hashedField(u.email);
  if (em)  out.em = [em];
  const ext = await hashedField(u.externalId);
  if (ext) out.external_id = [ext];
  if (u.fbp)             out.fbp = u.fbp;
  if (u.fbc)             out.fbc = u.fbc;
  if (u.clientIpAddress) out.client_ip_address = u.clientIpAddress;
  if (u.clientUserAgent) out.client_user_agent = u.clientUserAgent;
  return out;
}

// Send one event. Never throws; logs on failure. Returns true iff a request was
// actually dispatched (false = no-op'd because the token isn't configured).
export async function sendCapiEvent(ev: CapiEvent): Promise<boolean> {
  if (!TOKEN) {
    console.log(`[meta-capi] no META_CAPI_TOKEN; skipping ${ev.eventName} (${ev.eventId})`);
    fireLog(ev.eventName, ev.eventId, false, null, "no_token");
    return false;
  }
  try {
    const event: Record<string, unknown> = {
      event_name:    ev.eventName,
      event_time:    ev.eventTime ?? Math.floor(Date.now() / 1000),
      event_id:      ev.eventId,
      action_source: ev.actionSource ?? "website",
      user_data:     await buildUserData(ev.userData),
    };
    if (ev.eventSourceUrl) event.event_source_url = ev.eventSourceUrl;
    if (ev.customData && Object.keys(ev.customData).length) event.custom_data = ev.customData;

    const payload: Record<string, unknown> = { data: [event] };
    if (TEST_CODE) payload.test_event_code = TEST_CODE;

    const url = `https://graph.facebook.com/${GRAPH_VER}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;
    const res = await fetch(url, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[meta-capi] ${ev.eventName} -> ${res.status}: ${txt.slice(0, 400)}`);
      fireLog(ev.eventName, ev.eventId, false, res.status, txt.slice(0, 400));
      return false;
    }
    fireLog(ev.eventName, ev.eventId, true, res.status, null);
    return true;
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.warn(`[meta-capi] ${ev.eventName} threw`, msg);
    fireLog(ev.eventName, ev.eventId, false, null, msg);
    return false;
  }
}

// Fire an emit WITHOUT delaying the caller's response. On Supabase Edge,
// EdgeRuntime.waitUntil keeps the worker alive until the POST resolves; if it's
// unavailable we let the promise run detached. Either way nothing is awaited and
// nothing throws upward.
export function emitCapi(ev: CapiEvent): void {
  keepAlive(sendCapiEvent(ev).catch(() => {}));
}

// Pull the best-effort client IP from a request's forwarding headers. The first
// entry of x-forwarded-for is the real client (the rest are proxies).
export function clientIpFromHeaders(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip") || null;
}
