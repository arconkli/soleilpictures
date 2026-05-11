// New-tag backfill: when a tag is created, find every card in the
// workspace that should also carry it and apply it. Fires automatically
// from useAiTagger's tags-realtime listener; also runnable on demand
// via the cluster-promotion flow.
//
// Cheaper than waiting for every card to be re-edited:
//   1. Pull all card_embeddings for the workspace.
//   2. Compute distance to the new tag's centroid (seeded from name if
//      no member cards yet).
//   3. Distance prefilter — drop anything outside the middle band.
//      Silent-apply the close ones, dismiss the far ones, send the
//      middle to /api/tags/apply for tier verdict.
//   4. Apply 'high' verdicts via tagCard().

import { supabase } from './supabase.js';
import { applyCards, parsePgvector } from './tagsClient.js';
import { cosineDist, SILENT_APPLY_DIST, NO_MATCH_DIST } from './clusterMath.js';
import { tagCard } from './tagsApi.js';
import { isDebug } from './aiTaggerLog.js';
import { propagateTagToGroups } from './aiGroupPropagation.js';

const BATCH_SIZE = 8; // cards per /api/tags/apply call
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

  // 1. Load all card embeddings.
  const { data: rows, error } = await supabase
    .from('card_embeddings')
    .select('card_id, board_id, embedding')
    .eq('workspace_id', workspaceId);
  if (error) {
    console.warn('[ai-backfill] load embeddings failed', error.message);
    return null;
  }
  if (!rows?.length) return null;

  // 2. Distance-partition.
  const silent = [];      // cards within SILENT_APPLY_DIST — apply without AI
  const middle = [];      // cards in 0.20–0.55 — send to AI for verdict
  for (const r of rows) {
    // Skip cards that already have this tag applied.
    const key = `card:${r.card_id}`;
    if (appliedRef?.current?.get(key)?.has(tag.id)) continue;
    const vec = embeddingCache?.get(r.card_id)?.vector || parsePgvector(r.embedding);
    if (!vec) continue;
    const d = cosineDist(vec, centroid);
    if (d < SILENT_APPLY_DIST) {
      silent.push(r);
    } else if (d < NO_MATCH_DIST) {
      middle.push(r);
    }
    // else: too far, ignore
  }

  if (isDebug()) {
    console.log(`[ai-backfill] tag "${tag.name}" → ${silent.length} silent, ${middle.length} ai-candidates, ${rows.length - silent.length - middle.length} dropped`);
  }

  // 3. Silent applies — bulk-insert without paying for AI. Parallel
  //    (independent DB inserts; tagCard swallows 23505 conflicts).
  await Promise.allSettled(silent.map(r => tagCard({
    workspaceId,
    boardId: r.board_id,
    cardId: r.card_id,
    tagId: tag.id,
    source: 'auto',
  })));

  // 4. Middle band — batch-call /apply for tier verdict, then apply 'high'.
  if (middle.length === 0) {
    // Even if AI is skipped, propagate silent applies to groups.
    const grp = await propagateTagToGroups({ workspaceId, tagId: tag.id });
    if (isDebug() && grp?.applied) console.log(`[ai-backfill] propagated tag to ${grp.applied} group(s)`);
    return { silent: silent.length, applied_high: 0, ai_calls: 0, groups_applied: grp?.applied || 0 };
  }

  // We need card text for the AI call. Pull from card_index.
  const cardIds = middle.map(r => r.card_id);
  const { data: idx } = await supabase
    .from('card_index')
    .select('card_id, board_id, title, body')
    .eq('workspace_id', workspaceId)
    .in('card_id', cardIds);
  const textById = new Map();
  const boardById = new Map();
  for (const r of (idx || [])) {
    const text = [r.title || '', r.body || '']
      .filter(Boolean)
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    textById.set(r.card_id, text);
    boardById.set(r.card_id, r.board_id);
  }

  // Chunk the middle band into independent batches and fire them in
  // parallel. The worker enforces its own concurrency cap upstream;
  // here we just stop waiting on each batch serially (which was the
  // visible "took a while" lag on new-tag backfill).
  const batches = [];
  for (let i = 0; i < middle.length; i += BATCH_SIZE) {
    const slice = middle.slice(i, i + BATCH_SIZE);
    const cards = slice
      .map(r => ({
        id: r.card_id,
        text: textById.get(r.card_id) || '',
        candidate_tags: [{ id: tag.id, name: tag.name }],
      }))
      .filter(c => c.text);
    if (cards.length > 0) batches.push(cards);
  }
  const responses = await Promise.allSettled(batches.map(b => applyCards(b)));
  const aiCalls = batches.length;

  // Collect high-confidence card ids, then apply them in parallel.
  const highCardIds = [];
  for (const r of responses) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const verdicts = r.value.verdicts || [];
    for (const v of verdicts) {
      const high = (v.tags || []).find(t => t.tag_id === tag.id && t.confidence === 'high');
      if (high) highCardIds.push(v.card_id);
    }
  }
  const applyResults = await Promise.allSettled(highCardIds.map(cardId => {
    const boardId = boardById.get(cardId);
    if (!boardId) return Promise.resolve(false);
    return tagCard({ workspaceId, boardId, cardId, tagId: tag.id, source: 'auto' }).then(() => true);
  }));
  const appliedHigh = applyResults.filter(r => r.status === 'fulfilled' && r.value === true).length;

  // 5. Propagate to groups. Now that all card-level applies have
  //    landed for this tag, any group with ≥3 tagged members gets
  //    the tag itself so the detail view nests them correctly.
  const grp = await propagateTagToGroups({ workspaceId, tagId: tag.id });
  if (isDebug() && grp?.applied) {
    console.log(`[ai-backfill] propagated tag "${tag.name}" to ${grp.applied} group(s)`);
  }

  return {
    silent: silent.length,
    applied_high: appliedHigh,
    ai_calls: aiCalls,
    groups_applied: grp?.applied || 0,
  };
}
