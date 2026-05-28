// AI-powered tag suggester. Drop-in replacement for useAutotagWorker:
// same { ready, suggestTags(content, target) } return shape, same suggestion
// schema (`[{tagId, score, reason}]`), so the existing CanvasSurface and
// any other caller wires up without changes.
//
// Internals (Phase 1):
//   1. Embed the query text via the /api/tags/embed worker route.
//   2. Partition tags into silentApply / candidates / dropped by cosine
//      distance against each tag's stored centroid.
//   3. For middle-band candidates, call /api/tags/apply for a high/medium/
//      low confidence verdict.
//   4. Return suggestions in the legacy format — high → score 1.0 (silent
//      apply), medium → score 0.4 (below CanvasSurface's HIGH=0.5 gate,
//      so it surfaces in the sidebar without auto-applying), low → dropped.
//
// Centroids: for Phase 1 we lazily seed each tag's centroid from the
// embedding of its NAME if no centroid is stored yet. Quality isn't as
// good as a real card-derived centroid, but the system works end-to-end
// without a backfill. Phase 1.5 will recompute centroids from member
// cards as they get tagged.

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { embedOne, embedCards, applyCards, parsePgvector, formatPgvector } from '../lib/tagsClient.js';
import {
  partitionTagsByEmbedding,
  cosineDist,
  centroid as meanCentroid,
  contentHash,
  SILENT_APPLY_DIST,
  NO_MATCH_DIST,
} from '../lib/clusterMath.js';
import { logDecision, recordCall, isDebug } from '../lib/aiTaggerLog.js';
import { runWorkspaceDiscovery } from '../lib/aiDiscovery.js';
import { backfillTagAgainstWorkspace } from '../lib/aiBackfill.js';
import { warmupWorkspaceEmbeddings } from '../lib/aiWarmup.js';
import { propagateTagToGroups } from '../lib/aiGroupPropagation.js';

// Round 19: mount-time work (warmup, centroid seeding) gets pushed to
// idle so it can't compete with the boot/paint window. Same pattern
// Round 14 used for the legacy entity-trie + autotag worker.
const _scheduleIdle = (typeof window !== 'undefined' && window.requestIdleCallback)
  ? (fn) => window.requestIdleCallback(fn, { timeout: 2500 })
  : (fn) => setTimeout(fn, 300);
const _cancelIdle = (typeof window !== 'undefined' && window.cancelIdleCallback)
  ? (id) => window.cancelIdleCallback(id)
  : (id) => clearTimeout(id);

