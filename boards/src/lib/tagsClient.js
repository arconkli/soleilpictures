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
// Returns: { embeddings: [{ id, vector }], usage: {...}, ms } or null on failure.
export async function embedCards(cards) {
  if (!cards?.length) return { embeddings: [], usage: null, ms: 0 };
  const t0 = performance.now();
  const data = await authedFetch('/api/tags/embed', { cards });
  if (!data) return null;
  return { embeddings: data.embeddings || [], usage: data.usage || null, ms: performance.now() - t0 };
}

// Convenience: embed a single text. Returns { vector, usage, ms } or null.
export async function embedOne(id, text) {
  const out = await embedCards([{ id: String(id), text: String(text || '') }]);
  if (!out?.embeddings?.[0]?.vector) return null;
  return { vector: out.embeddings[0].vector, usage: out.usage, ms: out.ms };
}

// Score a batch of cards against candidate tags via /api/tags/apply.
// cards: [{ id, text, candidate_tags: [{ id, name, description? }] }]
// Returns: { verdicts: [...], usage: {...}, ms } or null on failure.
export async function applyCards(cards) {
  if (!cards?.length) return { verdicts: [], usage: null, ms: 0 };
  const t0 = performance.now();
  const data = await authedFetch('/api/tags/apply', { cards });
  if (!data) return null;
  return { verdicts: data.verdicts || [], usage: data.usage || null, ms: performance.now() - t0 };
}

// Name an emergent cluster via /api/tags/cluster-name (Phase 2).
// member_cards: 3-8 representative cards.
// opts.existingNames: strings the model must NOT collide with (existing tags
//   in the workspace + names already given to other pending clusters). The
//   model returns name: null when its only honest name would duplicate one.
// Returns { name, description } or null.
export async function nameCluster(memberCards, opts = {}) {
  if (!Array.isArray(memberCards) || memberCards.length < 3) return null;
  const existingNames = Array.isArray(opts.existingNames) ? opts.existingNames : [];
  return authedFetch('/api/tags/cluster-name', {
    member_cards: memberCards,
    existing_names: existingNames,
  });
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
