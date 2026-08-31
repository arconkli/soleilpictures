// admin-discount-action — POST (admin-authed) management of Stripe discount
// codes, so an operator never has to open the Stripe Dashboard.
//
// Body: { action, … }
//   • list        → every promotion code, with its coupon inlined
//   • create      → { code, percent_off, max_redemptions?, expires_at?, note? }
//                   Creates a `duration: 'once'` coupon, then the promotion code.
//   • set_active  → { promotion_code_id, active } — deactivate / reactivate.
//                   Stripe cannot DELETE a promotion code, only deactivate it,
//                   which is why the UI offers an undo rather than a tombstone.
//
// Auth: caller's Bearer JWT must resolve to a profile with tier='admin' — same
// pattern as admin-account-action.
//
// STRIPE IS THE SOURCE OF TRUTH for the codes. There is no mirror table, so
// times_redeemed / active / expires_at cannot drift from Stripe. The operator's
// note rides in the coupon's metadata. Only redemption ATTRIBUTION is ours
// (discount_redemptions, migration 0274), because Stripe forgets it: a `once`
// discount is detached from the subscription after the first invoice.
//
// Codes are MONTHLY-ONLY. That is enforced in create-checkout-session, which
// withholds Checkout's promo field on annual — not here. See
// promoCodesAllowedForPlan in _shared/activateCore.mjs for why it cannot be a
// coupon restriction: monthly and annual are two Prices on ONE Product, so
// applies_to.products cannot tell them apart.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY")!;

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age":       "86400",
};

interface Body {
  action?: "list" | "create" | "set_active";
  code?: string;
  percent_off?: number;
  max_redemptions?: number | null;
  expires_at?: string | null;   // ISO date
  note?: string;
  promotion_code_id?: string;
  active?: boolean;
}

function shape(pc: Stripe.PromotionCode) {
  const c = pc.coupon as Stripe.Coupon;
  return {
    id: pc.id,
    code: pc.code,
    active: pc.active,
    percent_off: c?.percent_off ?? null,
    duration: c?.duration ?? null,
    times_redeemed: pc.times_redeemed ?? 0,
    max_redemptions: pc.max_redemptions ?? null,
    expires_at: pc.expires_at ? new Date(pc.expires_at * 1000).toISOString() : null,
    created: pc.created ? new Date(pc.created * 1000).toISOString() : null,
    created_by: (c?.metadata?.created_by as string | undefined) ?? null,
    note: (c?.metadata?.note as string | undefined) ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return json({ error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const u = await userClient.auth.getUser();
    if (u.error || !u.data.user) return json({ error: "invalid token" }, 401);
    const callerId = u.data.user.id;
    const callerEmail = u.data.user.email ?? null;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const me = await admin.from("profiles").select("tier").eq("user_id", callerId).maybeSingle();
    if (me.error || me.data?.tier !== "admin") return json({ error: "admin only" }, 403);

    let body: Body;
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

    switch (body.action) {
      case "list": {
        const list = await stripe.promotionCodes.list({ limit: 100, expand: ["data.coupon"] });
        return json({ ok: true, codes: list.data.map(shape) }, 200);
      }

      case "create": {
        const code = (body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (code.length < 3 || code.length > 40) {
          return json({ error: "code must be 3–40 letters or digits" }, 400);
        }
        const pct = Number(body.percent_off);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
          return json({ error: "percent_off must be between 1 and 100" }, 400);
        }
        let maxRedemptions: number | undefined;
        if (body.max_redemptions !== null && body.max_redemptions !== undefined) {
          const m = Number(body.max_redemptions);
          if (!Number.isInteger(m) || m < 1) return json({ error: "max_redemptions must be a whole number ≥ 1" }, 400);
          maxRedemptions = m;
        }
        let expiresAt: number | undefined;
        if (body.expires_at) {
          const t = Date.parse(body.expires_at);
          if (Number.isNaN(t)) return json({ error: "expires_at is not a date" }, 400);
          if (t <= Date.now()) return json({ error: "expires_at must be in the future" }, 400);
          expiresAt = Math.floor(t / 1000);
        }
        const note = (body.note || "").trim().slice(0, 400);

        // duration:'once' rather than repeating/duration_in_months:1 — on a
        // monthly plan they are equivalent, and 'once' states the intent.
        const coupon = await stripe.coupons.create({
          percent_off: pct,
          duration: "once",
          name: `${pct}% off first month`,
          metadata: {
            created_by: callerEmail ?? callerId,
            ...(note ? { note } : {}),
          },
        });

        try {
          const pc = await stripe.promotionCodes.create({
            coupon: coupon.id,
            code,
            ...(maxRedemptions !== undefined ? { max_redemptions: maxRedemptions } : {}),
            ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
          });
          // Re-read so the response carries the same expanded shape as `list`.
          const full = await stripe.promotionCodes.retrieve(pc.id, { expand: ["coupon"] });
          return json({ ok: true, code: shape(full) }, 200);
        } catch (e) {
          // The coupon exists but the code does not — a duplicate code string is
          // the common cause. Delete the orphan so a retry with a different code
          // does not litter the account, then surface the REAL error.
          await stripe.coupons.del(coupon.id).catch(() => {});
          const msg = String((e as Error)?.message ?? e);
          const dupe = /already exists|code.*taken/i.test(msg);
          return json({ error: dupe ? `The code "${code}" is already in use.` : msg }, dupe ? 409 : 400);
        }
      }

      case "set_active": {
        if (!body.promotion_code_id) return json({ error: "missing promotion_code_id" }, 400);
        if (typeof body.active !== "boolean") return json({ error: "active must be true or false" }, 400);
        await stripe.promotionCodes.update(body.promotion_code_id, { active: body.active });
        const full = await stripe.promotionCodes.retrieve(body.promotion_code_id, { expand: ["coupon"] });
        return json({ ok: true, code: shape(full) }, 200);
      }

      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error("[admin-discount-action] error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
