// Embed every card in a workspace that doesn't yet have an embedding,
// then trigger discovery so emergent themes surface as suggested tags
// without the user having to edit every card first.
//
// Runs once per session on hook hydrate. Fast-path: count card_index
// rows vs card_embeddings rows; if they match, skip the whole pass.
// Slow path: batch /api/tags/embed for the missing cards, persist, log.
//
// Cost at typical workspace sizes:
//   - 100 cards × ~50 tokens each ≈ 5k tokens × $0.02/M = $0.0001
//   - 10k cards × ~50 tokens each ≈ 500k tokens × $0.02/M = $0.01
// One-time per workspace, then cached via card_embeddings forever.

import { supabase } from './supabase.js';
import { embedCards, formatPgvector } from './tagsClient.js';
import { contentHash } from './clusterMath.js';
import { isDebug } from './aiTaggerLog.js';

const BATCH_SIZE = 32; // cards per /api/tags/embed call

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function warmupWorkspaceEmbeddings({ workspaceId, embeddingCache }) {
  if (!supabase || !workspaceId) return null;

  // 1. Pull all cards' text + the set of already-embedded card ids.
  //    Two parallel queries — typical workspace fits in one round-trip.
  const [cardResp, embResp] = await Promise.all([
    supabase.from('card_index')
      .select('card_id, board_id, title, body')
      .eq('workspace_id', workspaceId),
    supabase.from('card_embeddings')
      .select('card_id, content_hash')
      .eq('workspace_id', workspaceId),
  ]);
  if (cardResp.error) {
    console.warn('[ai-warmup] card_index load failed', cardResp.error.message);
    return null;
  }
  const cards = cardResp.data || [];
  if (cards.length === 0) return { embedded: 0, alreadyHad: 0, total: 0 };

  const existingByHash = new Map();
  for (const r of (embResp.data || [])) {
    existingByHash.set(r.card_id, r.content_hash);
    // Don't drop in-memory cache here; the hook seeds it lazily.
  }

  // 2. Compute the actual text to embed (title + stripped body). Skip
  //    cards with empty content — embedding an empty string is wasted
  //    and produces garbage matches.
  const needed = [];
  let alreadyHad = 0;
  for (const c of cards) {
    const text = [c.title || '', stripHtml(c.body)].filter(Boolean).join(' ').trim();
    if (text.length < 2) continue;
    const hash = contentHash(text);
    if (existingByHash.get(c.card_id) === hash) {
      alreadyHad++;
      continue;
    }
    needed.push({ id: c.card_id, board_id: c.board_id, text, hash });
  }
  if (needed.length === 0) {
    if (isDebug()) console.log(`[ai-warmup] all ${alreadyHad} cards already embedded`);
    return { embedded: 0, alreadyHad, total: cards.length };
  }

  if (isDebug()) console.log(`[ai-warmup] embedding ${needed.length} new card${needed.length === 1 ? '' : 's'}...`);

  // 3. Batch-embed via /api/tags/embed.
  let embedded = 0;
  for (let i = 0; i < needed.length; i += BATCH_SIZE) {
    const slice = needed.slice(i, i + BATCH_SIZE);
    const resp = await embedCards(slice.map(s => ({ id: s.id, text: s.text })));
    if (!resp?.embeddings?.length) continue;
    // Persist each embedding + update in-memory cache.
    const rowsToUpsert = [];
    for (const e of resp.embeddings) {
      const meta = slice.find(s => s.id === e.id);
      if (!meta || !e.vector) continue;
      embeddingCache?.set(e.id, { hash: meta.hash, vector: e.vector });
      rowsToUpsert.push({
        card_id: meta.id,
        workspace_id: workspaceId,
        board_id: meta.board_id,
        content_hash: meta.hash,
        embedding: formatPgvector(e.vector),
      });
    }
    if (rowsToUpsert.length > 0) {
      const { error } = await supabase
        .from('card_embeddings')
        .upsert(rowsToUpsert, { onConflict: 'card_id' });
      if (error) console.warn('[ai-warmup] upsert failed', error.message);
      else embedded += rowsToUpsert.length;
    }
  }

  if (isDebug()) console.log(`[ai-warmup] embedded ${embedded}/${needed.length}, ${alreadyHad} already cached`);
  return { embedded, alreadyHad, total: cards.length };
}
