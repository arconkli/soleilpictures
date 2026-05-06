import { supabase } from './supabase.js';

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
    // Escape PostgREST wildcards in the user query to avoid injection.
    const safe = q.replace(/[%,]/g, ' ').trim();
    if (safe) req = req.or(`title.ilike.%${safe}%,body.ilike.%${safe}%`);
  }
  const { data, error } = await req;
  if (error) { console.warn('entity search failed', error); return []; }
  if (q) {
    const lq = q.toLowerCase();
    return [...data].sort((a, b) => rank(a, lq) - rank(b, lq));
  }
  return data;
}

function rank(row, lq) {
  const t = (row.title || '').toLowerCase();
  if (t === lq) return 0;
  if (t.startsWith(lq)) return 1;
  if (t.includes(lq)) return 2;
  return 3;
}
