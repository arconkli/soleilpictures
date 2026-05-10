// Cluster discovery: find groups of cards that are semantically close to
// each other but far from any existing tag, and propose a new tag name
// for each group.
//
// Triggered by useAiTagger after a card edit produces no tag matches
// (the card is an "orphan"). Debounced workspace-wide so a burst of
// edits coalesces into one discovery pass.
//
// Pipeline:
//   1. Load every card_embedding in the workspace.
//   2. Filter to orphans — cards whose nearest tag centroid is > 0.35 cosine.
//   3. Build a connected-components graph over orphan pairs with
//      similarity > 0.82 (CLUSTER_JOIN).
//   4. For each component of ≥ 3 cards: compute a stable fingerprint
//      (sorted member ids). If pending_clusters already has a row with
//      that fingerprint, skip (we've already named/dismissed/rejected it).
//   5. Pull the cards' texts, call /api/tags/cluster-name, persist the
//      result to pending_clusters with status 'named' or 'rejected'.
//
// O(N²) over orphan pairs — fine for the workspaces we currently see
// (10s-100s of orphans). For larger workspaces we'd switch to pgvector
// HNSW k-NN to find candidate edges before verifying client-side.

import { supabase } from './supabase.js';
import { nameCluster, parsePgvector, formatPgvector } from './tagsClient.js';
import {
  cosineSim,
  cosineDist,
  centroid as meanCentroid,
  UnionFind,
  ORPHAN_TAG_DIST,
  CLUSTER_JOIN,
  MIN_CLUSTER_SIZE,
} from './clusterMath.js';
import { isDebug } from './aiTaggerLog.js';

// Stable fingerprint for a set of card ids — used to dedup against
// pending_clusters rows we've already processed. Sort + join.
function clusterFingerprint(memberCardIds) {
  return [...memberCardIds].sort().join(',');
}

// Re-claim after 5 minutes — discovery is cheaper than backfill and we
// want it to re-fire reasonably often as the workspace evolves.
const DISCOVERY_LOCK_STALE_MS = 5 * 60 * 1000;

