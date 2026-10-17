// storage-liveness — invoked by pg_cron every minute (0411).
//
// Keeps images.live_board_ids current: for every cluster whose saved state
// changed since it was last read, decode the state with deleted content
// dropped (_shared/liveKeys.mjs) and hand the keys it still uses to
// storage_liveness_record. The storage count reads live_board_ids, so a file
// stops counting a minute or two after its card is deleted. The orphan sweep
// keeps reading the raw ref_count, which this never touches.
//
// Authorization: accept EITHER
//   • Bearer <SUPABASE_SERVICE_ROLE_KEY>  (manual runs)
//   • x-cron-secret: <CRON_SECRET>        (pg_cron, via _cron_edge_post)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import * as Y from "npm:yjs@13.6.30";
import { liveKeysFromDoc } from "../_shared/liveKeys.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET  = Deno.env.get("CRON_SECRET") || "";

// One run reads at most this many clusters, and at most about this many
// characters of saved state, so a run stays well inside the edge runtime's
// CPU and memory limits. Anything left over is picked up by the next minute.
const MAX_BOARDS = 40;
const MAX_CHARS  = 3_000_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const cronHeader = req.headers.get("x-cron-secret") || "";
  const auth       = req.headers.get("authorization") || "";
  const bearer     = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const okCron     = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const okService  = !!SERVICE_KEY && bearer === SERVICE_KEY;
  if (!okCron && !okService) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: due, error } = await admin.rpc("storage_liveness_due", { p_limit: MAX_BOARDS, p_max_chars: MAX_CHARS });
  if (error) {
    console.error("storage-liveness: storage_liveness_due failed", error.message);
    return json({ ok: false, error: "due_failed" }, 500);
  }

  let recorded = 0, undecodable = 0, failed = 0;
  for (const row of (due || []) as Array<{ board_id: string; doc: string; updated_at: string }>) {
    // A state that cannot be decoded falls back to the raw scan in SQL
    // (p_keys = null), so a bad row never makes a cluster's files look unused.
    let keys: string[] | null = null;
    try {
      keys = liveKeysFromDoc(Y, row.doc);
    } catch (e) {
      undecodable++;
      console.warn("storage-liveness: could not decode", row.board_id, String(e));
    }
    const { error: recErr } = await admin.rpc("storage_liveness_record", {
      p_board_id: row.board_id,
      p_doc_updated_at: row.updated_at,
      p_keys: keys,
    });
    if (recErr) {
      failed++;
      console.error("storage-liveness: record failed", row.board_id, recErr.message);
    } else {
      recorded++;
    }
  }

  return json({ ok: failed === 0, due: (due || []).length, recorded, undecodable, failed });
});