// Strip HTML tags / entities and collapse whitespace before sending text to
// the embedding model. Saves tokens and improves quality — `<span style=...>`
// markup has no semantic meaning, but the embedder will still weight it.
function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Recompute a tag's centroid from the embeddings of cards currently tagged
// with it. Replaces the lazy name-derived fallback with a real card-derived
// centroid as soon as we have ≥1 member card with an embedding stored.
//
// Triggered (debounced) on every apply/unapply of this tag. Idempotent and
// safe to call when no cards are embedded yet — bails silently.
async function recomputeCentroidFromMembers(tagId, workspaceId, centroidsRef, cardEmbeddingCacheRef) {
  if (!supabase || !tagId || !workspaceId) return;
  // 1. Get all cards currently tagged with this tag.
  const { data: links, error: linksErr } = await supabase
    .from('entity_links')
    .select('source_kind, source_id')
    .eq('source_workspace', workspaceId)
    .eq('target_kind', 'tag')
    .eq('target_id', tagId)
    .eq('link_kind', 'applied');
  if (linksErr) {
    console.warn('[ai-tagger] recompute centroid: links query failed', linksErr.message);
    return;
  }
  const cardIds = (links || [])
    .filter(l => l.source_kind === 'card' && l.source_id)
    .map(l => l.source_id);
  if (cardIds.length === 0) return; // no card members, leave name-derived centroid

  // 2. Pull embeddings for those cards. In-memory first, fall back to DB.
  const vectors = [];
  const missingIds = [];
  for (const id of cardIds) {
    const cached = cardEmbeddingCacheRef.current.get(id);
    if (cached?.vector) vectors.push(cached.vector);
    else missingIds.push(id);
  }
  if (missingIds.length > 0) {
    const { data: rows } = await supabase.from('card_embeddings')
      .select('card_id, embedding, content_hash')
      .eq('workspace_id', workspaceId)
      .in('card_id', missingIds);
    for (const r of (rows || [])) {
      const v = parsePgvector(r.embedding);
      if (v) {
        cardEmbeddingCacheRef.current.set(r.card_id, { hash: r.content_hash, vector: v });
        vectors.push(v);
      }
    }
  }
  if (vectors.length === 0) return; // members exist but no embeddings yet

  // 3. Mean → new centroid. Persist + update in-memory.
  const newCentroid = meanCentroid(vectors);
  if (!newCentroid) return;
  centroidsRef.current.set(tagId, newCentroid);
  const { error: upErr } = await supabase.from('tag_centroids').upsert({
    tag_id: tagId,
    workspace_id: workspaceId,
    centroid: formatPgvector(newCentroid),
    card_count: vectors.length,
    last_named_centroid: formatPgvector(newCentroid),
    last_named_at: new Date().toISOString(),
  }, { onConflict: 'tag_id' });
  if (upErr) {
    console.warn('[ai-tagger] persist centroid failed', upErr.message);
    return;
  }
  if (isDebug()) {
    console.log(`[ai-tagger] recomputed centroid for tag ${tagId.slice(0, 8)} from ${vectors.length} member card${vectors.length === 1 ? '' : 's'}`);
  }
}

