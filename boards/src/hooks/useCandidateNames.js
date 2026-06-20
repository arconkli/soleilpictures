// Loads a workspace's "candidate names" — recurring capitalized proper
// nouns in docs/cards that aren't tags yet (e.g. character/setting names
// that only ever appear in prose) — and builds a name index the doc and
// note editors use to paint soft dotted underlines under them.
//
// One tap on an underlined name promotes it to a real tag (character /
// setting) or dismisses it. Both actions change the candidate set, so the
// hook re-loads when a workspace-wide `soleil-candidates-changed` event
// fires (dispatched by the promote / dismiss handlers), and also exposes
// refresh().
//
// A short module-level TTL cache keeps re-opening editors instant: notes
// mount/unmount their editor every time you edit one on the canvas, so we
// don't want a 300ms RPC each time. The change-event busts the cache.
//
// Returned shape: { index, refresh }
//   index   — a createNameIndex() trie whose records carry
//             { kind:'candidate', name, n, sample }; identity changes on
//             each reload so consumers can force a decoration repaint.
//   refresh — () => void, force-refetches get_candidate_names.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { createNameIndex } from '../lib/entityNameTrie.js';

const CACHE = new Map(); // workspaceId → { rows, ts }
const TTL_MS = 60_000;

function buildIndex(rows) {
  const idx = createNameIndex();
  for (const row of (rows || [])) {
    if (!row?.name) continue;
    idx.add({
      kind: 'candidate',
      id: String(row.name).toLowerCase(),
      name: row.name,
      n: Number(row.n) || 0,
      sample: row.sample || '',
    });
  }
  return idx;
}

export function useCandidateNames(workspaceId) {
  const [index, setIndex] = useState(() => createNameIndex());
  // The raw {name,n,sample} rows too — the sidebar's "Emerging" lane lists
  // them (the trie is for editor matching). Shares the cache + change-event.
  const [names, setNames] = useState([]);

  const load = useCallback(async (force = false) => {
    if (!supabase || !workspaceId) { setIndex(createNameIndex()); setNames([]); return; }
    const cached = CACHE.get(workspaceId);
    if (!force && cached && (Date.now() - cached.ts) < TTL_MS) {
      setIndex(buildIndex(cached.rows));
      setNames(cached.rows);
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_candidate_names', {
        p_workspace_id: workspaceId,
      });
      if (error) throw error;
      CACHE.set(workspaceId, { rows: data || [], ts: Date.now() });
      setIndex(buildIndex(data || []));
      setNames(data || []);
    } catch (_) {
      // Non-fatal — candidates are an enhancement; keep the prior index.
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  // Re-load when a promote/dismiss elsewhere changed the candidate set.
  useEffect(() => {
    const onChanged = () => { CACHE.delete(workspaceId); load(true); };
    document.addEventListener('soleil-candidates-changed', onChanged);
    return () => document.removeEventListener('soleil-candidates-changed', onChanged);
  }, [load, workspaceId]);

  return { index, names, refresh: () => load(true) };
}
