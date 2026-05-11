// Three-tier per-edit cascade that applies tags to ranges INSIDE a
// doc page based on semantic match + entity-name presence.
//
// Tier 1 — paragraph: paragraph embedding close to tag centroid →
//   apply with span = full paragraph.
// Tier 2 — sentence:  paragraph didn't match at tier 1 but contains a
//   trie name-match for a tag → /apply on just the sentence around
//   the match; 'high' → apply with span = that sentence.
// Tier 3 — word + context: tier-2 sentence returned 'medium' but the
//   user clearly mentioned the tag's name → mark a tight window
//   around the word (matched range + ~3 words each side).
//
// Storage: each apply writes entity_links with source_anchor =
//   { pHash, startOffset, length }. The renderer (TagRangePlugin)
//   re-resolves pHash → current paragraph position on every doc
//   change, so the underline stays attached as the user edits.

import { supabase } from './supabase.js';
import { embedCards, applyCards, formatPgvector, parsePgvector } from './tagsClient.js';
import { cosineDist, SILENT_APPLY_DIST, NO_MATCH_DIST } from './clusterMath.js';
import { splitSentences, wordContextSpan } from './sentenceSpan.js';
import { tagDocRange } from './tagsApi.js';

// In-memory caches scoped to the module so repeated saves of the same
// page (the common case while editing) skip embed + AI calls.
const paragraphEmbedCache = new Map(); // pHash → Float32Array vector
const tier1VerdictCache = new Map();   // `${pHash}::${tagId}` → 'high'|'medium'|'low'
const tier2VerdictCache = new Map();   // `${pHash}::${sentenceOffset}::${tagId}` → verdict
const lastAppliedKeysRef = new Map();  // `${pageId}` → Set<applyKey>

