// seo-health — external prober for the SEO health / deploy-drift detector
// (migration 0180). Runs on pg_cron ('seo-health-every-6h'), fetches each
// enabled seo_health_expectations URL from OUTSIDE the Cloudflare worker (a
// worker often can't fetch its own custom domain), evaluates the expectation,
// and records the run via record_seo_health — which mirrors any failure into
// client_errors (kind 'seo_health') so the admin Errors tab is the alert
// channel. The admin Discover tab renders the latest run as a red/green strip.
//
// Check kinds:
//   title     — the HTML <title> contains `expected`
//   canonical — <link rel="canonical" href="..."> equals `expected`
//   body      — raw response body contains `expected`
//   status    — HTTP status equals `expected` (e.g. the 404 regression guard)
//   build_min — JSON body's .date >= expected (YYYY-MM-DD) → deploy not stuck
//
// Expectations live in the DB (editable without a deploy) precisely so a stuck
// deploy can't self-certify: bump the build_min row when shipping SEO changes.
//
// Auth (mirrors lifecycle-email-cron): x-cron-secret OR Bearer service-role.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET  = Deno.env.get("CRON_SECRET") || "";

const UA = "SoleilSeoHealth/1.0 (+https://clusters.soleilpictures.com)";
const FETCH_TIMEOUT_MS = 15000;

const cors = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

type Expectation = {
  id: number; url: string; check_name: string;
  kind: "title" | "canonical" | "body" | "status" | "build_min";
  expected: string; enabled: boolean;
};
type Result = {
  url: string; check_name: string; ok: boolean;
  expected: string; actual: string; ms: number;
};

function evaluate(kind: Expectation["kind"], expected: string, status: number, body: string): { ok: boolean; actual: string } {
  switch (kind) {
    case "title": {
      const m = body.match(/<title>([^<]*)<\/title>/i);
      const title = m ? m[1] : "";
      return { ok: title.includes(expected), actual: title || `(no <title>; status ${status})` };
    }
    case "canonical": {
      const m = body.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i)
        || body.match(/<link[^>]+href="([^"]*)"[^>]+rel="canonical"/i);
      const href = m ? m[1] : "";
      return { ok: href === expected, actual: href || "(no canonical)" };
    }
    case "body":
      return { ok: body.includes(expected), actual: body.includes(expected) ? "present" : "absent" };
    case "status":
      return { ok: String(status) === expected, actual: String(status) };
    case "build_min": {
      try {
        const info = JSON.parse(body);
        const date = String(info?.date || "");
        return { ok: !!date && date >= expected, actual: `${date} @ ${info?.sha ?? "?"}` };
      } catch {
        return { ok: false, actual: `(non-JSON; status ${status})` };
      }
    }
    default:
      return { ok: false, actual: `(unknown kind ${kind})` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  const cronHeader = req.headers.get("x-cron-secret") || "";
  const auth       = req.headers.get("authorization") || "";
  const bearer     = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const okCron     = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const okService  = !!SERVICE_KEY && bearer === SERVICE_KEY;
  if (!okCron && !okService) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: expectations, error } = await admin
    .from("seo_health_expectations")
    .select("id, url, check_name, kind, expected, enabled")
    .eq("enabled", true)
    .order("id");
  if (error) return json({ error: `expectations: ${error.message}` }, 500);
  const list = (expectations || []) as Expectation[];
  if (!list.length) return json({ ok: true, note: "no enabled expectations" }, 200);

  // Fetch each distinct URL once (several expectations can share a URL).
  const byUrl = new Map<string, Expectation[]>();
  for (const e of list) {
    const arr = byUrl.get(e.url) || [];
    arr.push(e);
    byUrl.set(e.url, arr);
  }

  const results: Result[] = [];
  for (const [url, checks] of byUrl) {
    const t0 = Date.now();
    let status = 0;
    let body = "";
    let fetchErr = "";
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, "accept": "text/html,application/json;q=0.9,*/*;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      status = res.status;
      body = (await res.text()).slice(0, 500_000);
    } catch (e) {
      fetchErr = String((e as Error)?.message || e);
    }
    const ms = Date.now() - t0;
    for (const c of checks) {
      if (fetchErr) {
        results.push({ url, check_name: c.check_name, ok: false, expected: c.expected, actual: `fetch failed: ${fetchErr}`, ms });
      } else {
        const { ok, actual } = evaluate(c.kind, c.expected, status, body);
        results.push({ url, check_name: c.check_name, ok, expected: c.expected, actual, ms });
      }
    }
  }

  const { data: runId, error: recErr } = await admin.rpc("record_seo_health", {
    p_source: "edge:seo-health",
    p_results: results,
  });
  if (recErr) return json({ error: `record: ${recErr.message}`, results }, 500);

  const failed = results.filter((r) => !r.ok).length;
  return json({ ok: failed === 0, run_id: runId, checks: results.length, failed }, 200);
});
