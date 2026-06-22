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

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { createNameIndex } from '../lib/entityNameTrie.js';
import { classifyCandidates } from '../lib/candidatesAiClient.js';

const CACHE = new Map(); // workspaceId → { rows, ts, enriched }
const TTL_MS = 60_000;

// Merge the free Workers AI "type + confirm" verdicts into the deterministic
// rows: drop names the model rates as non-entities (keep=false), and adopt
// the AI's entity type. Returns a NEW rows array; never throws.
function mergeVerdicts(rows, verdicts) {
  if (!Array.isArray(verdicts) || verdicts.length === 0) return rows;
  const byName = new Map(verdicts.map((v) => [String(v.name || '').toLowerCase(), v]));
  const out = [];
  for (const row of (rows || [])) {
    const v = byName.get(String(row.name || '').toLowerCase());
    if (v && v.keep === false) continue; // AI says not a real entity → drop
    out.push(v
      ? { ...row, entity_type: v.type || row.entity_type, ai_confidence: v.confidence ?? null }
      : row);
  }
  return out;
}

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
      // Deterministic type guess from get_candidate_names (character /
      // setting / organization / concept) so the promote prompt can
      // pre-highlight the likely type.
      entityType: row.entity_type || null,
    });
  }
  return idx;
}

export function useCandidateNames(workspaceId) {
  const [index, setIndex] = useState(() => createNameIndex());
  // The raw {name,n,sample} rows too — the sidebar's "Emerging" lane lists
  // them (the trie is for editor matching). Shares the cache + change-event.
  const [names, setNames] = useState([]);
  // Monotonic request id so a slow AI enrichment from a previous workspace /
  // load can't clobber the current view.
  const reqRef = useRef(0);

  const apply = useCallback((rows) => {
    setIndex(buildIndex(rows || []));
    setNames(rows || []);
  }, []);

  // Fire the free Workers AI "type + confirm" pass, then merge + repaint.
  // The Worker only calls the model for never-seen names (per-candidate
  // cache), so this is ~free at steady state. Purely additive: null verdicts
  // leave the deterministic rows untouched.
  const enrich = useCallback(async (wsId, rows, reqId) => {
    if (!rows || rows.length === 0) return;
    const verdicts = await classifyCandidates(wsId, rows);
    if (!verdicts || reqRef.current !== reqId) return;
    const merged = mergeVerdicts(rows, verdicts);
    CACHE.set(wsId, { rows: merged, ts: Date.now(), enriched: true });
    if (reqRef.current === reqId) apply(merged);
  }, [apply]);

  const load = useCallback(async (force = false) => {
    if (!supabase || !workspaceId) { apply([]); return; }
    const reqId = ++reqRef.current;
    const cached = CACHE.get(workspaceId);
    if (!force && cached && (Date.now() - cached.ts) < TTL_MS) {
      apply(cached.rows);
      // If the cached rows were never AI-enriched (e.g. AI was down on the
      // first load), try once now — still cheap (mostly server cache hits).
      if (!cached.enriched) enrich(workspaceId, cached.rows, reqId);
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_candidate_names', {
        p_workspace_id: workspaceId,
      });
      if (error) throw error;
      const rows = data || [];
      CACHE.set(workspaceId, { rows, ts: Date.now(), enriched: false });
      if (reqRef.current === reqId) apply(rows); // paint deterministic immediately
      enrich(workspaceId, rows, reqId);           // then enrich in the background
    } catch (_) {
      // Non-fatal — candidates are an enhancement; keep the prior index.
    }
  }, [workspaceId, apply, enrich]);

  useEffect(() => { load(); }, [load]);

  // Re-load when a promote/dismiss elsewhere changed the candidate set.
  useEffect(() => {
    const onChanged = () => { CACHE.delete(workspaceId); load(true); };
    document.addEventListener('soleil-candidates-changed', onChanged);
    return () => document.removeEventListener('soleil-candidates-changed', onChanged);
  }, [load, workspaceId]);

  return { index, names, refresh: () => load(true) };
}