// Workspace-wide single-flight. First connected client to claim the
// lock runs the pass; everyone else short-circuits. Tries INSERT first;
// if a row exists, falls back to atomic stale-UPDATE.
async function claimDiscoveryLock(workspaceId) {
  const nowIso = new Date().toISOString();
  // Fast path: no row yet.
  const { error: insertErr } = await supabase
    .from('workspace_discovery_locks')
    .insert({ workspace_id: workspaceId, last_run_at: nowIso });
  if (!insertErr) return true;
  if (insertErr.code !== '23505') {
    console.warn('[ai-discovery] lock insert failed', insertErr.message);
    return false;
  }
  // Slow path: row exists, atomic-update if stale.
  const staleBefore = new Date(Date.now() - DISCOVERY_LOCK_STALE_MS).toISOString();
  const { data, error: updErr } = await supabase
    .from('workspace_discovery_locks')
    .update({ last_run_at: nowIso })
    .eq('workspace_id', workspaceId)
    .lt('last_run_at', staleBefore)
    .select('workspace_id');
  if (updErr) {
    console.warn('[ai-discovery] lock update failed', updErr.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

export async function runWorkspaceDiscovery({ workspaceId, tagCentroids, embeddingCache }) {
  if (!supabase || !workspaceId) return null;

  const claimed = await claimDiscoveryLock(workspaceId);
  if (!claimed) {
    if (isDebug()) console.log('[ai-discovery] another client has the lock, skipping');
    return null;
  }

  // 1. Load every card embedding in the workspace.
  const { data: rows, error } = await supabase
    .from('card_embeddings')
    .select('card_id, embedding')
    .eq('workspace_id', workspaceId);
  if (error) {
    console.warn('[ai-discovery] load embeddings failed', error.message);
    return null;
  }
  const all = [];
  for (const r of (rows || [])) {
    let vec = embeddingCache?.get(r.card_id)?.vector;
    if (!vec) vec = parsePgvector(r.embedding);
    if (vec) all.push({ cardId: r.card_id, vector: vec });
  }
  if (all.length < MIN_CLUSTER_SIZE) {
    if (isDebug()) console.log(`[ai-discovery] only ${all.length} embeddings, skipping`);
    return null;
  }

  // 2. Filter to orphans — distance > ORPHAN_TAG_DIST from every tag centroid.
  const centroidsArr = [...tagCentroids.values()];
  const orphans = all.filter(c => {
    if (centroidsArr.length === 0) return true;
    let nearest = Infinity;
    for (const tc of centroidsArr) {
      const d = cosineDist(c.vector, tc);
      if (d < nearest) nearest = d;
    }
    return nearest > ORPHAN_TAG_DIST;
  });
  if (orphans.length < MIN_CLUSTER_SIZE) {
    if (isDebug()) console.log(`[ai-discovery] only ${orphans.length} orphans, skipping (need ≥${MIN_CLUSTER_SIZE})`);
    return null;
  }

  // 3. Build a union-find over orphan pairs with similarity > CLUSTER_JOIN.
  //    O(N²) but with cheap inner-loop work; N here is typically small.
  const uf = new UnionFind();
  for (const o of orphans) uf.add(o.cardId);
  for (let i = 0; i < orphans.length; i++) {
    for (let j = i + 1; j < orphans.length; j++) {
      const sim = cosineSim(orphans[i].vector, orphans[j].vector);
      if (sim > CLUSTER_JOIN) uf.union(orphans[i].cardId, orphans[j].cardId);
    }
  }

  // 4. Group components ≥ MIN_CLUSTER_SIZE.
  const components = uf.components();
  const candidates = [];
  for (const [, members] of components) {
    if (members.length < MIN_CLUSTER_SIZE) continue;
    candidates.push(members);
  }
  if (candidates.length === 0) {
    if (isDebug()) console.log('[ai-discovery] no clusters of size ≥3');
    return null;
  }
  if (isDebug()) console.log(`[ai-discovery] ${candidates.length} candidate cluster(s) of size ≥3`);

  // 5. Dedup against existing pending_clusters rows by exact-set fingerprint.
  //    Anything we've already named, dismissed, or rejected for the same
  //    member set should not re-fire (rejected especially — we don't want
  //    to keep asking the model to name a confirmed-incoherent group).
  const fingerprints = candidates.map(clusterFingerprint);
  const { data: existing } = await supabase
    .from('pending_clusters')
    .select('id, member_card_ids, status')
    .eq('workspace_id', workspaceId);
  const seen = new Set();
  for (const row of (existing || [])) {
    if (row.status === 'dismissed' || row.status === 'rejected'
        || row.status === 'named' || row.status === 'promoted') {
      seen.add(clusterFingerprint(row.member_card_ids || []));
    }
  }

  // 6. For each new cluster, name it and persist.
  const cardTextById = new Map();
  const newClusters = [];
  for (let i = 0; i < candidates.length; i++) {
    const fingerprint = fingerprints[i];
    if (seen.has(fingerprint)) {
      if (isDebug()) console.log(`[ai-discovery] cluster ${fingerprint.slice(0, 20)}… already processed, skipping`);
      continue;
    }
    const members = candidates[i];
    // Lazy-load card texts the first time we need them.
    if (cardTextById.size === 0) {
      const allMemberIds = candidates.flat();
      const { data: idx } = await supabase.from('card_index')
        .select('card_id, title, body')
        .eq('workspace_id', workspaceId)
        .in('card_id', allMemberIds);
      for (const r of (idx || [])) {
        const text = [r.title || '', r.body || '']
          .filter(Boolean)
          .join(' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        cardTextById.set(r.card_id, text);
      }
    }
    const memberCards = members
      .map(id => ({ id, text: cardTextById.get(id) || '' }))
      .filter(m => m.text.length > 0)
      .slice(0, 5);
    if (memberCards.length < MIN_CLUSTER_SIZE) continue; // text missing for too many

    // Compute centroid for the cluster.
    const memberVectors = members
      .map(id => orphans.find(o => o.cardId === id)?.vector)
      .filter(Boolean);
    const clusterCentroid = meanCentroid(memberVectors);
    if (!clusterCentroid) continue;

    // Ask the model to name it.
    const named = await nameCluster(memberCards);
    const name = named?.name || null;
    const description = named?.description || null;
    const status = name ? 'named' : 'rejected';
    if (isDebug()) {
      console.log(`[ai-discovery] cluster of ${members.length} → ${status}${name ? `: "${name}"` : ''}`);
    }

    // Persist.
    const { error: upErr } = await supabase.from('pending_clusters').insert({
      workspace_id: workspaceId,
      member_card_ids: members,
      centroid: formatPgvector(clusterCentroid),
      proposed_name: name,
      status,
      named_at: name ? new Date().toISOString() : null,
    });
    if (upErr) {
      console.warn('[ai-discovery] persist cluster failed', upErr.message);
      continue;
    }
    newClusters.push({ members, name, description, status });
  }
  return { newClusters, totalCandidates: candidates.length };
}
