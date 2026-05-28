// Pure helpers for the embedding-based tagging pipeline. No imports from
// React, Supabase, or the worker — these run in the browser and stay easy
// to unit-test. Vector ops assume normalized 1536-dim float arrays from
// OpenAI text-embedding-3-small.

// ─── Vector ops ─────────────────────────────────────────────────────────

// Cosine similarity ∈ [-1, 1]. Higher = more similar. Both vectors must be
// non-empty and the same length; we don't guard for that — the caller is
// always passing OpenAI-shaped 1536-dim vectors.
export function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Cosine distance ∈ [0, 2]. 0 = identical, 1 = orthogonal, 2 = opposite.
// We treat embeddings as normalized so distances cluster ~[0, 0.6].
export function cosineDist(a, b) {
  return 1 - cosineSim(a, b);
}

// Mean of a list of equal-length vectors. Used to compute tag centroids and
// cluster centroids. Returns a fresh array; doesn't mutate inputs.
export function centroid(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

// True if the new embedding is "meaningfully different" from the previous
// one — used to skip re-evaluation on typo fixes. Threshold 0.05 cosine
// distance ≈ "the meaning didn't shift, just wording polish." Tuned empirically.
export function embeddingChangedMeaningfully(prev, next, threshold = 0.05) {
  if (!prev || !next) return true;
  return cosineDist(prev, next) >= threshold;
}

// ─── Apply-time bands ──────────────────────────────────────────────────

// Decide which tags to send to Haiku for a given card. Tags with centroid
// distance < SILENT_APPLY_DIST are auto-applied without an AI call. Tags
// with distance > NO_MATCH_DIST are dropped without an AI call. The middle
// band — the "decision zone" — is what we send to Haiku.
//
// Returns:
//   {
//     silentApply: [{tag_id}, ...],  // already confident, no Haiku needed
//     candidates:  [{tag, distance}, ...], // pass to /api/tags/apply
//     dropped:     [tag_id, ...],    // too far, ignored
//   }
//
// `tagCentroids` shape: [{tag, centroid}] where `tag` carries id+name+description.
export const SILENT_APPLY_DIST = 0.20;
export const NO_MATCH_DIST     = 0.55;
// Upper bound for tag_suggestions writes — tighter than NO_MATCH_DIST so
// the per-tag inbox doesn't fill up with weak matches. The partitioner
// still returns the full middle band; callers writing to tag_suggestions
// clip at SUGGEST_DIST.
export const SUGGEST_DIST      = 0.35;

export function partitionTagsByEmbedding(cardEmbedding, tagCentroids) {
  const silentApply = [];
  const candidates = [];
  const dropped = [];
  for (const { tag, centroid: c } of tagCentroids) {
    if (!c) { dropped.push(tag.id); continue; }
    const d = cosineDist(cardEmbedding, c);
    if (d < SILENT_APPLY_DIST)      silentApply.push({ tag_id: tag.id, distance: d });
    else if (d > NO_MATCH_DIST)     dropped.push(tag.id);
    else                            candidates.push({ tag, distance: d });
  }
  // Sort candidates closest-first so Haiku sees the most likely matches up top.
  candidates.sort((a, b) => a.distance - b.distance);
  return { silentApply, candidates, dropped };
}

// ─── Cluster discovery: union-find + hysteresis ────────────────────────

// Edge thresholds for the orphan graph (cards far from any tag). A card joins
// a cluster when its similarity to a member exceeds CLUSTER_JOIN; it stays a
// member until similarity drops below CLUSTER_LEAVE. Hysteresis prevents
// cards bouncing in and out as they're edited.
export const CLUSTER_JOIN = 0.82;   // similarity required to enter a cluster
export const CLUSTER_LEAVE = 0.74;  // similarity at which a card falls out
export const ORPHAN_TAG_DIST = 0.35; // distance from nearest tag at which a card is "orphaned"
export const MIN_CLUSTER_SIZE = 3;

// Standard union-find with path compression + union by rank. Operates over
// arbitrary string keys (card IDs in our case). Works incrementally — call
// union(a, b) for each near-neighbor edge, then read components().
export class UnionFind {
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }
  add(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }
  find(x) {
    this.add(x);
    let p = this.parent.get(x);
    while (p !== x) {
      const gp = this.parent.get(p);
      this.parent.set(x, gp);  // path compression
      x = p;
      p = gp;
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra);
    const rankB = this.rank.get(rb);
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else { this.parent.set(rb, ra); this.rank.set(ra, rankA + 1); }
  }
  // Returns Map<rootId, [memberId,...]>
  components() {
    const out = new Map();
    for (const k of this.parent.keys()) {
      const r = this.find(k);
      if (!out.has(r)) out.set(r, []);
      out.get(r).push(k);
    }
    return out;
  }
}

// Determine if a card should be considered an "orphan" (not covered by any
// existing tag). Returns true when the nearest tag centroid is further than
// ORPHAN_TAG_DIST cosine.
export function isOrphan(cardEmbedding, tagCentroids) {
  if (!tagCentroids.length) return true;
  let nearest = Infinity;
  for (const { centroid: c } of tagCentroids) {
    if (!c) continue;
    const d = cosineDist(cardEmbedding, c);
    if (d < nearest) nearest = d;
  }
  return nearest > ORPHAN_TAG_DIST;
}

// Apply hysteresis: given the previous cluster membership and a fresh
// similarity score against a candidate cluster's centroid, decide whether
// the card should be in the cluster now.
//
// - wasMember=true:  stay in unless similarity drops below CLUSTER_LEAVE
// - wasMember=false: join only if similarity exceeds CLUSTER_JOIN
//
// This prevents oscillation when a card sits near the threshold.
export function shouldBeClusterMember(similarity, wasMember) {
  if (wasMember) return similarity >= CLUSTER_LEAVE;
  return similarity >= CLUSTER_JOIN;
}

// ─── Content-hash helper (for skip-if-unchanged) ───────────────────────

// 32-bit FNV-1a; same hash you'd get from a small JS-only crypto. Used to
// detect "did the card text actually change" before re-embedding. Returns
// a hex string. We don't care about cryptographic strength here, just
// stable bucketing.
export function contentHash(text) {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
