// submit-waitlist — POST { links: string[], timezone: string }
//
// Requires Bearer auth (the user has already OTP-verified). We pull the
// email from the JWT — no chance to spam someone else's address. Inserts
// a row into waitlist_entries with a scheduled_accept_at computed as: a
// random number of days in [3,7] from now, snapped to the next weekday
// (Mon–Fri), at a random minute in the 18:00–21:00 window of the user's
// local timezone.
//
// Idempotent: if an entry for this email already exists in 'pending' state
// we return it as-is (don't reset the timer).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

interface Body {
  links?: string[];
  timezone?: string;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; }
  catch { return false; }
}

function getDateParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year:   Number(parts.year),
    month:  Number(parts.month),
    day:    Number(parts.day),
    hour:   Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function weekdayInTz(d: Date, tz: string): number {
  const wdName = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[wdName] ?? 0;
}

function utcForTzClockTime(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 3; i++) {
    const got = getDateParts(guess, tz);
    const wantMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const gotMs  = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, 0);
    const drift  = gotMs - wantMs;
    if (drift === 0) return guess;
    guess = new Date(guess.getTime() - drift);
  }
  return guess;
}

function computeScheduledAcceptAt(timezone: string | null): Date {
  const tz = (timezone && isValidTimezone(timezone)) ? timezone : "America/Los_Angeles";
  const offsetDays = randInt(3, 7);
  const nowParts = getDateParts(new Date(), tz);
  const baseUtc = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + offsetDays, 12, 0, 0));

  let walk = new Date(baseUtc);
  for (let i = 0; i < 7; i++) {
    const wd = weekdayInTz(walk, tz);
    if (wd >= 1 && wd <= 5) break;
    walk = new Date(walk.getTime() + 24 * 60 * 60 * 1000);
  }
  const localParts = getDateParts(walk, tz);
  const hour   = randInt(18, 20);
  const minute = randInt(0, 59);
  return utcForTzClockTime(localParts.year, localParts.month, localParts.day, hour, minute, tz);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  // Pull the user from the Bearer JWT — they must have OTP-verified.
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return json({ error: "auth required" }, 401);

  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const u = await userClient.auth.getUser();
  if (u.error || !u.data.user?.email) return json({ error: "invalid token" }, 401);

  const email = u.data.user.email.toLowerCase().trim();
  const userId = u.data.user.id;

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  // Socials are optional — users can join without submitting any links.
  const links = Array.isArray(body.links)
    ? body.links.map((l) => String(l ?? "").trim()).filter(Boolean).slice(0, 20).map((l) => l.slice(0, 500))
    : [];

  const timezone = typeof body.timezone === "string" && isValidTimezone(body.timezone) ? body.timezone : null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Caller must be on tier='waitlist' — paid/demo/admin users have no
  // business submitting a waitlist form.
  const prof = await admin.from("profiles").select("tier").eq("user_id", userId).maybeSingle();
  if (prof.error) return json({ error: prof.error.message }, 500);
  if (prof.data?.tier && prof.data.tier !== "waitlist") {
    return json({ error: `already ${prof.data.tier}`, tier: prof.data.tier }, 409);
  }

  const existing = await admin.from("waitlist_entries")
    .select("scheduled_accept_at, status")
    .eq("email", email)
    .maybeSingle();
  if (existing.error && existing.error.code !== "PGRST116") return json({ error: existing.error.message }, 500);
  if (existing.data && existing.data.status === "pending") {
    return json({ ok: true, status: "on_waitlist", scheduled_accept_at: existing.data.scheduled_accept_at }, 200);
  }

  const scheduledAcceptAt = computeScheduledAcceptAt(timezone);
  const upsert = await admin.from("waitlist_entries")
    .upsert({
      email,
      links,
      timezone,
      status: "pending",
      scheduled_accept_at: scheduledAcceptAt.toISOString(),
      accepted_at: null,
      rejected_at: null,
    }, { onConflict: "email" });
  if (upsert.error) return json({ error: upsert.error.message }, 500);

  return json({ ok: true, status: "queued", scheduled_accept_at: scheduledAcceptAt.toISOString() }, 200);
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
