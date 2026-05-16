// AI-driven word-level tag cascade for a doc page.
//
// Goal: when a paragraph contains words that semantically evoke a tag,
// surface those WORDS as the tagged span — not the whole sentence or
// paragraph. The AI is responsible for:
//   1. Identifying which words in the paragraph trigger which tag.
//   2. Verdicting whether the context supports applying the tag.
// The client just persists what the AI returns and renders the dots
// and word tints.
//
// Storage: each apply writes an entity_links row with
//   source_anchor = { pHash, startOffset: wordStart, length: wordLen }
// where pHash is the FNV-1a content hash of the paragraph the word
// lives in. Offsets are paragraph-relative so renderers can re-locate
// the word as the user edits text around it.

import { supabase } from './supabase.js';
import { applyCards, embedCards, parsePgvector } from './tagsClient.js';
import { tagDocRange } from './tagsApi.js';
import { isDebug } from './aiTaggerLog.js';
import { cosineDist, NO_MATCH_DIST } from './clusterMath.js';

// Verdict cache: skip the /apply round-trip when we've already
// scored a (paragraph, tag) pair for this content. Keyed by
// `${pHash}::${tagId}`. Value is the full set of word annotations
// the AI returned (so we re-emit identical rows without a refetch).
//   Map<key, Array<{ startOffset, length, confidence }>>
const paragraphVerdictCache = new Map();

// `${pageId}` → Set<applyKey> of rows we've written this session.
// Used to diff against the next save: only insert NEW keys, delete
// keys that disappeared.
const lastAppliedKeysRef = new Map();

function buildApplyKey(pageId, pHash, tagId, startOffset, length) {
  return `${pageId}|${pHash}|${tagId}|${startOffset}|${length}`;
}

