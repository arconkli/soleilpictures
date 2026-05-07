// Pure scoring engine for the homegrown autotagger.
//
// Given (a) the workspace's existing tags, (b) the training corpus
// (each tag → the union of text from things tagged with it), and
// (c) a piece of new content, return a ranked list of suggested
// tag ids with confidence scores in [0,1].
//
// Three stacked signals:
//
//   1. Exact name / alias match (very strong)
//        The tag's literal name or one of its aliases appears as a
//        token (or contiguous phrase) in the content.
//   2. TF-IDF cosine similarity (workspace-derived)
//        Term frequencies per tag are learned from prior applied
//        rows. IDF is computed across the per-tag "documents".
//        High scores when the new content has many of the same
//        rare-but-tag-defining tokens.
//   3. Cold-start substring fallback
//        For tags with zero training examples (brand-new tags) we
//        fall back to substring matching on the tag's slug.
//
// The engine has no knowledge of Supabase, web workers, or React.
// It's a single function over plain data — easy to unit test and
// easy to relocate to a server-side runtime later if browser
// memory becomes an issue.

const STOP_WORDS = new Set([
  'a','an','and','any','are','as','at','be','been','being','but','by','can',
  'could','did','do','does','doing','done','for','from','had','has','have',
  'having','he','her','here','hers','him','his','how','i','if','in','into',
  'is','it','its','itself','just','me','more','most','my','myself','no',
  'nor','not','now','of','off','on','once','only','or','other','our','ours',
  'out','over','own','same','she','should','so','some','such','than','that',
  'the','their','theirs','them','themselves','then','there','these','they',
  'this','those','through','to','too','until','up','us','very','was','we',
  'were','what','when','where','which','while','who','whom','why','will',
  'with','would','you','your','yours','yourself','yourselves','about',
]);

// HTML-strip + word-tokenize. Keeps short numeric tokens (Q1, V2),
// drops 1-char letters and pure punctuation. Produces unigrams and
// bigrams.
export function tokenize(input) {
  if (!input) return [];
  const text = String(input)
    .replace(/<[^>]+>/g, ' ')      // strip HTML
    .replace(/&[a-z]+;/gi, ' ')   // strip HTML entities
    .toLowerCase();
  const raw = text.match(/[a-z0-9][a-z0-9_-]*/g) || [];
  const unigrams = [];
  for (const tok of raw) {
    if (tok.length < 2 && !/^\d+$/.test(tok)) continue;
    if (STOP_WORDS.has(tok)) continue;
    unigrams.push(tok);
  }
  const bigrams = [];
  for (let i = 0; i + 1 < unigrams.length; i++) {
    bigrams.push(unigrams[i] + ' ' + unigrams[i + 1]);
  }
  return unigrams.concat(bigrams);
}

// Build per-tag term-frequency maps and a document-frequency map
// from the training corpus.
//
// corpus shape: Array<{ tagId, text }>  — one row per applied link
//
// We aggregate texts per tagId to form "tag documents," because IDF
// across tag documents (rather than per-source-document) reflects
// "how unique is this token to this tag" — exactly what we want.
export function buildIndex(corpus) {
  const tagTexts = new Map();        // tagId -> [text, ...]
  for (const row of (corpus || [])) {
    const arr = tagTexts.get(row.tagId) || [];
    arr.push(row.text || '');
    tagTexts.set(row.tagId, arr);
  }
  const tagTf = new Map();           // tagId -> Map(token, count)
  const docFreq = new Map();         // token -> # of tag-docs containing it
  let totalDocs = 0;
  for (const [tagId, texts] of tagTexts) {
    const tokens = tokenize(texts.join(' '));
    if (tokens.length === 0) continue;
    const tf = new Map();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
    tagTf.set(tagId, tf);
    totalDocs += 1;
    for (const tok of tf.keys()) docFreq.set(tok, (docFreq.get(tok) || 0) + 1);
  }
  return { tagTf, docFreq, totalDocs };
}

