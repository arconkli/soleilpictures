import { supabase } from './supabase.js';
import { entitySearchFilter, entitySearchRank, docPageSearchFilter, cleanSearchTerm } from './entitySearchFilter.js';
import { snippetAround } from './docText.js';

// Workspace-scoped entity search backed by the entity_search Postgres view.
// Returns rows shaped { id, kind, workspace_id, board_id, card_id, title,
// body, updated_at } sorted: exact-match first, then prefix-match, then
// contains, then by updated_at desc. Limit defaults to 30.
export async function searchEntities({ workspaceId, query, kinds, limit = 30 }) {
  if (!supabase || !workspaceId) return [];
  const q = (query || '').trim();
  let req = supabase.from('entity_search')
    .select('id,kind,workspace_id,board_id,card_id,title,body,meta,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (kinds?.length) req = req.in('kind', kinds);
  if (q) {
    // Title, text, and an uploaded file's own name (entitySearchFilter).
    const filter = entitySearchFilter(q);
    if (filter) req = req.or(filter);
  }
  const { data, error } = await req;
  if (error) { console.warn('entity search failed', error); return []; }
  if (q) {
    const lq = q.toLowerCase();
    return [...data].sort((a, b) => entitySearchRank(a, lq) - entitySearchRank(b, lq));
  }
  return data;
}

// Pages of documents whose text or page title matches — the words INSIDE docs,
// which entity_search does not hold (a page-based doc's card row has a title
// and no body). Returns { docCardId, pageId, pageTitle, docTitle, boardId,
// snippet }, newest first. Each hit names its doc and cluster from card_index,
// which is also what drops a page whose doc no longer exists.
export async function searchDocPages({ workspaceId, query, limit = 8 }) {
  if (!supabase || !workspaceId) return [];
  const filter = docPageSearchFilter(query);
  if (!filter) return [];
  const { data, error } = await supabase.from('doc_page_index')
    .select('doc_card_id,page_id,page_title,page_text,updated_at')
    .eq('workspace_id', workspaceId)
    .or(filter)
    .order('updated_at', { ascending: false })
    .limit(limit * 2);
  if (error || !data?.length) { if (error) console.warn('doc page search failed', error); return []; }
  const ids = [...new Set(data.map((r) => r.doc_card_id))];
  const { data: docs } = await supabase.from('card_index')
    .select('card_id,board_id,title')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'doc')
    .in('card_id', ids);
  const byId = new Map((docs || []).map((d) => [d.card_id, d]));
  const term = cleanSearchTerm(query);
  return data
    .filter((r) => byId.has(r.doc_card_id))
    .slice(0, limit)
    .map((r) => ({
      docCardId: r.doc_card_id,
      pageId: r.page_id,
      pageTitle: r.page_title || '',
      docTitle: byId.get(r.doc_card_id)?.title || 'Untitled doc',
      boardId: byId.get(r.doc_card_id)?.board_id || null,
      snippet: snippetAround(r.page_text, term),
    }));
}
