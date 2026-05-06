// LRU cache for the get_entity_mentions RPC, keyed (workspace, term).
// Hovers over the same term within the TTL hit the cache; entity
// changes / new messages / doc saves invalidate the relevant entries
// via the realtime channels.
//
// The cache is a singleton — every <EntityHoverPopover> shares it.

import { supabase } from './supabase.js';

const TTL_MS = 30 * 1000;
const MAX = 200;

const store = new Map();           // key -> { value, expiresAt }
const inflight = new Map();        // key -> Promise

let realtimeWired = false;
function wireInvalidations(workspaceId) {
  if (realtimeWired) return;
  realtimeWired = true;
  if (!supabase || !workspaceId) return;
  // Any new message / card_index update / doc_page_index update
  // invalidates the workspace's term cache. Coarse but cheap; the
  // alternative (per-term invalidation) is hard because the cache
  // doesn't know which term each row affects.
  const onAny = () => clearWorkspace(workspaceId);
  try {
    supabase.channel(`mentions-cache:${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages',         filter: `workspace_id=eq.${workspaceId}` }, onAny)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_index',       filter: `workspace_id=eq.${workspaceId}` }, onAny)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doc_page_index',   filter: `workspace_id=eq.${workspaceId}` }, onAny)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entity_aliases',   filter: `workspace_id=eq.${workspaceId}` }, onAny)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards',           filter: `workspace_id=eq.${workspaceId}` }, onAny)
      .subscribe();
  } catch (e) { console.warn('entityMentionsCache realtime wiring', e); }
}

function key(workspaceId, term) {
  return `${workspaceId}:${(term || '').trim().toLowerCase()}`;
}

function clearWorkspace(workspaceId) {
  for (const k of [...store.keys()]) {
    if (k.startsWith(`${workspaceId}:`)) store.delete(k);
  }
}

function evictIfFull() {
  if (store.size <= MAX) return;
  // Drop oldest entries (Map preserves insertion order).
  const drop = store.size - MAX;
  let i = 0;
  for (const k of store.keys()) {
    if (i++ >= drop) break;
    store.delete(k);
  }
}

export async function getEntityMentions({ term, workspaceId, limit = 6 }) {
  if (!term || !workspaceId || !supabase) {
    return { entities: [], appears_in: [], total_appears: 0 };
  }
  wireInvalidations(workspaceId);
  const k = key(workspaceId, term);
  const now = Date.now();
  const cached = store.get(k);
  if (cached && cached.expiresAt > now) return cached.value;
  if (inflight.has(k)) return inflight.get(k);

  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_entity_mentions', {
        p_term: term, p_workspace: workspaceId, p_limit: limit,
      });
      if (error) { console.warn('get_entity_mentions', error); return { entities: [], appears_in: [], total_appears: 0 }; }
      const value = data || { entities: [], appears_in: [], total_appears: 0 };
      store.set(k, { value, expiresAt: Date.now() + TTL_MS });
      evictIfFull();
      return value;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

export function invalidateAll() { store.clear(); }
