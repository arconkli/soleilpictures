// New-tag backfill: when a tag is created, find every entity in the
// workspace that should also carry it. Fires automatically from
// useAiTagger's tags-realtime listener; also runnable on demand via
// the cluster-promotion flow.
//
// Embeddings-only pipeline (since 2026-05-27 kill-the-bill rework):
//   1. Pull all card_embeddings for the workspace.
//   2. Compute distance to the new tag's centroid (seeded from name if
//      no member cards yet).
//   3. Distance partition:
//        d < SILENT_APPLY_DIST → auto-apply via tag*() helpers
//        SILENT_APPLY_DIST ≤ d < SUGGEST_DIST → write to tag_suggestions
//        d ≥ SUGGEST_DIST → ignore
//   4. No LLM call. The per-tag inbox in TagDetailView surfaces the
//      middle-band rows for accept/dismiss.

import { supabase } from './supabase.js';
import { parsePgvector } from './tagsClient.js';
import { cosineDist, SILENT_APPLY_DIST, SUGGEST_DIST } from './clusterMath.js';
import { tagCard, tagGroup, tagBoard, tagDocPage } from './tagsApi.js';
import { isDebug } from './aiTaggerLog.js';
import { propagateTagToGroups } from './aiGroupPropagation.js';

// Dispatch a tag application to the right helper for an entity kind.
// All four resolve to entity_links inserts under the hood; this just
// keeps the call site clean as we process a mixed kind list.
async function applyTagToEntity({ entityKind, entityId, boardId, docCardId, workspaceId, tagId }) {
  if (entityKind === 'group') {
    return tagGroup({ workspaceId, boardId, groupId: entityId, tagId, source: 'auto' });
  }
  if (entityKind === 'board') {
    return tagBoard({ workspaceId, boardId: entityId, tagId, source: 'auto' });
  }
  if (entityKind === 'doc-page') {
    return tagDocPage({ workspaceId, docCardId, pageId: entityId, boardId, tagId, source: 'auto' });
  }
  return tagCard({ workspaceId, boardId, cardId: entityId, tagId, source: 'auto' });
}

// Build the cache key the entity_links realtime sub uses to track
// applied tags. Mirrors useAiTagger's `${source_kind}:${source_id}`.
// Doc pages collapse to source_kind='doc' since that's what the
// entity_links row uses.
function appliedCacheKey(entityKind, entityId) {
  if (entityKind === 'doc-page') return `doc:${entityId}`;
  return `${entityKind}:${entityId}`;
}

const LOCK_STALE_MS = 10 * 60 * 1000; // re-claim after 10 minutes

// Try to claim the workspace-wide backfill lock for this tag.
// Returns true if we won; false if another client is already running it.
// Uses an atomic UPDATE … WHERE last_backfill_at IS NULL OR < 10-minutes-ago.
async function claimBackfillLock(tagId) {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const { data, error } = await supabase
    .from('tag_centroids')
    .update({ last_backfill_at: new Date().toISOString() })
    .eq('tag_id', tagId)
    .or(`last_backfill_at.is.null,last_backfill_at.lt.${staleBefore}`)
    .select('tag_id');
  if (error) {
    console.warn('[ai-backfill] lock claim failed', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

export async function backfillTagAgainstWorkspace({ workspaceId, tag, centroid, embeddingCache, appliedRef }) {
  if (!supabase || !workspaceId || !tag?.id || !centroid) return null;

  // Single-flight across all connected clients. The first one to claim
  // the lock runs; everyone else short-circuits.
  const claimed = await claimBackfillLock(tag.id);
  if (!claimed) {
    if (isDebug()) console.log(`[ai-backfill] "${tag.name}" — another client has the lock, skipping`);
    return null;
  }

  // 1. Load all embeddings (every kind: card, group, board, doc-page).
  const { data: rows, error } = await supabase
    .from('card_embeddings')
    .select('card_id, entity_kind, board_id, doc_card_id, embedding')
    .eq('workspace_id', workspaceId);
  if (error) {
    console.warn('[ai-backfill] load embeddings failed', error.message);
    return null;
  }
  if (!rows?.length) return null;

  // 2. Distance-partition. Each row already carries its entity_kind so
  //    the dispatcher downstream knows whether to call tagCard /
  //    tagGroup / tagBoard. Skip rows where this tag is already applied.
  //
  //    Bands:
  //      d < SILENT_APPLY_DIST → silent (auto-apply via tag*() helpers)
  //      SILENT_APPLY_DIST ≤ d < SUGGEST_DIST → suggestion (tag_suggestions)
  //      d ≥ SUGGEST_DIST → dropped
  const silent = [];
  const suggested = [];
  for (const r of rows) {
    const kind = r.entity_kind || 'card';
    const key = appliedCacheKey(kind, r.card_id);
    if (appliedRef?.current?.get(key)?.has(tag.id)) continue;
    const vec = (kind === 'card' && embeddingCache?.get(r.card_id)?.vector)
      || parsePgvector(r.embedding);
    if (!vec) continue;
    const d = cosineDist(vec, centroid);
    const annotated = { ...r, _kind: kind, _distance: d };
    if (d < SILENT_APPLY_DIST) silent.push(annotated);
    else if (d < SUGGEST_DIST) suggested.push(annotated);
  }

  if (isDebug()) {
    console.log(`[ai-backfill] tag "${tag.name}" → ${silent.length} silent, ${suggested.length} suggestions, ${rows.length - silent.length - suggested.length} dropped`);
  }

  // 3. Silent applies — parallel inserts dispatched by kind.
  await Promise.allSettled(silent.map(r => applyTagToEntity({
    entityKind: r._kind,
    entityId:   r.card_id,
    boardId:    r.board_id,
    docCardId:  r.doc_card_id || null,
    workspaceId,
    tagId:      tag.id,
  })));

  // 4. Suggestions — single bulk upsert into tag_suggestions. Skip
  //    duplicates so any existing row (especially dismissed tombstones)
  //    stays intact.
  if (suggested.length > 0) {
    const rowsToInsert = suggested.map(r => ({
      tag_id: tag.id,
      source_kind: r._kind,
      source_id: r.card_id,
      workspace_id: workspaceId,
      board_id: r.board_id || null,
      doc_card_id: r.doc_card_id || null,
      distance: r._distance,
    }));
    const { error: sugErr } = await supabase
      .from('tag_suggestions')
      .upsert(rowsToInsert, { onConflict: 'tag_id,source_kind,source_id', ignoreDuplicates: true });
    if (sugErr) console.warn('[ai-backfill] tag_suggestions upsert failed', sugErr.message);
  }

  // 5. Propagate to groups. Any group with ≥3 tagged members gets
  //    the tag itself so the detail view nests them correctly.
  const grp = await propagateTagToGroups({ workspaceId, tagId: tag.id });
  if (isDebug() && grp?.applied) {
    console.log(`[ai-backfill] propagated tag "${tag.name}" to ${grp.applied} group(s)`);
  }

  return {
    silent: silent.length,
    suggested: suggested.length,
    groups_applied: grp?.applied || 0,
  };
}
