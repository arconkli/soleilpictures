// Walks free-form text against the workspace entity trie and pulls
// out tag mentions, keyed by tag id, with a contextual snippet of the
// surrounding sentence-ish neighborhood. Used by the doc save path to
// persist auto-detected mentions into entity_links, so the tag detail
// view can surface "this doc mentions Not Organization" with the
// actual quote, not just the doc title.
//
// We dedupe to first-mention-per-tag (one row per <source, target tag>
// makes upserts trivial and matches how applied tags already work).
// The full multi-mention story can come later via a sidecar table.

const MAX_SNIPPET = 220;
const PAD = 100;

// Pull a readable snippet of `text` around the [start,end) range. Trims
// leading/trailing partial words and adds an ellipsis when truncated.
function buildSnippet(text, start, end) {
  let s = Math.max(0, start - PAD);
  let e = Math.min(text.length, end + PAD);
  // Trim leading partial word so we don't open with "…rsation".
  if (s > 0) {
    const offs = text.slice(s, start).search(/\s/);
    if (offs >= 0 && offs < 30) s = s + offs + 1;
  }
  // Trim trailing partial word symmetrically.
  if (e < text.length) {
    const tail = text.slice(end, e);
    const lastWs = tail.lastIndexOf(' ');
    if (lastWs > 0 && (tail.length - lastWs) < 30) e = end + lastWs;
  }
  let snippet = text.slice(s, e).replace(/\s+/g, ' ').trim();
  if (!snippet) return '';
  if (s > 0) snippet = '…' + snippet;
  if (e < text.length) snippet = snippet + '…';
  return snippet.slice(0, MAX_SNIPPET);
}

// Returns [{ ref: { kind:'tag', id }, contextText, name }] — one entry
// per distinct tag mentioned anywhere in `text`. Snippet captures the
// FIRST mention's surroundings.
export function extractTagMentions(text, trie) {
  if (!text || !trie?.findMatches) return [];
  const seen = new Set();
  const out = [];
  for (const m of trie.findMatches(text)) {
    for (const rec of (m.records || [])) {
      if (rec.kind !== 'tag' || !rec.id) continue;
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      out.push({
        ref: { kind: 'tag', id: rec.id },
        name: rec.name || null,
        contextText: buildSnippet(text, m.start, m.end),
      });
    }
  }
  return out;
}
