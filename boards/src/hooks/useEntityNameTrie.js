// Workspace-scoped name index for the auto-detect scanner.
//
// On mount: fetches every entity_search row + every entity_aliases
// row in the workspace, populates a Trie keyed by lowered name, and
// subscribes to realtime channels so the Trie patches live as boards
// are renamed, cards are added, and aliases are added/removed.
//
// Returns { trie, ready }. The trie is the same shape exported by
// lib/entityNameTrie.js so callers (AutoLinkPlugin, scanForAutoLinks)
// can use it uniformly.

import { useEffect, useRef, useState, useContext, createContext } from 'react';
import { supabase } from '../lib/supabase.js';
import { createNameIndex } from '../lib/entityNameTrie.js';
import * as perf from '../lib/perf.js';

// Context lets any surface read the workspace-scoped trie without
// prop-drilling. App.jsx publishes it once; renderMessageBody, note
// renderers, card title renderers all read it.
export const EntityTrieContext = createContext({ trie: null, workspaceId: null });
export function useEntityTrie() { return useContext(EntityTrieContext); }

// Don't auto-link these — too short / too common.
const STOP_TERMS = new Set([
  'the','for','and','with','any','all','one','two','our','your','this','that',
  'from','about','into','then','they','them','out','also','off','on','of','to',
  'in','at','as','an','a','is','it','be','or','if','so','do','no','yes','i','me',
  'we','us','he','she','his','her','their','my','am','are','was','were','will',
  'would','could','should','can','may','might','has','have','had','not',
]);
const MIN_LEN = 4;

// Build a fresh trie from rows. Skips short / stop-word names so the
// index doesn't try to match every "the" in a doc.
function buildTrie(rows, aliases, ignored) {
  const _t0 = perf.isEnabled() ? performance.now() : 0;
  const trie = createNameIndex();
  const ignoredSet = new Set((ignored || []).map(s => s.toLowerCase()));
  const seen = new Set();
  for (const row of (rows || [])) {
    addToTrie(trie, row, row.title, ignoredSet, seen);
  }
  for (const a of (aliases || [])) {
    // Resolve alias → owning entity_search row by entity_id+kind.
    const ownerKey = `${a.entity_kind}:${a.entity_id}`;
    const owner = (rows || []).find(r => `${r.kind}:${r.id}` === ownerKey
                                      || (r.kind === 'board' && a.entity_kind === 'board' && r.board_id === a.entity_id));
    if (!owner) continue;
    addToTrie(trie, owner, a.alias, ignoredSet, seen);
  }
  if (_t0) {
    const ms = performance.now() - _t0;
    perf.mark('entityTrie.build.ms', ms);
    perf.bump('entityTrie.runs');
    perf.gauge('entityTrie.lastRows', (rows || []).length);
    perf.gauge('entityTrie.lastAliases', (aliases || []).length);
    if (ms > 50) console.warn('[perf] slow entityTrie.build', `${ms.toFixed(0)}ms`, `rows=${(rows||[]).length}`, `aliases=${(aliases||[]).length}`);
  }
  return trie;
}

function addToTrie(trie, row, name, ignoredSet, seen) {
  const n = (name || '').trim();
  const low = n.toLowerCase();
  if (!n || n.length < MIN_LEN) return;
  if (STOP_TERMS.has(low)) return;
  if (ignoredSet.has(low)) return;
  // Dedupe (kind,id,name) so the trie node has one record per entity.
  const key = `${row.kind}:${row.id}:${low}`;
  if (seen.has(key)) return;
  seen.add(key);
  trie.add({
    kind: row.kind,
    id: row.id,
    name: n,
    boardId: row.board_id || undefined,
    cardId: row.card_id || undefined,
    docCardId: row.kind === 'doc' ? row.card_id : undefined,
  });
}

export function useEntityNameTrie(workspaceId, { ignoredTerms = [] } = {}) {
  const [trie, setTrie] = useState(() => createNameIndex());
  const [ready, setReady] = useState(false);
  const versionRef = useRef(0);

  useEffect(() => {
    if (!workspaceId || !supabase) { setReady(false); return; }
    let cancelled = false;
    versionRef.current++;
    const myVersion = versionRef.current;

    const reload = async () => {
      try {
        const [r1, r2, r3] = await Promise.all([
          supabase.from('entity_search')
            .select('id,kind,workspace_id,board_id,card_id,title,updated_at')
            .eq('workspace_id', workspaceId),
          supabase.from('entity_aliases')
            .select('entity_kind,entity_id,alias')
            .eq('workspace_id', workspaceId),
          // Workspace-scoped ignore terms (per-doc scope is a follow-up).
          supabase.from('entity_ignore_terms')
            .select('term,scope,scope_id')
            .eq('workspace_id', workspaceId)
            .eq('scope', 'workspace'),
        ]);
        if (cancelled || versionRef.current !== myVersion) return;
        const rows = r1.data || [];
        const aliases = r2.data || [];
        const fromDb = (r3.data || []).map(r => r.term);
        const allIgnored = [...(ignoredTerms || []), ...fromDb];
        const next = buildTrie(rows, aliases, allIgnored);
        setTrie(next);
        setReady(true);
      } catch (e) {
        console.warn('useEntityNameTrie reload', e);
      }
    };

    // Round 14: defer the initial reload() until after first paint.
    // The trie is only needed for auto-linking entity names in prose;
    // it is NOT on the critical path for canvas pan/zoom. Hydrating it
    // synchronously on workspace mount held the main thread during the
    // user-perceived "freeze" window. requestIdleCallback lets the
    // browser fit it in after the first paint commits; a 1s timeout
    // ensures we don't wait forever on a busy device. Safari has no
    // rIC, so we fall back to a small setTimeout.
    const scheduleIdle = (typeof window !== 'undefined' && window.requestIdleCallback)
      ? (fn) => window.requestIdleCallback(fn, { timeout: 1000 })
      : (fn) => setTimeout(fn, 200);
    const cancelIdle = (typeof window !== 'undefined' && window.cancelIdleCallback)
      ? (id) => window.cancelIdleCallback(id)
      : (id) => clearTimeout(id);
    const initialIdleId = scheduleIdle(() => { if (!cancelled) reload(); });

    // Coalesce rapid changes into one rebuild — entity_search is
    // updated card-by-card during a board save, so we'd otherwise
    // burn cycles on each row.
    let pending = null;
    const schedule = () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; reload(); }, 800);
    };

    // Per-mount unique suffix — Supabase de-dupes channels by name,
    // so a re-mount with the same name returns the previously-
    // subscribed channel and `.on()` throws ("after subscribe").
    const sfx = Math.random().toString(36).slice(2, 9);
    // One multiplexed channel carrying all five postgres_changes bindings
    // (was five separate channels): same events, but a single websocket
    // join + heartbeat slot per workspace instead of five. Tags are
    // first-class entities (migration 0036) — a tag create/rename/delete
    // rebuilds the trie so its name auto-underlines like any other entity.
    const ch = supabase.channel(`trie:${workspaceId}:${sfx}`);
    for (const table of ['boards', 'card_index', 'entity_aliases', 'entity_ignore_terms', 'tags']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${workspaceId}` }, schedule);
    }
    ch.subscribe();

    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      try { cancelIdle(initialIdleId); } catch (_) {}
      try { supabase.removeChannel(ch); } catch (_) {}
    };
  }, [workspaceId, JSON.stringify(ignoredTerms)]);

  return { trie, ready };
}
