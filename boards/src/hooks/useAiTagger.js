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
  SILENT_APPLY_DIST,
  NO_MATCH_DIST,
} from '../lib/clusterMath.js';
import { logDecision, recordCall } from '../lib/aiTaggerLog.js';

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

  // Load tags + any persisted centroids on workspace change.
  useEffect(() => {
    if (!workspaceId || !supabase) { setReady(false); return; }
    let cancelled = false;
    setReady(false);
    async function load() {
      const [tagsResp, centroidsResp] = await Promise.all([
        supabase.from('tags')
          .select('id, name, slug, color')
          .eq('workspace_id', workspaceId),
        supabase.from('tag_centroids')
          .select('tag_id, centroid')
          .eq('workspace_id', workspaceId),
      ]);
      if (cancelled) return;
      tagsRef.current = tagsResp.data || [];
      centroidsRef.current.clear();
      centroidPromisesRef.current.clear();
      for (const r of (centroidsResp.data || [])) {
        const v = parsePgvector(r.centroid);
        if (v) centroidsRef.current.set(r.tag_id, v);
      }
      setReady(true);
    }
    load().catch(err => console.warn('[ai-tagger] hydrate failed', err));
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Subscribe to tag definition changes so renames / new tags / deletes
  // land in tagsRef without a page reload. Centroid recomputation on
  // rename is deferred — Phase 1.5.
  useEffect(() => {
    if (!workspaceId || !supabase || !ready) return;
    const chId = `ai-tagger-tags-${workspaceId}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase.channel(chId)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'tags', filter: `workspace_id=eq.${workspaceId}` },
          async () => {
            const { data } = await supabase.from('tags')
              .select('id, name, slug, color')
              .eq('workspace_id', workspaceId);
            tagsRef.current = data || [];
            // Drop any centroid for a tag that no longer exists.
            const validIds = new Set(tagsRef.current.map(t => t.id));
            for (const id of [...centroidsRef.current.keys()]) {
              if (!validIds.has(id)) centroidsRef.current.delete(id);
            }
          });
    ch.subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [workspaceId, ready]);

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

  const suggestTags = useCallback(async (content, target) => {
    if (!ready || !workspaceId || !supabase) return [];
    const text = String(content || '').trim();
    if (!text) return [];
    const tags = tagsRef.current;
    if (!tags.length) return [];

    // 1. Embed the query.
    const queryResult = await embedOne(target?.id || 'q', text);
    if (!queryResult?.vector) return [];
    const queryVec = queryResult.vector;
    const embedMs = queryResult.ms;
    const embedUsage = queryResult.usage;

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

    // 6. Convert to the legacy suggestion shape.
    const out = [];
    for (const s of silentApply) {
      out.push({ tagId: s.tag_id, score: 1.0, reason: 'embedding-near' });
    }
    for (const v of verdicts) {
      if (v.confidence === 'high') {
        out.push({ tagId: v.tag_id, score: 1.0, reason: 'ai-high' });
      } else if (v.confidence === 'medium') {
        // Below CanvasSurface's HIGH=0.5 gate, so this won't silent-apply.
        // The sidebar suggested-tags panel can pick it up as a chip.
        out.push({ tagId: v.tag_id, score: 0.4, reason: 'ai-medium' });
      }
      // 'low' → dropped silently.
    }
    return out;
  }, [ready, workspaceId, ensureCentroid]);

  return { ready, suggestTags };
}
