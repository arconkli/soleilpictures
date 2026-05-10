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

const BATCH_SIZE = 8; // cards per /api/tags/apply call

export async function backfillTagAgainstWorkspace({ workspaceId, tag, centroid, embeddingCache, appliedRef }) {
  if (!supabase || !workspaceId || !tag?.id || !centroid) return null;

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

  // 3. Silent applies — bulk-insert without paying for AI.
  for (const r of silent) {
    try {
      await tagCard({
        workspaceId,
        boardId: r.board_id,
        cardId: r.card_id,
        tagId: tag.id,
        source: 'auto',
      });
    } catch (e) {
      // tagCard swallows 23505 internally; anything else is logged.
      console.warn('[ai-backfill] silent apply failed', e?.message || e);
    }
  }

  // 4. Middle band — batch-call /apply for tier verdict, then apply 'high'.
  if (middle.length === 0) return { silent: silent.length, applied_high: 0, ai_calls: 0 };

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

  let appliedHigh = 0;
  let aiCalls = 0;
  for (let i = 0; i < middle.length; i += BATCH_SIZE) {
    const slice = middle.slice(i, i + BATCH_SIZE);
    const cards = slice
      .map(r => ({
        id: r.card_id,
        text: textById.get(r.card_id) || '',
        candidate_tags: [{ id: tag.id, name: tag.name }],
      }))
      .filter(c => c.text);
    if (cards.length === 0) continue;
    const resp = await applyCards(cards);
    aiCalls++;
    const verdicts = resp?.verdicts || [];
    for (const v of verdicts) {
      const high = (v.tags || []).find(t => t.tag_id === tag.id && t.confidence === 'high');
      if (!high) continue;
      const boardId = boardById.get(v.card_id);
      if (!boardId) continue;
      try {
        await tagCard({
          workspaceId,
          boardId,
          cardId: v.card_id,
          tagId: tag.id,
          source: 'auto',
        });
        appliedHigh++;
      } catch (e) {
        console.warn('[ai-backfill] verdict apply failed', e?.message || e);
      }
    }
  }

  return { silent: silent.length, applied_high: appliedHigh, ai_calls: aiCalls };
}
