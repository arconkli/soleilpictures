import { supabase } from './supabase.js';
import { entitySearchFilter, entitySearchRank, docPageSearchFilter, cleanSearchTerm, isMissingColumn } from './entitySearchFilter.js';
import { searchKey } from './textFold.js';
import { snippetAround } from './docText.js';
import { pictureWordPattern } from './searchTranslate.js';

// Workspace-scoped entity search backed by the entity_search Postgres view.
// Returns rows shaped { id, kind, workspace_id, board_id, card_id, title,
// body, updated_at } sorted: exact-match first, then prefix-match, then
// contains, then by updated_at desc. Limit defaults to 30. A search that
// failed returns null (not []), so a caller can say "Couldn’t load" instead of
// "No results".
export async function searchEntities({ workspaceId, query, kinds, limit = 30 }) {
  if (!supabase || !workspaceId) return [];
  const q = (query || '').trim();
  // Title, text, an uploaded file's own name, and the accent-folded text
  // (entitySearchFilter). `fold` is 0879's: a database without it answers
  // 42703, and the same read runs again on the raw words alone.
  const run = (fold) => {
    let req = supabase.from('entity_search')
      .select('id,kind,workspace_id,board_id,card_id,title,body,meta,updated_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (kinds?.length) req = req.in('kind', kinds);
    if (q) {
      const filter = entitySearchFilter(q, { fold });
      if (filter) req = req.or(filter);
    }
    return req;
  };
  let { data, error } = await run(true);
  if (error && q && isMissingColumn(error)) ({ data, error } = await run(false));
  if (error) { console.warn('entity search failed', error); return null; }
  if (q) {
    const lq = searchKey(q);
    return [...data].sort((a, b) => entitySearchRank(a, lq) - entitySearchRank(b, lq));
  }
  return data;
}

// Pictures whose description (`seen`) holds every one of these English words,
// as whole words (a plural counts). Used for a query translated from another
// language; see searchTranslate.js. Newest first.
export async function searchPicturesByWords({ workspaceId, words, limit = 8 }) {
  if (!supabase || !workspaceId || !words?.length) return [];
  const patterns = words.map(pictureWordPattern).filter(Boolean);
  if (!patterns.length) return [];
  try {
    let req = supabase.from('entity_search')
      .select('id,kind,workspace_id,board_id,card_id,title,body,meta,updated_at')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'image');
    for (const p of patterns) req = req.filter('seen', 'imatch', p);
    const { data, error } = await req.order('updated_at', { ascending: false }).limit(limit);
    if (error) { console.warn('picture word search failed', error); return []; }
    return data || [];
  } catch (e) {
    console.warn('picture word search failed', e);
    return [];
  }
}

// Pages of documents whose text or page title matches — the words INSIDE docs,
// which entity_search does not hold (a page-based doc's card row has a title
// and no body). Returns { docCardId, pageId, pageTitle, docTitle, boardId,
// snippet }, newest first (null when the search failed). Each hit names its
// doc and cluster from card_index,
// which is also what drops a page whose doc no longer exists.
export async function searchDocPages({ workspaceId, query, limit = 8 }) {
  if (!supabase || !workspaceId) return [];
  if (!docPageSearchFilter(query)) return [];
  const run = (fold) => supabase.from('doc_page_index')
    .select('doc_card_id,page_id,page_title,page_text,updated_at')
    .eq('workspace_id', workspaceId)
    .or(docPageSearchFilter(query, { fold }))
    .order('updated_at', { ascending: false })
    .limit(limit * 2);
  let { data, error } = await run(true);
  if (error && isMissingColumn(error)) ({ data, error } = await run(false));
  if (error) { console.warn('doc page search failed', error); return null; }
  if (!data?.length) return [];
  const ids = [...new Set(data.map((r) => r.doc_card_id))];
  const { data: docs, error: docsError } = await supabase.from('card_index')
    .select('card_id,board_id,title')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'doc')
    .in('card_id', ids);
  if (docsError) { console.warn('doc page search failed', docsError); return null; }
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
