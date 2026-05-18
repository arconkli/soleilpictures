// DEPRECATED. Phase 3 backfill is implemented in
// supabase/migrations/0062_history_rework_image_refs_backfill.sql which runs
// in pure SQL by regex-scanning the base64-decoded Y.Doc bytes for r2:<key>
// references. That approach is faster (seconds vs minutes), simpler, and
// avoids edge-function memory limits.
//
// Earlier versions of this file (1-5 in git history) implemented the same
// logic in TypeScript / Yjs. We hit WORKER_RESOURCE_LIMIT on the full
// production dataset (1300+ snapshots) because Yjs decode + toJSON of large
// docs blows past the edge runtime's memory cap.
//
// Function kept deployed (verify_jwt=true) for potential ad-hoc re-runs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  JSON.stringify({
    ok: false,
    error: "deprecated",
    note: "Phase 3 backfill is implemented in migration 0062. Re-run that migration if needed.",
  }, null, 2),
  { status: 410, headers: { "content-type": "application/json" } },
));
