// Loads a workspace's "candidate names" — recurring capitalized proper
// nouns in docs/cards that aren't tags yet (e.g. character/setting names
// that only ever appear in prose) — and builds a name index the doc
// editor uses to paint soft dotted underlines under them.
//
// One tap on an underlined name promotes it to a real tag (character /
// setting) or dismisses it. Both actions change the candidate set, so the
// hook re-loads when a workspace-wide `soleil-candidates-changed` event
// fires (dispatched by the promote / dismiss handlers in DocPageEditor),
// and also exposes refresh() for direct calls.
//
// Returned shape: { index, refresh }
//   index   — a createNameIndex() trie whose records carry
//             { kind:'candidate', name, n, sample }; identity changes on
//             each reload so consumers can force a decoration repaint.
//   refresh — () => void, re-fetches get_candidate_names.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { createNameIndex } from '../lib/entityNameTrie.js';

export function useCandidateNames(workspaceId) {
  const [index, setIndex] = useState(() => createNameIndex());

  const load = useCallback(async () => {
    if (!supabase || !workspaceId) { setIndex(createNameIndex()); return; }
    try {
      const { data, error } = await supabase.rpc('get_candidate_names', {
        p_workspace_id: workspaceId,
      });
      if (error) throw error;
      const idx = createNameIndex();
      for (const row of (data || [])) {
        if (!row?.name) continue;
        idx.add({
          kind: 'candidate',
          id: String(row.name).toLowerCase(),
          name: row.name,
          n: Number(row.n) || 0,
          sample: row.sample || '',
        });
      }
      setIndex(idx);
    } catch (_) {
      // Non-fatal — candidates are an enhancement; keep the prior index.
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  // Re-load when a promote/dismiss elsewhere changed the candidate set.
  useEffect(() => {
    const onChanged = () => load();
    document.addEventListener('soleil-candidates-changed', onChanged);
    return () => document.removeEventListener('soleil-candidates-changed', onChanged);
  }, [load]);

  return { index, refresh: load };
}
