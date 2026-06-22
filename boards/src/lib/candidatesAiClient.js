// Thin client for POST /api/ai/candidates — the FREE Workers AI "type +
// confirm" enrichment over get_candidate_names. Mirrors tagsClient.js:
// JWT-authed, with a cooldown after a 5xx so we don't hammer a down Worker,
// and returns null on ANY failure so the caller silently keeps the
// deterministic candidate set (this layer is purely additive).
//
// The client stays dumb: it always posts the full candidate set. The Worker
// does the per-candidate cache delta, so it only calls the model on names it
// has never seen — see boards/src/worker-ai.js.

import { supabase } from './supabase.js';

const COOLDOWN_MS = 120_000;
let cooldownUntil = 0;

// rows: the raw get_candidate_names rows ({ name, n, sample, entity_type }).
// Returns [{ name, type, keep, confidence }] or null.
export async function classifyCandidates(workspaceId, rows) {
  if (!supabase || !workspaceId || !Array.isArray(rows) || rows.length === 0) return null;
  if (Date.now() < cooldownUntil) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    const candidates = rows.slice(0, 60).map((r) => ({
      name: r.name,
      sample: r.sample || '',
      n: Number(r.n) || 0,
      type: r.entity_type || null,
    }));
    const res = await fetch('/api/ai/candidates', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, candidates }),
    });
    if (!res.ok) {
      if (res.status >= 500) cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }
    cooldownUntil = 0;
    const out = await res.json();
    return Array.isArray(out?.verdicts) ? out.verdicts : null;
  } catch (_) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    return null;
  }
}
