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

  // 1. Pull text for every taggable entity in the workspace, plus the
  //    set of already-embedded rows. Four parallel queries:
  //      - card_index: cards (title + body)
  //      - entity_search: groups + boards (title only)
  //      - doc_page_index: doc pages (page_text)
  //      - card_embeddings: existing rows (skip if content_hash matches)
  const [cardResp, esResp, docResp, embResp] = await Promise.all([
    supabase.from('card_index')
      .select('card_id, board_id, title, body')
      .eq('workspace_id', workspaceId),
    supabase.from('entity_search')
      .select('id, kind, board_id, title')
      .eq('workspace_id', workspaceId)
      .in('kind', ['group', 'board']),
    supabase.from('doc_page_index')
      .select('doc_card_id, page_id, page_title, page_text')
      .eq('workspace_id', workspaceId),
    supabase.from('card_embeddings')
      .select('card_id, entity_kind, content_hash')
      .eq('workspace_id', workspaceId),
  ]);
  if (cardResp.error) {
    console.warn('[ai-warmup] card_index load failed', cardResp.error.message);
    return null;
  }
  const cards = cardResp.data || [];
  const groupBoardRows = esResp.data || [];
  const docPages = docResp.data || [];
  // Doc pages don't store board_id directly. Resolve via the parent
  // doc card's row in card_index — keyed by the unique doc_card_id.
  const docCardIds = [...new Set(docPages.map(p => p.doc_card_id).filter(Boolean))];
  let docCardBoardById = new Map();
  if (docCardIds.length > 0) {
    const { data: docCards } = await supabase
      .from('card_index')
      .select('card_id, board_id')
      .in('card_id', docCardIds)
      .eq('workspace_id', workspaceId);
    for (const c of (docCards || [])) docCardBoardById.set(c.card_id, c.board_id);
  }

  // Index existing embeddings by (entity_kind, entity_id) so we can
  // skip anything whose content_hash is already current.
  const existingByHash = new Map();
  for (const r of (embResp.data || [])) {
    existingByHash.set(`${r.entity_kind || 'card'}::${r.card_id}`, r.content_hash);
  }

  // 2. Compute the text to embed for each entity kind.
  //    cards  → title + stripped body (rich content)
  //    groups → title (just the name — the semantic concept)
  //    boards → title (same)
  const needed = [];
  let alreadyHad = 0;

  const considerEntity = ({ kind, id, board_id, doc_card_id = null, text }) => {
    const t = (text || '').trim();
    if (t.length < 2) return;
    const hash = contentHash(t);
    const key = `${kind}::${id}`;
    if (existingByHash.get(key) === hash) { alreadyHad++; return; }
    needed.push({ kind, id, board_id, doc_card_id, text: t, hash });
  };

  for (const c of cards) {
    considerEntity({
      kind: 'card',
      id: c.card_id,
      board_id: c.board_id,
      text: [c.title || '', stripHtml(c.body)].filter(Boolean).join(' '),
    });
  }
  for (const p of docPages) {
    if (!p?.page_id || !p?.doc_card_id) continue;
    // The page text is already plain (doc_page_index syncs the
    // stripped version). Combine with page_title so the embedding
    // picks up section names like "Pricing", "Onboarding", etc.
    const text = [p.page_title || '', p.page_text || '']
      .filter(s => s && s.trim())
      .join('\n');
    considerEntity({
      kind: 'doc-page',
      id: p.page_id,
      board_id: docCardBoardById.get(p.doc_card_id) || null,
      doc_card_id: p.doc_card_id,
      text,
    });
  }
  for (const r of groupBoardRows) {
    // For groups, entity_id is the suffix after `:g:` in the
    // entity_search.id ('${boardId}:g:${groupId}'). For boards, just
    // use the row's id which is the board uuid.
    let id;
    if (r.kind === 'group') {
      const m = (r.id || '').split(':g:');
      id = m[1] || r.id;
    } else {
      id = r.board_id || r.id;
    }
    considerEntity({
      kind: r.kind,                              // 'group' | 'board'
      id,
      board_id: r.board_id || null,
      text: r.title || '',
    });
  }

  const totalEntities = cards.length + groupBoardRows.length;
  if (needed.length === 0) {
    if (isDebug()) console.log(`[ai-warmup] all ${alreadyHad} entities already embedded`);
    return { embedded: 0, alreadyHad, total: totalEntities };
  }

  if (isDebug()) console.log(`[ai-warmup] embedding ${needed.length} new entity${needed.length === 1 ? '' : 'ies'}...`);

  // 3. Batch-embed via /api/tags/embed. The worker route only knows
  //    about "cards" by name — we send a composite id so we can
  //    map verdicts back to (kind, entity_id). Format: `${kind}|${id}`.
  let embedded = 0;
  for (let i = 0; i < needed.length; i += BATCH_SIZE) {
    const slice = needed.slice(i, i + BATCH_SIZE);
    const resp = await embedCards(slice.map(s => ({
      id: `${s.kind}|${s.id}`,
      text: s.text,
    })));
    if (!resp?.embeddings?.length) continue;
    const rowsToUpsert = [];
    for (const e of resp.embeddings) {
      const [kind, ...rest] = (e.id || '').split('|');
      const entityId = rest.join('|');
      const meta = slice.find(s => s.kind === kind && s.id === entityId);
      if (!meta || !e.vector) continue;
      // Seed cache only for cards (existing consumers only read cards
      // out of this cache). Group/board lookups read from the DB.
      if (kind === 'card') {
        embeddingCache?.set(entityId, { hash: meta.hash, vector: e.vector });
      }
      rowsToUpsert.push({
        card_id: entityId,
        entity_kind: kind,
        workspace_id: workspaceId,
        board_id: meta.board_id,
        doc_card_id: meta.doc_card_id || null,
        content_hash: meta.hash,
        embedding: formatPgvector(e.vector),
      });
    }
    if (rowsToUpsert.length > 0) {
      const { error } = await supabase
        .from('card_embeddings')
        .upsert(rowsToUpsert, { onConflict: 'entity_kind,card_id' });
      if (error) console.warn('[ai-warmup] upsert failed', error.message);
      else embedded += rowsToUpsert.length;
    }
  }

  if (isDebug()) console.log(`[ai-warmup] embedded ${embedded}/${needed.length}, ${alreadyHad} already cached`);
  return { embedded, alreadyHad, total: totalEntities };
}