export async function runParagraphCascade({
  workspaceId,
  docCardId,
  boardId,
  pageId,
  paragraphs,                  // [{ pHash, text }]
  tagCentroids,                // Map<tagId, { vector, name, color }>
  trie,                        // unused; kept in signature for caller compat
}) {
  if (!supabase || !workspaceId || !docCardId || !pageId) return { applied: 0 };
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    await wipePageRangeRows({ docCardId, pageId });
    lastAppliedKeysRef.set(pageId, new Set());
    return { applied: 0 };
  }

  // Workspace tags as candidates. ALL of them — the AI decides which
  // (if any) apply to each paragraph. No client-side prefilter, since
  // the user wants the model to spot semantically-related words even
  // if they don't appear in the tag's name.
  const candidateTags = [];
  for (const [tagId, t] of tagCentroids.entries()) {
    if (!t?.name) continue;
    const entry = { id: tagId, name: t.name };
    if (t.description) entry.description = t.description;
    candidateTags.push(entry);
  }
  if (candidateTags.length === 0) {
    lastAppliedKeysRef.set(pageId, new Set());
    return { applied: 0 };
  }

  // 1. Partition paragraphs into "already-cached" vs "needs /apply call."
  const needCalls = []; // [{ p }]
  const tierResults = []; // [{ pHash, startOffset, length, tagId, attribution }]
  for (const p of paragraphs) {
    let allCached = true;
    for (const t of candidateTags) {
      const cacheKey = `${p.pHash}::${t.id}`;
      if (!paragraphVerdictCache.has(cacheKey)) { allCached = false; break; }
    }
    if (allCached) {
      // Emit rows from cached verdicts.
      for (const t of candidateTags) {
        const words = paragraphVerdictCache.get(`${p.pHash}::${t.id}`) || [];
        for (const w of words) {
          tierResults.push({
            pHash: p.pHash,
            startOffset: w.startOffset,
            length: w.length,
            tagId: t.id,
            attribution: 'auto-word',
          });
        }
      }
    } else {
      needCalls.push({ p });
    }
  }

  // 2. Embedding pre-filter. Embed each uncached paragraph and drop
  //    candidate tags whose centroid is too far (cosine > NO_MATCH_DIST)
  //    BEFORE the gpt-4o call. Without this, every workspace tag is a
  //    candidate for every paragraph, so the model gets dozens of
  //    chances per paragraph to misfire on a brand-name tag (e.g.
  //    "Clusters logo" applied to a paragraph about networking events).
  //    Tags with no centroid yet (cold start) skip the filter.
  const paraEmbeddingByHash = new Map();
  if (needCalls.length > 0) {
    try {
      const r = await embedCards(needCalls.map(c => ({ id: c.p.pHash, text: c.p.text })));
      for (const e of (r?.embeddings || [])) {
        if (e?.id && Array.isArray(e.vector)) paraEmbeddingByHash.set(e.id, e.vector);
      }
    } catch (e) {
      console.warn('[paragraph-cascade] embed pre-filter failed; falling back to full tag list', e?.message || e);
    }
  }
  const candidatesForParagraph = (pHash) => {
    const emb = paraEmbeddingByHash.get(pHash);
    if (!emb) return candidateTags; // no embedding → don't filter
    const out = [];
    for (const t of candidateTags) {
      const cent = tagCentroids.get(t.id)?.vector;
      // Cold-start (no centroid yet) → keep; otherwise drop if too far.
      if (!cent) { out.push(t); continue; }
      const d = cosineDist(emb, cent);
      if (d <= NO_MATCH_DIST) out.push(t);
    }
    return out;
  };

  // 3. Batched /apply for uncached paragraphs. Each "card" is one
  //    paragraph + the (now-filtered) candidate tag list.
  if (needCalls.length > 0) {
    const BATCH = 4; // paragraphs per /apply call (each carries the full tag list — keep batches small)
    for (let i = 0; i < needCalls.length; i += BATCH) {
      const slice = needCalls.slice(i, i + BATCH);
      // Per-paragraph filtered candidate list; remember which tags were
      // filtered out so we can cache them as "no words" below and skip
      // refetching next save.
      const filteredByHash = new Map();
      for (const c of slice) filteredByHash.set(c.p.pHash, candidatesForParagraph(c.p.pHash));
      const cards = slice
        .map(c => ({
          id: c.p.pHash,
          text: c.p.text,
          candidate_tags: filteredByHash.get(c.p.pHash) || candidateTags,
        }))
        .filter(card => card.candidate_tags.length > 0);
      // For paragraphs whose entire candidate list was filtered out,
      // still cache empty verdicts so we don't refetch next save.
      for (const c of slice) {
        const cands = filteredByHash.get(c.p.pHash) || candidateTags;
        if (cands.length === 0) {
          for (const t of candidateTags) {
            paragraphVerdictCache.set(`${c.p.pHash}::${t.id}`, []);
          }
        }
      }
      if (cards.length === 0) continue;
      let verdicts = [];
      try {
        const resp = await applyCards(cards);
        verdicts = resp?.verdicts || [];
        // Inspect the model's raw output so we can see when it's
        // returning low everywhere vs returning empty-words on a
        // high/medium (the latter would mean the prompt fix didn't
        // take effect).
        if (isDebug()) console.info('[paragraph-cascade] verdicts:', JSON.stringify(verdicts).slice(0, 1200));
      } catch (e) {
        console.warn('[paragraph-cascade] /apply failed', e?.message || e);
        continue;
      }
      const byCardId = new Map(verdicts.map(v => [v.card_id, v]));
      for (const c of slice) {
        const v = byCardId.get(c.p.pHash);
        // Default to "no tags" if the model didn't return a verdict.
        const tags = v?.tags || [];
        // Initialize every candidate tag's cache entry — even empty —
        // so we don't re-fetch next save.
        for (const t of candidateTags) {
          paragraphVerdictCache.set(`${c.p.pHash}::${t.id}`, []);
        }
        for (const ta of tags) {
          if (ta.confidence === 'low') continue;
          const words = Array.isArray(ta.words) ? ta.words : [];
          const validWords = [];
          for (const w of words) {
            const claimed = String(w.text || '').trim();
            if (!claimed) continue;
            // Don't trust the AI's start_offset — it's frequently off
            // by a character or two. Use it as a HINT: regex-find every
            // occurrence of the claimed word, then pick the one closest
            // to the AI's guess.
            const aiStart = Number(w.start_offset);
            const escaped = claimed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(escaped, 'gi');
            let bestStart = -1;
            let bestLen = 0;
            let bestDist = Infinity;
            let m;
            while ((m = re.exec(c.p.text)) !== null) {
              const dist = Number.isFinite(aiStart) ? Math.abs(m.index - aiStart) : 0;
              if (dist < bestDist) {
                bestDist = dist;
                bestStart = m.index;
                bestLen = m[0].length;
              }
              if (m[0].length === 0) re.lastIndex++;
            }
            if (bestStart < 0) continue;
            validWords.push({ startOffset: bestStart, length: bestLen, confidence: ta.confidence });
            const contextText = buildContextSnippet(c.p.text, bestStart, bestStart + bestLen);
            tierResults.push({
              pHash: c.p.pHash,
              startOffset: bestStart,
              length: bestLen,
              tagId: ta.tag_id,
              attribution: ta.confidence === 'high' ? 'auto-word' : 'auto-word-medium',
              contextText,
            });
          }
          paragraphVerdictCache.set(`${c.p.pHash}::${ta.tag_id}`, validWords);
        }
      }
    }
  }

  // 3. Dedupe (same word might be returned twice across calls in
  //    edge cases).
  const dedup = new Map();
  for (const e of tierResults) {
    const k = buildApplyKey(pageId, e.pHash, e.tagId, e.startOffset, e.length);
    if (!dedup.has(k)) dedup.set(k, e);
  }
  const finalResults = [...dedup.values()];

  // 4. Diff against last save.
  const currentKeys = new Set(finalResults.map(e =>
    buildApplyKey(pageId, e.pHash, e.tagId, e.startOffset, e.length)
  ));
  const prevKeys = lastAppliedKeysRef.get(pageId) || new Set();
  const toAdd = [...currentKeys].filter(k => !prevKeys.has(k));
  const toRemove = [...prevKeys].filter(k => !currentKeys.has(k));

  // 5. Insert new rows.
  const successKeys = new Set();
  await Promise.allSettled(finalResults.filter(e =>
    toAdd.includes(buildApplyKey(pageId, e.pHash, e.tagId, e.startOffset, e.length))
  ).map(async e => {
    try {
      await tagDocRange({
        workspaceId,
        docCardId,
        pageId,
        boardId,
        tagId: e.tagId,
        source: e.attribution,
        sourceAnchor: { pHash: e.pHash, startOffset: e.startOffset, length: e.length },
        contextText: e.contextText || null,
      });
      successKeys.add(buildApplyKey(pageId, e.pHash, e.tagId, e.startOffset, e.length));
    } catch (err) {
      console.warn('[paragraph-cascade] insert failed', err?.message || err);
    }
  }));

  // 6. Delete rows for keys that disappeared.
  for (const k of toRemove) {
    const [, pHash, tagId, startOffsetStr, lengthStr] = k.split('|');
    await supabase.from('entity_links').delete()
      .eq('source_kind', 'doc')
      .eq('source_id', docCardId)
      .eq('source_page_id', pageId)
      .eq('target_kind', 'tag')
      .eq('target_id', tagId)
      .eq('link_kind', 'applied')
      .eq('source_anchor->>pHash', pHash)
      .eq('source_anchor->>startOffset', startOffsetStr)
      .eq('source_anchor->>length', lengthStr)
      .then(({ error }) => { if (error) console.warn('[paragraph-cascade] delete stale', error.message); });
  }

  // Carry only keys that successfully landed.
  const carry = new Set();
  for (const k of currentKeys) {
    if (prevKeys.has(k)) carry.add(k);
    else if (successKeys.has(k)) carry.add(k);
  }
  lastAppliedKeysRef.set(pageId, carry);

  // 7. Stale GC: drop range rows whose pHash isn't in the current
  //    paragraph set (paragraph text edited / paragraph deleted).
  const currentHashes = new Set(paragraphs.map(p => p.pHash));
  try {
    const { data: existing } = await supabase.from('entity_links')
      .select('id, source_anchor')
      .eq('source_kind', 'doc')
      .eq('source_id', docCardId)
      .eq('source_page_id', pageId)
      .eq('target_kind', 'tag')
      .eq('link_kind', 'applied')
      .not('source_anchor', 'is', null);
    const orphans = (existing || []).filter(r => {
      const h = r?.source_anchor?.pHash;
      return h && !currentHashes.has(h);
    }).map(r => r.id);
    if (orphans.length > 0) {
      await supabase.from('entity_links').delete().in('id', orphans);
      if (isDebug()) console.info(`[paragraph-cascade] GC removed ${orphans.length} orphan range row${orphans.length === 1 ? '' : 's'}`);
    }
  } catch (e) { console.warn('[paragraph-cascade] GC failed', e?.message || e); }

  try {
    console.info(`[paragraph-cascade] page ${pageId.slice(0, 8)} → ${paragraphs.length} paragraph${paragraphs.length === 1 ? '' : 's'}, ${finalResults.length} word${finalResults.length === 1 ? '' : 's'} (added: ${toAdd.length}, removed: ${toRemove.length})`);
  } catch (_) {}
  return { applied: finalResults.length, added: toAdd.length, removed: toRemove.length };
}