// Diff helpers: which entity_links source_anchor rows were last
// emitted for this page. So we can DELETE the rows that no longer
// match (e.g. paragraph was edited or deleted).
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
  trie,
}) {
  if (!supabase || !workspaceId || !docCardId || !pageId) return { applied: 0 };
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    // No paragraphs → clean up any prior range rows for this page.
    await wipePageRangeRows({ docCardId, pageId });
    lastAppliedKeysRef.set(pageId, new Set());
    return { applied: 0 };
  }

  // 1. Ensure every paragraph is embedded. Batch the missing ones.
  const missing = paragraphs.filter(p => !paragraphEmbedCache.has(p.pHash));
  if (missing.length > 0) {
    // Also seed any embeddings already in the DB so we don't re-embed.
    const cardIds = missing.map(p => `${pageId}#${p.pHash}`);
    const { data: existing } = await supabase
      .from('card_embeddings')
      .select('card_id, embedding')
      .eq('workspace_id', workspaceId)
      .eq('entity_kind', 'doc-paragraph')
      .in('card_id', cardIds);
    const haveByHash = new Map();
    for (const r of (existing || [])) {
      const h = (r.card_id || '').split('#')[1];
      if (!h) continue;
      const vec = parsePgvector(r.embedding);
      if (vec) { haveByHash.set(h, vec); paragraphEmbedCache.set(h, vec); }
    }
    const stillMissing = missing.filter(p => !haveByHash.has(p.pHash));
    if (stillMissing.length > 0) {
      const resp = await embedCards(stillMissing.map(p => ({
        id: p.pHash,
        text: p.text,
      })));
      const vectorsByHash = new Map();
      for (const e of (resp?.embeddings || [])) {
        if (!e.id || !e.vector) continue;
        vectorsByHash.set(e.id, e.vector);
        paragraphEmbedCache.set(e.id, e.vector);
      }
      // Persist for cross-session reuse.
      const rowsToUpsert = stillMissing
        .map(p => ({ p, v: vectorsByHash.get(p.pHash) }))
        .filter(x => x.v)
        .map(x => ({
          card_id: `${pageId}#${x.p.pHash}`,
          entity_kind: 'doc-paragraph',
          workspace_id: workspaceId,
          board_id: boardId || null,
          doc_card_id: docCardId,
          content_hash: x.p.pHash,
          embedding: formatPgvector(x.v),
        }));
      if (rowsToUpsert.length > 0) {
        await supabase
          .from('card_embeddings')
          .upsert(rowsToUpsert, { onConflict: 'entity_kind,card_id' })
          .then(({ error }) => { if (error) console.warn('[paragraph-cascade] embedding upsert', error.message); });
      }
    }
  }

  // 2. Tier-1 partition: which paragraphs match which tags semantically.
  const tierResults = [];   // entries we plan to write: { pHash, startOffset, length, tagId, attribution }
  const tier1MatchedByPara = new Map();  // pHash → Set<tagId> matched at paragraph level (suppresses tier 2/3)

  const tier1SilentApplies = [];
  const tier1AICandidates = [];  // [{ paragraph, tagId, tagName }]

  for (const p of paragraphs) {
    const vec = paragraphEmbedCache.get(p.pHash);
    if (!vec) continue;
    for (const [tagId, t] of tagCentroids.entries()) {
      if (!t?.vector) continue;
      const key = `${p.pHash}::${tagId}`;
      let verdict = tier1VerdictCache.get(key);
      if (!verdict) {
        const d = cosineDist(vec, t.vector);
        if (d < SILENT_APPLY_DIST) verdict = 'high';
        else if (d < NO_MATCH_DIST) verdict = 'middle';
        else verdict = 'low';
        if (verdict !== 'middle') tier1VerdictCache.set(key, verdict);
      }
      if (verdict === 'high') {
        tier1SilentApplies.push({ p, tagId, attribution: 'auto-paragraph' });
      } else if (verdict === 'middle') {
        tier1AICandidates.push({ p, tagId, tagName: t.name });
      }
    }
  }

  // Resolve middle-band tier-1 candidates via /apply in parallel batches.
  if (tier1AICandidates.length > 0) {
    const batches = [];
    for (let i = 0; i < tier1AICandidates.length; i += 8) {
      const slice = tier1AICandidates.slice(i, i + 8);
      batches.push({
        slice,
        cards: slice.map(c => ({
          id: `${c.p.pHash}|${c.tagId}`,
          text: c.p.text,
          candidate_tags: [{ id: c.tagId, name: c.tagName || '' }],
        })),
      });
    }
    const results = await Promise.allSettled(batches.map(b => applyCards(b.cards)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const slice = batches[i].slice;
      const verdicts = r.status === 'fulfilled' ? (r.value?.verdicts || []) : [];
      const byId = new Map(slice.map((c, idx) => [`${c.p.pHash}|${c.tagId}`, idx]));
      for (const v of verdicts) {
        const idx = byId.get(v.card_id);
        if (idx == null) continue;
        const c = slice[idx];
        const conf = (v.tags || [])[0]?.confidence || 'low';
        tier1VerdictCache.set(`${c.p.pHash}::${c.tagId}`, conf);
        if (conf === 'high') {
          tier1SilentApplies.push({ p: c.p, tagId: c.tagId, attribution: 'auto-paragraph' });
        }
      }
    }
  }

  // Stage tier-1 entries.
  for (const e of tier1SilentApplies) {
    if (!tier1MatchedByPara.has(e.p.pHash)) tier1MatchedByPara.set(e.p.pHash, new Set());
    tier1MatchedByPara.get(e.p.pHash).add(e.tagId);
    tierResults.push({
      pHash: e.p.pHash,
      startOffset: 0,
      length: e.p.text.length,
      tagId: e.tagId,
      attribution: e.attribution,
    });
  }

  // 3. Tier 2 + 3: for paragraphs that did NOT match a tag at tier 1
  //    but contain a meaningful word from a tag's name, run sentence-
  //    level apply. We match on WORDS, not the whole tag phrase, so
  //    "pricing" in body text triggers the Pricing Plans tag check
  //    even though the literal phrase doesn't appear.
  //
  // Pre-build a per-tag word matcher from the centroid map.
  const tagWordMatchers = buildTagWordMatchers(tagCentroids);
  if (tagWordMatchers.length > 0) {
    for (const p of paragraphs) {
      const matchedTagsForPara = tier1MatchedByPara.get(p.pHash) || new Set();
      const matchesByTag = new Map(); // tagId → [{ start, end, name }]
      for (const tm of tagWordMatchers) {
        if (matchedTagsForPara.has(tm.tagId)) continue;
        for (const re of tm.regexes) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(p.text)) !== null) {
            if (!matchesByTag.has(tm.tagId)) matchesByTag.set(tm.tagId, []);
            matchesByTag.get(tm.tagId).push({
              start: m.index,
              end: m.index + m[0].length,
              name: tm.tagName,
            });
            // Safety: bail on zero-width matches that would loop forever.
            if (m[0].length === 0) re.lastIndex++;
          }
        }
      }
      if (matchesByTag.size === 0) continue;

      // Split into sentences. For each (tagId, match), find the sentence
      // containing the match, then call /apply on the sentence.
      const sentences = splitSentences(p.text);
      // Build paragraph-relative -> sentence map for fast lookup.
      const findSentenceFor = (offset) => {
        for (const s of sentences) {
          if (offset >= s.startOffset && offset < s.startOffset + s.length) return s;
        }
        return null;
      };

      // Collect tier-2 candidates (cache-aware).
      const tier2Calls = [];   // [{ p, tagId, sentence, tagName, key }]
      for (const [tagId, matches] of matchesByTag.entries()) {
        const tagName = matches[0]?.name || '';
        for (const m of matches) {
          const sentence = findSentenceFor(m.start);
          if (!sentence) continue;
          const key = `${p.pHash}::${sentence.startOffset}::${tagId}`;
          const cached = tier2VerdictCache.get(key);
          if (cached === 'high') {
            tierResults.push({
              pHash: p.pHash,
              startOffset: sentence.startOffset,
              length: sentence.length,
              keywordOffset: m.start,
              keywordLength: m.end - m.start,
              tagId,
              attribution: 'auto-sentence',
            });
          } else if (cached === 'medium') {
            const span = wordContextSpan(p.text, m.start, m.end);
            tierResults.push({
              pHash: p.pHash,
              startOffset: span.startOffset,
              length: span.length,
              keywordOffset: m.start,
              keywordLength: m.end - m.start,
              tagId,
              attribution: 'auto-word',
            });
          } else if (!cached) {
            tier2Calls.push({ p, tagId, tagName, match: m, sentence, key });
          }
          // 'low' → drop silently.
        }
      }

      if (tier2Calls.length === 0) continue;

      const batches = [];
      for (let i = 0; i < tier2Calls.length; i += 8) {
        const slice = tier2Calls.slice(i, i + 8);
        batches.push({
          slice,
          cards: slice.map((c, idx) => ({
            id: `${idx}|${c.p.pHash}|${c.tagId}|${c.sentence.startOffset}`,
            text: c.sentence.text,
            candidate_tags: [{ id: c.tagId, name: c.tagName }],
          })),
        });
      }
      const results = await Promise.allSettled(batches.map(b => applyCards(b.cards)));
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const slice = batches[i].slice;
        const verdicts = r.status === 'fulfilled' ? (r.value?.verdicts || []) : [];
        const byCardId = new Map(verdicts.map(v => [v.card_id, v]));
        for (let j = 0; j < slice.length; j++) {
          const c = slice[j];
          const v = byCardId.get(`${j}|${c.p.pHash}|${c.tagId}|${c.sentence.startOffset}`);
          const conf = (v?.tags || [])[0]?.confidence || 'low';
          tier2VerdictCache.set(c.key, conf);
          if (conf === 'high') {
            tierResults.push({
              pHash: c.p.pHash,
              startOffset: c.sentence.startOffset,
              length: c.sentence.length,
              keywordOffset: c.match.start,
              keywordLength: c.match.end - c.match.start,
              tagId: c.tagId,
              attribution: 'auto-sentence',
            });
          } else if (conf === 'medium') {
            const span = wordContextSpan(c.p.text, c.match.start, c.match.end);
            tierResults.push({
              pHash: c.p.pHash,
              startOffset: span.startOffset,
              length: span.length,
              keywordOffset: c.match.start,
              keywordLength: c.match.end - c.match.start,
              tagId: c.tagId,
              attribution: 'auto-word',
            });
          }
        }
      }
    }
  }

  // 4. Diff vs last-applied keys; insert new, delete missing.
  const currentKeys = new Set();
  for (const e of tierResults) {
    currentKeys.add(buildApplyKey(pageId, e.pHash, e.tagId, e.startOffset, e.length));
  }
  const prevKeys = lastAppliedKeysRef.get(pageId) || new Set();
  const toAdd = [...currentKeys].filter(k => !prevKeys.has(k));
  const toRemove = [...prevKeys].filter(k => !currentKeys.has(k));

  // Insert new range rows. Track which keys ACTUALLY landed so that
  // a failed insert (network glitch, transient RLS error) gets retried
  // on the next cascade fire instead of being marked applied.
  const successKeys = new Set();
  await Promise.allSettled(tierResults.filter(e =>
    toAdd.includes(buildApplyKey(pageId, e.pHash, e.tagId, e.startOffset, e.length))
  ).map(async e => {
    try {
      // Only the word-tier rows carry keyword fields. Tier-1
      // (paragraph) applies omit them so the renderer skips the
      // inline tint and renders the margin dot only.
      const anchor = { pHash: e.pHash, startOffset: e.startOffset, length: e.length };
      if (typeof e.keywordOffset === 'number' && typeof e.keywordLength === 'number') {
        anchor.keywordOffset = e.keywordOffset;
        anchor.keywordLength = e.keywordLength;
      }
      await tagDocRange({
        workspaceId,
        docCardId,
        pageId,
        boardId,
        tagId: e.tagId,
        source: e.attribution,
        sourceAnchor: anchor,
      });
      successKeys.add(buildApplyKey(pageId, e.pHash, e.tagId, e.startOffset, e.length));
    } catch (err) {
      console.warn('[paragraph-cascade] insert failed', err?.message || err);
    }
  }));

  // Delete stale range rows. Match by source_anchor jsonb fields.
  for (const k of toRemove) {
    const [, pHash, tagId, startOffset, length] = k.split('|');
    await supabase.from('entity_links').delete()
      .eq('source_kind', 'doc')
      .eq('source_id', docCardId)
      .eq('source_page_id', pageId)
      .eq('target_kind', 'tag')
      .eq('target_id', tagId)
      .eq('link_kind', 'applied')
      .eq('source_anchor->>pHash', pHash)
      .eq('source_anchor->>startOffset', startOffset)
      .eq('source_anchor->>length', length)
      .then(({ error }) => { if (error) console.warn('[paragraph-cascade] delete stale', error.message); });
  }

  // Only carry forward keys whose insert actually succeeded, plus
  // pre-existing keys (those already in prevKeys, not in toAdd) that
  // we kept. Failed inserts stay out of the set so a future cascade
  // retries them.
  const carry = new Set();
  for (const k of currentKeys) {
    if (prevKeys.has(k)) carry.add(k);
    else if (successKeys.has(k)) carry.add(k);
  }
  lastAppliedKeysRef.set(pageId, carry);
  // Dev log so it's easy to verify the cascade is actually firing in
  // the user's console — silent in prod once we trust it.
  try {
    console.info(`[paragraph-cascade] page ${pageId.slice(0, 8)} → ${paragraphs.length} paragraph${paragraphs.length === 1 ? '' : 's'}, ${tierResults.length} range${tierResults.length === 1 ? '' : 's'} (added: ${toAdd.length}, removed: ${toRemove.length})`);
  } catch (_) {}
  return { applied: tierResults.length, added: toAdd.length, removed: toRemove.length };
}