export function useAiTagger(workspaceId) {
  const [ready, setReady] = useState(false);
  // Tag rows for the workspace. Refreshed on init + tag-realtime change.
  const tagsRef = useRef([]); // [{id, name, slug, color}]
  // tagId -> centroid (plain number[]). In-memory only; persisted to
  // tag_centroids table for cold-start performance.
  const centroidsRef = useRef(new Map());
  // tag-name embedding promise dedup — multiple suggestTags calls in flight
  // shouldn't each kick off the same embed call for an uncentroided tag.
  const centroidPromisesRef = useRef(new Map());
  // `${source_kind}:${source_id}` → Set<tag_id> of already-applied tags.
  // Filters out duplicate suggestions so we don't emit insert calls that
  // generate noisy 409s for tags already on the target.
  const appliedRef = useRef(new Map());
  // cardId → { hash, vector }. In-memory mirror of card_embeddings; the
  // table is the persistent layer for cold-start across sessions.
  const cardEmbeddingCacheRef = useRef(new Map());
  // tagId → setTimeout handle. Debounced centroid recomputation per tag
  // — repeated apply/unapply in a quick burst settles into one recompute.
  const centroidDebounceRef = useRef(new Map());
  // Workspace-wide discovery is debounced too — a burst of orphan-card
  // edits should produce one discovery pass, not one per edit.
  const discoveryDebounceRef = useRef(null);
  // Track which new tags have been backfilled this session so the
  // tags-realtime listener doesn't re-fire for tags we just created.
  const backfilledTagsRef = useRef(new Set());

  // Load tags + any persisted centroids + currently-applied tag links on
  // workspace change. Also check the workspace-level ai_tagger_enabled
  // toggle — if a workspace owner has flipped it off (privacy / cost
  // reasons), the hook stays in the not-ready state and never sends
  // card content to OpenAI for this workspace.
  useEffect(() => {
    if (!workspaceId || !supabase) { setReady(false); return; }
    let cancelled = false;
    setReady(false);
    async function load() {
      // Per-workspace AI opt-out check. If disabled, short-circuit.
      const { data: ws } = await supabase.from('workspaces')
        .select('ai_tagger_enabled')
        .eq('id', workspaceId)
        .maybeSingle();
      if (cancelled) return;
      if (ws && ws.ai_tagger_enabled === false) {
        if (isDebug()) console.log('[ai-tagger] disabled for workspace', workspaceId);
        return; // never sets ready=true; suggestTags returns [] forever
      }
      const [tagsResp, centroidsResp, appliedResp] = await Promise.all([
        supabase.from('tags')
          .select('id, name, slug, color')
          .eq('workspace_id', workspaceId),
        supabase.from('tag_centroids')
          .select('tag_id, centroid')
          .eq('workspace_id', workspaceId),
        supabase.from('entity_links')
          .select('source_kind, source_id, target_id')
          .eq('source_workspace', workspaceId)
          .eq('target_kind', 'tag')
          .eq('link_kind', 'applied'),
      ]);
      if (cancelled) return;
      tagsRef.current = tagsResp.data || [];
      centroidsRef.current.clear();
      centroidPromisesRef.current.clear();
      appliedRef.current.clear();
      for (const r of (centroidsResp.data || [])) {
        const v = parsePgvector(r.centroid);
        if (v) centroidsRef.current.set(r.tag_id, v);
      }
      for (const r of (appliedResp.data || [])) {
        const key = `${r.source_kind}:${r.source_id}`;
        if (!appliedRef.current.has(key)) appliedRef.current.set(key, new Set());
        appliedRef.current.get(key).add(r.target_id);
      }
      if (isDebug()) {
        console.log(`[ai-tagger] hydrate done — ${tagsRef.current.length} tags, ${centroidsRef.current.size} centroids, ${appliedRef.current.size} tagged entities`);
      }
      setReady(true);

      // Warm up embeddings + run discovery in the background after the
      // hook is ready. Idempotent — embeds only cards that don't already
      // have a matching content_hash row. After warmup, if we have ≥3
      // cards and few/no tags, kick off discovery immediately so the
      // user sees suggested tags appear without having to edit anything.
      //
      // Round 19: defer the warmup launch until idle time so the
      // /api/tags/embed calls + their failure-handling don't compete
      // with the boot/paint window. Same pattern Round 14 applied to
      // the legacy autotag worker.
      _scheduleIdle(() => {
        if (cancelled) return;
        (async () => {
          const result = await warmupWorkspaceEmbeddings({
            workspaceId,
            embeddingCache: cardEmbeddingCacheRef.current,
          });
          if (cancelled) return;
          const totalEmbeddings = (result?.embedded || 0) + (result?.alreadyHad || 0);
          // Trigger discovery if we have enough cards. The lock at the DB
          // level keeps multiple connected clients from doubling up.
          if (totalEmbeddings >= 3) {
            if (isDebug()) console.log(`[ai-tagger] kicking off discovery against ${totalEmbeddings} cards`);
            runWorkspaceDiscovery({
              workspaceId,
              tagCentroids: centroidsRef.current,
              embeddingCache: cardEmbeddingCacheRef.current,
            }).catch(err => console.warn('[ai-discovery] run failed', err?.message || err));
          }
        })().catch(err => console.warn('[ai-warmup] failed', err?.message || err));
      });
    }
    load().catch(err => console.warn('[ai-tagger] hydrate failed', err));
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Schedule a debounced centroid recompute for a tag. Runs ~1.5s after
  // the last apply/unapply for that tag so a burst of changes coalesces.
  const scheduleCentroidRecompute = useCallback((tagId) => {
    if (!tagId) return;
    const existing = centroidDebounceRef.current.get(tagId);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      centroidDebounceRef.current.delete(tagId);
      recomputeCentroidFromMembers(tagId, workspaceId, centroidsRef, cardEmbeddingCacheRef);
    }, 1500);
    centroidDebounceRef.current.set(tagId, handle);
  }, [workspaceId]);

  // Same pattern for group propagation: debounce per-tag so a burst
  // of card applies for the same tag coalesces into one workspace
  // scan. 1.5s settle matches centroid recompute and keeps the two
  // effects aligned.
  const groupPropagateDebounceRef = useRef(new Map());
  const scheduleGroupPropagate = useCallback((tagId) => {
    if (!tagId || !workspaceId) return;
    const existing = groupPropagateDebounceRef.current.get(tagId);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      groupPropagateDebounceRef.current.delete(tagId);
      propagateTagToGroups({ workspaceId, tagId }).catch(() => {});
    }, 1500);
    groupPropagateDebounceRef.current.set(tagId, handle);
  }, [workspaceId]);

  // Track applied-tag inserts/deletes so the filter stays current as the
  // user (or our own auto-applies) modify tags. Subscribed only after
  // initial hydrate so the in-memory map starts in sync.
  useEffect(() => {
    if (!workspaceId || !supabase || !ready) return;
    const chId = `ai-tagger-applied-${workspaceId}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase.channel(chId)
      .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'entity_links', filter: `source_workspace=eq.${workspaceId}` },
          (payload) => {
            const r = payload?.new || {};
            if (r.target_kind !== 'tag' || r.link_kind !== 'applied') return;
            const key = `${r.source_kind}:${r.source_id}`;
            if (!appliedRef.current.has(key)) appliedRef.current.set(key, new Set());
            appliedRef.current.get(key).add(r.target_id);
            scheduleCentroidRecompute(r.target_id);
            // Only trigger group propagation on CARD applies. Group
            // applies (which propagation itself emits) would loop back
            // through here otherwise.
            if (r.source_kind === 'card') scheduleGroupPropagate(r.target_id);
          })
      .on('postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'entity_links', filter: `source_workspace=eq.${workspaceId}` },
          (payload) => {
            const r = payload?.old || {};
            if (r.target_kind !== 'tag' || r.link_kind !== 'applied') return;
            const key = `${r.source_kind}:${r.source_id}`;
            const set = appliedRef.current.get(key);
            if (set) set.delete(r.target_id);
            scheduleCentroidRecompute(r.target_id);
          });
    ch.subscribe();
    return () => {
      try { supabase.removeChannel(ch); } catch {}
      // Cancel any pending recomputes / propagations on unmount.
      for (const h of centroidDebounceRef.current.values()) clearTimeout(h);
      centroidDebounceRef.current.clear();
      for (const h of groupPropagateDebounceRef.current.values()) clearTimeout(h);
      groupPropagateDebounceRef.current.clear();
    };
  }, [workspaceId, ready, scheduleCentroidRecompute, scheduleGroupPropagate]);

  // After hydrate, seed centroids for any tag that already has applied
  // cards. This pulls workspaces with pre-existing tag applications onto
  // proper card-derived centroids immediately, instead of waiting for
  // the next apply/unapply to trigger it.
  //
  // Round 19: defer the seed pass until idle time. Pre-Round-19 this
  // dogpiled the main thread immediately after `ready=true`, producing
  // 300-600ms longtasks during the boot window — each recompute parses
  // ~31 cards × 1536 floats from pgvector strings on the main thread.
  // The 200ms stagger between tags helped but didn't help the FIRST tag
  // (which fired synchronously). With requestIdleCallback the whole
  // storm waits for the user to stop interacting.
  useEffect(() => {
    if (!ready || !workspaceId) return;
    const tags = tagsRef.current;
    if (!tags?.length) return;
    let cancelled = false;
    const timeouts = [];
    const idleId = _scheduleIdle(() => {
      if (cancelled) return;
      let i = 0;
      for (const tag of tags) {
        const t = setTimeout(() => {
          if (cancelled) return;
          recomputeCentroidFromMembers(tag.id, workspaceId, centroidsRef, cardEmbeddingCacheRef);
        }, i * 200);
        timeouts.push(t);
        i++;
      }
    });
    return () => {
      cancelled = true;
      try { _cancelIdle(idleId); } catch (_) {}
      for (const t of timeouts) clearTimeout(t);
    };
  }, [ready, workspaceId]);

  // Look up or fetch the embedding for a card. Three-tier lookup:
  //   1. In-memory cache (hit when same card scored twice in a session)
  //   2. card_embeddings table (hit on cold start for previously-embedded card)
  //   3. /api/tags/embed (network call, persist for next time)
  // Returns { vector, usage, ms, cached } or null.
  const getOrFetchCardEmbedding = useCallback(async (cardId, text) => {
    const hash = contentHash(text);
    // Tier 1: memory
    const cached = cardEmbeddingCacheRef.current.get(cardId);
    if (cached && cached.hash === hash) {
      return { vector: cached.vector, usage: null, ms: 0, cached: 'memory' };
    }
    // Tier 2: Supabase
    try {
      const { data } = await supabase.from('card_embeddings')
        .select('content_hash, embedding')
        .eq('card_id', cardId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (data?.content_hash === hash) {
        const v = parsePgvector(data.embedding);
        if (v) {
          cardEmbeddingCacheRef.current.set(cardId, { hash, vector: v });
          return { vector: v, usage: null, ms: 0, cached: 'db' };
        }
      }
    } catch (e) {
      console.warn('[ai-tagger] card_embeddings lookup failed', e?.message || e);
    }
    // Tier 3: network embed + persist
    const result = await embedOne(cardId, text);
    if (!result?.vector) return null;
    cardEmbeddingCacheRef.current.set(cardId, { hash, vector: result.vector });
    // Fire-and-forget upsert. If this fails (RLS, missing workspace_id, etc.)
    // we just won't have a persistent cache; next session will re-embed.
    supabase.from('card_embeddings').upsert({
      card_id: cardId,
      entity_kind: 'card',
      workspace_id: workspaceId,
      content_hash: hash,
      embedding: formatPgvector(result.vector),
    }, { onConflict: 'entity_kind,card_id' }).then(({ error }) => {
      if (error) console.warn('[ai-tagger] persist card embedding failed', error.message);
    });
    return { vector: result.vector, usage: result.usage, ms: result.ms, cached: false };
  }, [workspaceId]);

  // Subscribe to tag definition changes so renames / new tags / deletes
  // land in tagsRef without a page reload. INSERT also triggers backfill
  // against existing cards so a newly-created tag doesn't have to wait
  // for every card to be re-edited to pick up its members.
  useEffect(() => {
    if (!workspaceId || !supabase || !ready) return;
    const chId = `ai-tagger-tags-${workspaceId}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase.channel(chId)
      .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'tags', filter: `workspace_id=eq.${workspaceId}` },
          async (payload) => {
            const tag = payload?.new;
            if (!tag?.id) return;
            // Update tagsRef.
            const { data } = await supabase.from('tags')
              .select('id, name, slug, color')
              .eq('workspace_id', workspaceId);
            tagsRef.current = data || [];
            // Seed centroid from name (lazy fallback) then kick off backfill.
            const centroid = await ensureCentroidFn.current?.(tag);
            if (centroid && !backfilledTagsRef.current.has(tag.id)) {
              backfilledTagsRef.current.add(tag.id);
              // Slight delay so any concurrent applies (e.g., cluster promotion
              // applies members directly) land first and we don't double-apply.
              setTimeout(async () => {
                const result = await backfillTagAgainstWorkspace({
                  workspaceId,
                  tag,
                  centroid,
                  embeddingCache: cardEmbeddingCacheRef.current,
                  appliedRef,
                });
                if (isDebug() && result) {
                  console.log(`[ai-backfill] "${tag.name}" → ${result.silent} silent + ${result.applied_high} ai-high (${result.ai_calls} apply call${result.ai_calls === 1 ? '' : 's'})`);
                }
              }, 1500);
            }
          })
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'tags', filter: `workspace_id=eq.${workspaceId}` },
          async () => {
            const { data } = await supabase.from('tags')
              .select('id, name, slug, color')
              .eq('workspace_id', workspaceId);
            tagsRef.current = data || [];
          })
      .on('postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'tags', filter: `workspace_id=eq.${workspaceId}` },
          async (payload) => {
            const removed = payload?.old?.id;
            if (removed) {
              centroidsRef.current.delete(removed);
              backfilledTagsRef.current.delete(removed);
            }
            const { data } = await supabase.from('tags')
              .select('id, name, slug, color')
              .eq('workspace_id', workspaceId);
            tagsRef.current = data || [];
          });
    ch.subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [workspaceId, ready]);

  // Ref-stable handle to ensureCentroid so the tags-realtime callback above
  // can call it without re-binding the channel every render. Set after
  // ensureCentroid is defined further down.
  const ensureCentroidFn = useRef(null);

  // Lazily produce a centroid for a tag that has no stored one. Falls
  // back to the embedding of the tag's name. Dedupes concurrent calls.
  const ensureCentroid = useCallback(async (tag) => {
    const existing = centroidsRef.current.get(tag.id);
    if (existing) return existing;
    let promise = centroidPromisesRef.current.get(tag.id);
    if (promise) return promise;
    promise = (async () => {
      const text = (tag.name || tag.slug || '').trim();
      if (!text) return null;
      const result = await embedOne(tag.id, text);
      if (!result?.vector) return null;
      const vec = result.vector;
      centroidsRef.current.set(tag.id, vec);
      // Persist for cold-start performance. Fire-and-forget; the in-memory
      // copy is the source of truth for this session.
      try {
        await supabase.from('tag_centroids').upsert({
          tag_id: tag.id,
          workspace_id: workspaceId,
          centroid: formatPgvector(vec),
          card_count: 0,
        }, { onConflict: 'tag_id' });
      } catch (e) {
        console.warn('[ai-tagger] persist centroid failed', e?.message || e);
      }
      return vec;
    })();
    centroidPromisesRef.current.set(tag.id, promise);
    try {
      return await promise;
    } finally {
      centroidPromisesRef.current.delete(tag.id);
    }
  }, [workspaceId]);
  // Stash a stable handle so the tags-realtime callback above can invoke
  // ensureCentroid without re-binding on every render.
  ensureCentroidFn.current = ensureCentroid;

  // Debounced workspace-wide discovery pass. Triggered after a card-edit
  // suggestTags finds the card has no high-confidence matches (orphan)
  // — repeat orphans during a burst of edits collapse to one pass.
  const scheduleDiscovery = useCallback(() => {
    if (!workspaceId) return;
    if (discoveryDebounceRef.current) clearTimeout(discoveryDebounceRef.current);
    discoveryDebounceRef.current = setTimeout(() => {
      discoveryDebounceRef.current = null;
      runWorkspaceDiscovery({
        workspaceId,
        tagCentroids: centroidsRef.current,
        embeddingCache: cardEmbeddingCacheRef.current,
      }).catch(err => console.warn('[ai-discovery] run failed', err?.message || err));
    }, 4000);
  }, [workspaceId]);

  const suggestTags = useCallback(async (content, target) => {
    if (!ready || !workspaceId || !supabase) return [];
    // Strip HTML before doing anything else — feeding span/style markup to
    // the embedding model wastes tokens and adds noise.
    const text = stripHtml(content);
    if (!text) return [];
    const tags = tagsRef.current;
    if (!tags.length) return [];

    // Tags already applied to this target — never re-suggest them.
    const targetKey = target ? `${target.kind}:${target.id}` : null;
    const alreadyApplied = (targetKey && appliedRef.current.get(targetKey)) || new Set();

    // 1. Embed the query. For cards we use the persistent embedding cache
    //    (in-memory + card_embeddings table) so unchanged content doesn't
    //    re-embed across edits or sessions. Groups and boards re-embed
    //    every time — they're rare and cheap.
    let queryVec, embedMs, embedUsage;
    if (target?.kind === 'card' && target?.id) {
      const r = await getOrFetchCardEmbedding(target.id, text);
      if (!r?.vector) return [];
      queryVec = r.vector;
      embedMs = r.ms || 0;
      embedUsage = r.usage;
    } else {
      const r = await embedOne(target?.id || 'q', text);
      if (!r?.vector) return [];
      queryVec = r.vector;
      embedMs = r.ms;
      embedUsage = r.usage;
    }

    // 2. Make sure every tag has a centroid (lazy seed from name on miss).
    //    Run concurrently — these are independent network calls.
    const tagsWithCentroids = await Promise.all(
      tags.map(async (tag) => {
        const c = await ensureCentroid(tag);
        return c ? { tag, centroid: c } : null;
      }),
    );
    const ready_tags = tagsWithCentroids.filter(Boolean);
    if (!ready_tags.length) return [];

    // 3. Partition by embedding distance. We also compute a per-tag
    //    breakdown here for logging, since clusterMath only returns the
    //    bucketed view.
    const { silentApply, candidates } = partitionTagsByEmbedding(queryVec, ready_tags);
    const perTag = ready_tags.map(({ tag, centroid }) => {
      const distance = cosineDist(queryVec, centroid);
      let outcome;
      if (distance < SILENT_APPLY_DIST) outcome = 'silent';
      else if (distance > NO_MATCH_DIST) outcome = 'dropped';
      else outcome = 'candidate';
      return { tagId: tag.id, tagName: tag.name, distance, outcome };
    });

    // 4. For middle-band candidates, ask the model.
    let verdicts = [];
    let applyMs = 0;
    let applyUsage = null;
    if (candidates.length > 0) {
      const apply = await applyCards([{
        id: target?.id || 'q',
        text,
        candidate_tags: candidates.map(c => ({ id: c.tag.id, name: c.tag.name })),
      }]);
      verdicts = apply?.verdicts?.[0]?.tags || [];
      applyMs = apply?.ms || 0;
      applyUsage = apply?.usage || null;
      // Annotate perTag with AI verdict for the logger
      for (const v of verdicts) {
        const p = perTag.find(p => p.tagId === v.tag_id);
        if (p) p.aiConfidence = v.confidence;
      }
    }

    // 5. Emit instrumentation.
    logDecision({
      input: text,
      target,
      perTag,
      verdicts,
      embedMs,
      applyMs,
      embedUsage,
      applyUsage,
    });

    // 6. Convert to the legacy suggestion shape, filtering already-applied
    //    tags so we don't generate noisy 23505 inserts on the caller side.
    const out = [];
    for (const s of silentApply) {
      if (alreadyApplied.has(s.tag_id)) continue;
      out.push({ tagId: s.tag_id, score: 1.0, reason: 'embedding-near' });
    }
    for (const v of verdicts) {
      if (alreadyApplied.has(v.tag_id)) continue;
      if (v.confidence === 'high') {
        out.push({ tagId: v.tag_id, score: 1.0, reason: 'ai-high' });
      } else if (v.confidence === 'medium') {
        // Below CanvasSurface's HIGH=0.5 gate, so this won't silent-apply.
        // The sidebar suggested-tags panel can pick it up as a chip.
        out.push({ tagId: v.tag_id, score: 0.4, reason: 'ai-medium' });
      }
      // 'low' → dropped silently.
    }

    // 7. If this card got no high-confidence applies, it's a discovery
    //    candidate — schedule a workspace-wide cluster pass. Debounced
    //    so a burst of orphan edits collapses to one pass.
    if (target?.kind === 'card') {
      const gotHigh = out.some(s => s.score >= 1.0);
      if (!gotHigh) scheduleDiscovery();
    }

    return out;
  }, [ready, workspaceId, ensureCentroid, scheduleDiscovery]);

  return { ready, suggestTags };
}