// Build a short snippet of `text` around the [start,end) range, with
// ellipsis when truncated. Used as context_text on the entity_links
// row so the tag detail view can show the surrounding sentence.
function buildContextSnippet(text, start, end) {
  const PAD = 60;
  let s = Math.max(0, start - PAD);
  let e = Math.min(text.length, end + PAD);
  // Trim leading partial word.
  if (s > 0) {
    const ws = text.slice(s, start).search(/\s/);
    if (ws >= 0 && ws < 25) s = s + ws + 1;
  }
  if (e < text.length) {
    const tail = text.slice(end, e);
    const lastWs = tail.lastIndexOf(' ');
    if (lastWs > 0 && (tail.length - lastWs) < 25) e = end + lastWs;
  }
  let snippet = text.slice(s, e).replace(/\s+/g, ' ').trim();
  if (!snippet) return '';
  if (s > 0) snippet = '…' + snippet;
  if (e < text.length) snippet = snippet + '…';
  return snippet.slice(0, 200);
}

async function wipePageRangeRows({ docCardId, pageId }) {
  await supabase.from('entity_links').delete()
    .eq('source_kind', 'doc')
    .eq('source_id', docCardId)
    .eq('source_page_id', pageId)
    .eq('target_kind', 'tag')
    .eq('link_kind', 'applied')
    .not('source_anchor', 'is', null)
    .then(({ error }) => { if (error) console.warn('[paragraph-cascade] wipe page', error.message); });
}