// Build `[{ tagId, tagName, regexes: [RegExp] }]` for word-level
// matching. Tag "Pricing Plans" → regexes match `\bpricing\b` and
// `\bplans\b` so either word in body text counts as a candidate
// trigger for tier-2 sentence /apply. Stopwords + tokens shorter
// than 4 chars filtered to avoid matching every "for" / "the".
const STOPWORDS = new Set([
  'the','and','for','with','from','that','this','will','your','our',
  'into','onto','over','about','also','some','more','than','then',
  'when','what','where','which','have','has','had','are','was','were',
  'you','they','them','their','its','it','an','a','of','in','on','at',
  'to','as','is','be','or','if','so','do','no','yes',
]);
function buildTagWordMatchers(tagCentroids) {
  const out = [];
  for (const [tagId, t] of tagCentroids.entries()) {
    const name = t?.name || '';
    if (!name) continue;
    const words = name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4 && !STOPWORDS.has(w));
    if (words.length === 0) continue;
    const regexes = words.map(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
    out.push({ tagId, tagName: name, regexes });
  }
  return out;
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

// Fetch tag centroids once per workspace; the caller caches the
// returned Map and only re-fetches on workspace switch.
export async function loadWorkspaceTagCentroids(workspaceId) {
  if (!supabase || !workspaceId) return new Map();
  const { data: centroids, error: cerr } = await supabase
    .from('tag_centroids')
    .select('tag_id, centroid')
    .eq('workspace_id', workspaceId);
  if (cerr) { console.warn('[paragraph-cascade] centroid load', cerr.message); return new Map(); }
  const ids = (centroids || []).map(c => c.tag_id).filter(Boolean);
  if (ids.length === 0) return new Map();
  const { data: tags } = await supabase
    .from('tags')
    .select('id, name, color')
    .in('id', ids);
  const meta = new Map((tags || []).map(t => [t.id, t]));
  const out = new Map();
  for (const c of centroids) {
    const vec = parsePgvector(c.centroid);
    const t = meta.get(c.tag_id);
    if (!vec || !t) continue;
    out.set(c.tag_id, { vector: vec, name: t.name, color: t.color });
  }
  return out;
}
