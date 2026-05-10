// Thin fetch wrappers around the /api/tags/* worker routes.
// All requests carry the user's Supabase JWT in the Authorization header
// so the worker can verify against /auth/v1/user before spending tokens.
// Returns null on any auth/transport failure (silently drops; callers
// should treat null as "no suggestions" so the UI doesn't pop errors
// when the worker is briefly down).

import { supabase } from './supabase.js';

async function authedFetch(path, body) {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    const r = await fetch(path, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.warn(`[tagsClient] ${path} ${r.status}:`, errText.slice(0, 200));
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn(`[tagsClient] ${path} threw:`, e?.message || e);
    return null;
  }
}

// Embed a batch of texts via /api/tags/embed.
// cards: [{ id, text }]
// Returns: [{ id, vector }] or null on failure.
export async function embedCards(cards) {
  if (!cards?.length) return [];
  const data = await authedFetch('/api/tags/embed', { cards });
  return data?.embeddings || null;
}

// Convenience: embed a single text. Returns Float32Array-like array or null.
export async function embedOne(id, text) {
  const out = await embedCards([{ id: String(id), text: String(text || '') }]);
  return out?.[0]?.vector || null;
}

// Score a batch of cards against candidate tags via /api/tags/apply.
// cards: [{ id, text, candidate_tags: [{ id, name, description? }] }]
// Returns: [{ card_id, tags: [{ tag_id, confidence: "high"|"medium"|"low" }] }] or null.
export async function applyCards(cards) {
  if (!cards?.length) return [];
  const data = await authedFetch('/api/tags/apply', { cards });
  return data?.verdicts || null;
}

// Name an emergent cluster via /api/tags/cluster-name (Phase 2).
// member_cards: 3-8 representative cards. Returns { name, description } or null.
export async function nameCluster(memberCards) {
  if (!Array.isArray(memberCards) || memberCards.length < 3) return null;
  return authedFetch('/api/tags/cluster-name', { member_cards: memberCards });
}

// ─── pgvector helpers ──────────────────────────────────────────────────

// supabase-js can pass arrays directly to pgvector columns on insert/upsert,
// but on select they come back as strings like "[0.1,0.2,...]". Parse to
// a plain JS number array.
export function parsePgvector(s) {
  if (Array.isArray(s)) return s;
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1);
  if (!inner) return null;
  const parts = inner.split(',');
  const out = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

// Format an array of floats as the literal string pgvector accepts on insert.
// supabase-js often auto-converts, but the string form works on all clients
// and avoids implicit JSON-vs-array serialization differences.
export function formatPgvector(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return null;
  return '[' + vec.join(',') + ']';
}