// Fetch workspace tags. tag_centroids is a nice-to-have for caching;
// fall back to the raw tags table when centroids aren't there yet.
export async function loadWorkspaceTagCentroids(workspaceId) {
  if (!supabase || !workspaceId) return new Map();
  // Tags + their AI descriptions + their embedding centroids (when
  // present). The centroid is what we use to filter unrelated tags
  // out of the apply-call candidate list — tags whose centroid is
  // > NO_MATCH_DIST from a paragraph never get evaluated. Tags
  // without a centroid yet (cold start) skip the filter.
  const [tagsRes, centroidsRes] = await Promise.all([
    supabase.from('tags').select('id, name, color, description').eq('workspace_id', workspaceId),
    supabase.from('tag_centroids').select('tag_id, centroid').eq('workspace_id', workspaceId),
  ]);
  if (tagsRes.error) {
    console.warn('[paragraph-cascade] tag load', tagsRes.error.message);
    return new Map();
  }
  if (centroidsRes.error) {
    // Non-fatal — just means we skip the embedding pre-filter.
    console.warn('[paragraph-cascade] centroid load', centroidsRes.error.message);
  }
  const centroidById = new Map();
  for (const r of (centroidsRes.data || [])) {
    const v = parsePgvector(r.centroid);
    if (v) centroidById.set(r.tag_id, v);
  }
  const out = new Map();
  for (const t of (tagsRes.data || [])) {
    out.set(t.id, {
      vector: centroidById.get(t.id) || null,
      name: t.name,
      color: t.color,
      description: t.description || null,
    });
  }
  return out;
}
