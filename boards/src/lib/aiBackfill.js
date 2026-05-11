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
  const silent = [];      // within SILENT_APPLY_DIST — apply without AI
  const middle = [];      // in 0.20–0.55 — send to AI for verdict
  for (const r of rows) {
    const kind = r.entity_kind || 'card';
    const key = appliedCacheKey(kind, r.card_id);
    if (appliedRef?.current?.get(key)?.has(tag.id)) continue;
    const vec = (kind === 'card' && embeddingCache?.get(r.card_id)?.vector)
      || parsePgvector(r.embedding);
    if (!vec) continue;
    const d = cosineDist(vec, centroid);
    const annotated = { ...r, _kind: kind };
    if (d < SILENT_APPLY_DIST) silent.push(annotated);
    else if (d < NO_MATCH_DIST) middle.push(annotated);
  }

  if (isDebug()) {
    console.log(`[ai-backfill] tag "${tag.name}" → ${silent.length} silent, ${middle.length} ai-candidates, ${rows.length - silent.length - middle.length} dropped`);
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

  // 4. Middle band — batch-call /apply for tier verdict, then apply 'high'.
  if (middle.length === 0) {
    const grp = await propagateTagToGroups({ workspaceId, tagId: tag.id });
    if (isDebug() && grp?.applied) console.log(`[ai-backfill] propagated tag to ${grp.applied} group(s)`);
    return { silent: silent.length, applied_high: 0, ai_calls: 0, groups_applied: grp?.applied || 0 };
  }

  // Pull text for each entity in the middle band. Cards get title +
  // body from card_index; groups + boards get just their title from
  // entity_search; doc pages get title + page text from doc_page_index.
  const cardIds  = middle.filter(r => r._kind === 'card').map(r => r.card_id);
  const groupSearchIds = middle.filter(r => r._kind === 'group')
    .map(r => `${r.board_id}:g:${r.card_id}`);
  const boardSearchIds = middle.filter(r => r._kind === 'board').map(r => r.card_id);
  const docPageIds = middle.filter(r => r._kind === 'doc-page').map(r => r.card_id);
  const [cardIdxResp, groupResp, boardResp, docPageResp] = await Promise.all([
    cardIds.length > 0
      ? supabase.from('card_index').select('card_id, board_id, title, body').eq('workspace_id', workspaceId).in('card_id', cardIds)
      : Promise.resolve({ data: [] }),
    groupSearchIds.length > 0
      ? supabase.from('entity_search').select('id, kind, board_id, title').eq('workspace_id', workspaceId).eq('kind', 'group').in('id', groupSearchIds)
      : Promise.resolve({ data: [] }),
    boardSearchIds.length > 0
      ? supabase.from('entity_search').select('id, kind, board_id, title').eq('workspace_id', workspaceId).eq('kind', 'board').in('id', boardSearchIds)
      : Promise.resolve({ data: [] }),
    docPageIds.length > 0
      ? supabase.from('doc_page_index').select('doc_card_id, page_id, page_title, page_text').eq('workspace_id', workspaceId).in('page_id', docPageIds)
      : Promise.resolve({ data: [] }),
  ]);
  const textByKey = new Map();
  const boardByKey = new Map();
  const docCardByKey = new Map();
  for (const r of (cardIdxResp.data || [])) {
    const text = [r.title || '', r.body || '']
      .filter(Boolean)
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    textByKey.set(appliedCacheKey('card', r.card_id), text);
    boardByKey.set(appliedCacheKey('card', r.card_id), r.board_id);
  }
  for (const r of (groupResp.data || [])) {
    const m = (r.id || '').split(':g:');
    const groupId = m[1] || r.id;
    textByKey.set(appliedCacheKey('group', groupId), (r.title || '').trim());
    boardByKey.set(appliedCacheKey('group', groupId), r.board_id || null);
  }
  for (const r of (boardResp.data || [])) {
    const boardId = r.board_id || r.id;
    textByKey.set(appliedCacheKey('board', boardId), (r.title || '').trim());
    boardByKey.set(appliedCacheKey('board', boardId), boardId);
  }
  for (const r of (docPageResp.data || [])) {
    const k = appliedCacheKey('doc-page', r.page_id);
    textByKey.set(k, [r.page_title || '', r.page_text || ''].filter(s => s && s.trim()).join('\n'));
    docCardByKey.set(k, r.doc_card_id);
    // board_id resolution defers to the embedding row's stored value
    // (already on `middle` items) so we don't need a card_index join.
  }

  // Chunk + fire batches in parallel. Composite id encodes the kind
  // so verdicts come back uniquely identifiable.
  const batches = [];
  for (let i = 0; i < middle.length; i += BATCH_SIZE) {
    const slice = middle.slice(i, i + BATCH_SIZE);
    const cards = slice
      .map(r => {
        const k = appliedCacheKey(r._kind, r.card_id);
        return {
          id: `${r._kind}|${r.card_id}`,
          text: textByKey.get(k) || '',
          candidate_tags: [{ id: tag.id, name: tag.name }],
        };
      })
      .filter(c => c.text);
    if (cards.length > 0) batches.push(cards);
  }
  const responses = await Promise.allSettled(batches.map(b => applyCards(b)));
  const aiCalls = batches.length;

  // Collect high-confidence ids and dispatch the applies in parallel.
  // Also pull the doc_card_id from the middle band so doc-page applies
  // can write the right entity_links row.
  const boardByMiddleId = new Map();
  const docCardByMiddleId = new Map();
  for (const r of middle) {
    boardByMiddleId.set(`${r._kind}|${r.card_id}`, r.board_id);
    if (r.doc_card_id) docCardByMiddleId.set(`${r._kind}|${r.card_id}`, r.doc_card_id);
  }
  const highTargets = []; // [{ kind, id, boardId, docCardId }]
  for (const r of responses) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const verdicts = r.value.verdicts || [];
    for (const v of verdicts) {
      const high = (v.tags || []).find(t => t.tag_id === tag.id && t.confidence === 'high');
      if (!high) continue;
      const [kind, ...rest] = (v.card_id || '').split('|');
      const entityId = rest.join('|');
      const boardId = boardByKey.get(appliedCacheKey(kind, entityId))
        || boardByMiddleId.get(v.card_id) || null;
      const docCardId = docCardByKey.get(appliedCacheKey(kind, entityId))
        || docCardByMiddleId.get(v.card_id) || null;
      highTargets.push({ kind, id: entityId, boardId, docCardId });
    }
  }
  const applyResults = await Promise.allSettled(highTargets.map(t => applyTagToEntity({
    entityKind: t.kind,
    entityId:   t.id,
    boardId:    t.boardId,
    docCardId:  t.docCardId,
    workspaceId,
    tagId:      tag.id,
  }).then(() => true)));
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
