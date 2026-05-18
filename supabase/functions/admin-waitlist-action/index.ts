// admin-waitlist-action — POST (admin-authed) action on a waitlist entry.
//
// Body: { entry_id: uuid, action: 'accept' | 'reject' | 'reschedule', days?: number }
//
// Caller's profile.tier must be 'admin'. Actions:
//   • accept       → run the same flip that the cron does (tier→demo, mark accepted, send signin email)
//   • reject       → mark entry rejected; the user's account (if any)
//                    stays on tier='waitlist' so they can't sign in
//   • reschedule   → bump scheduled_accept_at by `days` (default 7)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL      = Deno.env.get("APP_URL") || "";

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

interface Body {
  entry_id?: string;
  action?: "accept" | "reject" | "reschedule";
  days?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return json({ error: "auth required" }, 401);

  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const u = await userClient.auth.getUser();
  if (u.error || !u.data.user) return json({ error: "invalid token" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const me = await admin.from("profiles").select("tier").eq("user_id", u.data.user.id).maybeSingle();
  if (me.error || me.data?.tier !== "admin") return json({ error: "admin only" }, 403);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (!body.entry_id || !body.action) return json({ error: "missing entry_id or action" }, 400);

  const entry = await admin.from("waitlist_entries").select("id, email, status, scheduled_accept_at").eq("id", body.entry_id).maybeSingle();
  if (entry.error || !entry.data) return json({ error: "entry not found" }, 404);

  if (body.action === "accept") {
    if (entry.data.status !== "pending") return json({ error: `cannot accept entry in status ${entry.data.status}` }, 409);
    try {
      const lookup = await admin.rpc("user_id_by_email", { p_email: entry.data.email });
      if (lookup.error) throw lookup.error;
      const userId = lookup.data as string | null;
      if (!userId) throw new Error("no auth.users row for " + entry.data.email);
      await admin.from("profiles").update({ tier: "demo" }).eq("user_id", userId).eq("tier", "waitlist");
      await admin.from("waitlist_entries").update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        reviewed_by: u.data.user.id,
      }).eq("id", body.entry_id);
      const signin = await admin.auth.signInWithOtp({
        email: entry.data.email,
        options: { shouldCreateUser: false, emailRedirectTo: APP_URL || undefined },
      });
      if (signin.error) throw signin.error;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: msg }, 500);
    }
    return json({ ok: true, action: "accepted" }, 200);
  }

  if (body.action === "reject") {
    if (entry.data.status === "accepted") return json({ error: "cannot reject accepted entry" }, 409);
    const upd = await admin.from("waitlist_entries").update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      reviewed_by: u.data.user.id,
    }).eq("id", body.entry_id);
    if (upd.error) return json({ error: upd.error.message }, 500);
    return json({ ok: true, action: "rejected" }, 200);
  }

  if (body.action === "reschedule") {
    if (entry.data.status !== "pending") return json({ error: `cannot reschedule entry in status ${entry.data.status}` }, 409);
    const days = Math.max(1, Math.min(30, Number(body.days) || 7));
    const newAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const upd = await admin.from("waitlist_entries").update({
      scheduled_accept_at: newAt,
      reviewed_by: u.data.user.id,
    }).eq("id", body.entry_id);
    if (upd.error) return json({ error: upd.error.message }, 500);
    return json({ ok: true, action: "rescheduled", scheduled_accept_at: newAt }, 200);
  }

  return json({ error: "unknown action" }, 400);
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