// Cosine-like similarity between a content token bag and a tag's
// TF vector, weighted by IDF. We don't bother with proper L2
// normalization because the absolute magnitude is squashed through
// a sigmoid below — relative ordering is what matters.
function tfIdfScore(contentTokens, tagTf, docFreq, totalDocs) {
  if (!tagTf || tagTf.size === 0) return 0;
  let sum = 0;
  let contentNorm = 0;
  let tagNorm = 0;
  // Build a content TF.
  const contentTf = new Map();
  for (const tok of contentTokens) contentTf.set(tok, (contentTf.get(tok) || 0) + 1);
  for (const [tok, cf] of contentTf) {
    const df = docFreq.get(tok) || 0;
    if (df === 0) continue;
    const idf = Math.log(1 + totalDocs / df);
    const tagFreq = tagTf.get(tok) || 0;
    const cw = cf * idf;
    const tw = tagFreq * idf;
    sum += cw * tw;
    contentNorm += cw * cw;
  }
  for (const [tok, freq] of tagTf) {
    const df = docFreq.get(tok) || 0;
    if (df === 0) continue;
    const idf = Math.log(1 + totalDocs / df);
    const tw = freq * idf;
    tagNorm += tw * tw;
  }
  if (sum <= 0 || contentNorm <= 0 || tagNorm <= 0) return 0;
  return sum / (Math.sqrt(contentNorm) * Math.sqrt(tagNorm));
}

// Squash a raw cosine similarity into a 0-1 confidence band that
// hits ~0.5 around cosine 0.15 (typical "this is somewhat relevant"
// signal in our domain). Empirically tuned; tweak with workspace
// thresholds rather than retuning this curve.
function squash(cosine) {
  if (cosine <= 0) return 0;
  return 1 - Math.exp(-cosine * 6);
}

// Main entry point.
//
// Input:
//   tags: [{ id, name, slug, aliases?: string[] }]
//   index: result of buildIndex()
//   content: string (the new card/doc/note text)
//   ignoredTagIds?: Set<string>  (per-target dismissed pairs)
//
// Output:
//   [{ tagId, score, reason }, ...]
//   reason is one of 'exact'|'alias'|'tfidf'|'substring' for UI hints.
export function scoreContent({ tags, index, content, ignoredTagIds }) {
  const out = [];
  const text = String(content || '').trim();
  if (!text) return out;
  const lower = text.toLowerCase();
  const tokens = tokenize(text);
  const tokenSet = new Set(tokens);
  const ignored = ignoredTagIds || new Set();

  for (const tag of (tags || [])) {
    if (!tag || !tag.id) continue;
    if (ignored.has(tag.id)) continue;
    const slug = (tag.slug || tag.name || '').toLowerCase().trim();
    if (!slug) continue;
    let bestScore = 0;
    let bestReason = null;

    // 1. Exact-name token match — the tag's slug appears as a token
    //    or contiguous phrase. This is by far our strongest signal.
    if (tokenSet.has(slug) || lower.includes(slug)) {
      bestScore = 0.95;
      bestReason = 'exact';
    }

    // 2. Alias match — same thing for any alias.
    if (Array.isArray(tag.aliases)) {
      for (const a of tag.aliases) {
        const al = (a || '').toLowerCase().trim();
        if (!al) continue;
        if (tokenSet.has(al) || lower.includes(al)) {
          if (0.9 > bestScore) { bestScore = 0.9; bestReason = 'alias'; }
          break;
        }
      }
    }

    // 3. TF-IDF — rich-context signal. Only meaningful if we have
    //    training data for this tag. Squash to 0..1 so it composes
    //    with the exact/alias scores above.
    const tfIdfRaw = index ? tfIdfScore(
      tokens,
      index.tagTf.get(tag.id),
      index.docFreq,
      index.totalDocs,
    ) : 0;
    const tfIdf = squash(tfIdfRaw);
    if (tfIdf > bestScore) { bestScore = tfIdf; bestReason = 'tfidf'; }

    // 4. Substring fallback — only if no other signal fired and the
    //    tag has zero training corpus (cold start). Captures the
    //    legacy "tag's slug is mentioned in the title" behavior.
    if (bestReason == null) {
      const hasTraining = index && index.tagTf.has(tag.id);
      if (!hasTraining && lower.includes(slug)) {
        bestScore = 0.55;
        bestReason = 'substring';
      }
    }

    if (bestScore > 0) out.push({ tagId: tag.id, score: bestScore, reason: bestReason });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

// Stable hash of (content, tag-id-set) — the autotag log uses this
// to dedupe re-scoring runs when nothing changed. Plain djb2 over
// the canonicalized string; collisions are fine since the cost of
// a missed dedup is one re-score, not data loss.
export function contentHash(content, tagIds) {
  const ids = Array.from(tagIds || []).sort().join(',');
  const s = (content || '') + '' + ids;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
