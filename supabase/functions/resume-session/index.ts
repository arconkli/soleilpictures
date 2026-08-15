// resume-session — spend a lifecycle email's resume token and hand back the
// material for a real session, so a dormant user who clicks a win-back CTA
// lands on their board instead of on the OTP wall.
//
// Why this exists: win-back recipients average 27 days since their last
// sign-in — 100% are more than a week stale — so essentially all of them click
// while signed out. Over the program's first seven weeks that produced a ~40%
// open rate, a ~2.9% click rate, and a single-digit number of readers who ever
// reached the app. See migration 0235.
//
// POST { token } → { ok, tokenHash, emailType }
//   tokenHash is a Supabase magic-link `hashed_token`; the CLIENT finishes the
//   exchange with supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }).
//   We deliberately do not mint and return a session here: verifyOtp on the
//   client is what writes the session through the SDK's own storage, which is
//   where the rest of the app expects to find it.
//
// POST ONLY, and that is load-bearing rather than stylistic. Resend rewrites
// every CTA through its own click-tracking host, and inbox scanners prefetch
// links; anything spendable by a GET is spent by a robot before the human ever
// sees it. A GET here is a 405 and costs the token nothing.
//
// No Authorization header — the token in the body IS the credential (256-bit,
// single-use, 7-day). verify_jwt is off for this function in config.toml for
// that reason: the caller is by definition someone with no session.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// The app origin the magic link should bounce through if Supabase ever needs a
// redirect target. Kept in lockstep with templates.ts SITE_ORIGIN.
const SITE_ORIGIN = "https://clusters.soleilpictures.com";

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  // Shape check before touching the database: the mint is always 64 hex chars,
  // so anything else is noise and does not deserve a round trip.
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: "invalid_or_expired" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Single-use is enforced inside the RPC, in one UPDATE — two clicks racing
  // out of the same inbox cannot both win. Unknown, expired and already-spent
  // tokens are indistinguishable from here, on purpose.
  const { data, error } = await admin.rpc("lifecycle_redeem_resume_token", { p_token: token });
  if (error) {
    console.warn("redeem failed", error.message);
    return json({ error: "server_error" }, 500);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.email) return json({ error: "invalid_or_expired" }, 401);

  // generateLink does NOT send mail — it returns the link material for us to
  // hand to the client. The user always exists here (the token was minted
  // against their row and auth.users cascades on delete).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type:  "magiclink",
    email: row.email,
    options: { redirectTo: SITE_ORIGIN },
  });
  if (linkErr || !link?.properties?.hashed_token) {
    console.warn("generateLink failed", linkErr?.message);
    // The resume token is already spent at this point. Say so plainly rather
    // than implying a retry will work — the CTA falls back to normal sign-in.
    return json({ error: "server_error" }, 500);
  }

  return json({
    ok: true,
    tokenHash: link.properties.hashed_token,
    emailType: row.email_type ?? null,
  }, 200);
});
