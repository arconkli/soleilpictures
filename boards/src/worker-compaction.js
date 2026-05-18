// boards/src/worker-compaction.js
//
// Job 1 of the backups-rework compaction pipeline. Reads board_ops rows
// that are older than the hot-buffer cutoff and lives across hour buckets,
// merges each (board_id, hour) bucket into a single Y.Update via
// Y.mergeUpdates, PUTs to R2, then atomically inserts a board_op_batches
// row + deletes the source ops via commit_op_batch.
//
// Defaults to dry-run mode. Set HISTORY_COMPACTION_MODE=run on the worker
// env to actually write to R2 + delete source rows.
//
// Invoked from the Cloudflare Worker's scheduled handler.

import * as Y from 'yjs';

const HOT_BUFFER_HOURS = 2;             // matches history_rework_config default
const MAX_BUCKETS_PER_RUN = 50;         // per worker invocation
const MAX_OPS_PER_BUCKET = 500;         // matches RPC default

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
  return 'sha256:' + hex;
}

async function rpc(env, fn, params) {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(params || {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`rpc ${fn} ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// Pull candidate buckets from the existing compaction_job1_candidates view.
async function fetchCandidates(env) {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/compaction_job1_candidates`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`candidates rpc ${res.status}: ${text.slice(0, 200)}`);
  }
  const all = await res.json();
  return Array.isArray(all) ? all.slice(0, MAX_BUCKETS_PER_RUN) : [];
}

async function compactOneBucket(env, bucket, dryRun) {
  // bucket: { board_id, hour_bucket, from_seq, to_seq, op_count, byte_size, tx_ids }
  const ops = await rpc(env, 'fetch_ops_for_compaction', {
    p_board_id: bucket.board_id,
    p_hour_start: bucket.hour_bucket,
    p_hour_end: new Date(new Date(bucket.hour_bucket).getTime() + 3600_000).toISOString(),
    p_max_ops: MAX_OPS_PER_BUCKET,
  });
  if (!Array.isArray(ops) || ops.length === 0) {
    return { committed: false, reason: 'no ops in bucket (race?)' };
  }

  // Merge all Y.Updates into one. mergeUpdates is lossless under Yjs CRDT.
  const updateBytes = ops.map((o) => b64ToBytes(o.update_b64));
  const merged = Y.mergeUpdates(updateBytes);
  const mergedB64 = bytesToB64(merged);
  const mergedHash = await sha256Hex(merged);

  const fromSeq = ops[0].seq;
  const toSeq = ops[ops.length - 1].seq;
  const fromTs = ops[0].ts;
  const toTs = ops[ops.length - 1].ts;
  const txIds = Array.from(new Set(ops.map((o) => o.tx_id).filter(Boolean)));
  const r2Keys = Array.from(new Set(ops.flatMap((o) => o.r2_keys || []).filter(Boolean)));
  const r2Key = `boards/${bucket.board_id}/ops/hourly/${fromSeq}-${toSeq}.bin`;

  if (dryRun) {
    return {
      committed: false,
      dry_run: true,
      r2_key: r2Key,
      from_seq: fromSeq, to_seq: toSeq,
      from_ts: fromTs, to_ts: toTs,
      op_count: ops.length,
      merged_bytes: merged.length,
      merged_hash: mergedHash,
    };
  }

  // R2 PUT. We store the merged update as raw bytes (not base64) since
  // R2 is binary-safe — saves ~33% storage vs the base64 in Postgres.
  await env.IMAGES.put(r2Key, merged, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: {
      'history-batch': 'hourly',
      'board-id': bucket.board_id,
      'from-seq': String(fromSeq),
      'to-seq': String(toSeq),
      'op-count': String(ops.length),
      'merged-hash': mergedHash,
    },
  });

  // Atomic batch index insert + source ops delete.
  const batchId = await rpc(env, 'commit_op_batch', {
    p_board_id: bucket.board_id,
    p_r2_key: r2Key,
    p_tier: 'hourly',
    p_from_seq: fromSeq,
    p_to_seq: toSeq,
    p_from_ts: fromTs,
    p_to_ts: toTs,
    p_op_count: ops.length,
    p_tx_ids: txIds,
    p_r2_keys_referenced: r2Keys,
    p_merged_update_hash: mergedHash,
  });

  return {
    committed: true,
    batch_id: batchId,
    r2_key: r2Key,
    op_count: ops.length,
    merged_bytes: merged.length,
  };
}

// Top-level entry: invoked by the worker's scheduled handler.
export async function runCompactionJob1(env) {
  if (!env?.IMAGES) {
    console.log('[compaction] skipped: IMAGES R2 binding not configured');
    return;
  }
  if (!env?.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[compaction] skipped: SUPABASE_SERVICE_ROLE_KEY not set');
    return;
  }
  const mode = (env.HISTORY_COMPACTION_MODE || 'dryrun').toLowerCase();
  const dryRun = mode !== 'run';
  const startedAt = Date.now();

  let buckets = [];
  try { buckets = await fetchCandidates(env); }
  catch (e) {
    console.error('[compaction] candidate fetch failed', e);
    return;
  }
  if (buckets.length === 0) {
    console.log(`[compaction] mode=${mode} no candidates (${Date.now() - startedAt}ms)`);
    return;
  }

  let committed = 0;
  let dryReported = 0;
  let failed = 0;
  const errors = [];

  for (const bucket of buckets) {
    try {
      const result = await compactOneBucket(env, bucket, dryRun);
      if (result.committed) committed++;
      else if (result.dry_run) dryReported++;
    } catch (e) {
      failed++;
      errors.push({ board_id: bucket.board_id, hour: bucket.hour_bucket, error: String(e?.message || e) });
    }
  }

  console.log(
    `[compaction] mode=${mode} buckets=${buckets.length} committed=${committed} dry-reported=${dryReported} failed=${failed} took=${Date.now() - startedAt}ms`,
    errors.length > 0 ? { firstError: errors[0] } : '',
  );
}
