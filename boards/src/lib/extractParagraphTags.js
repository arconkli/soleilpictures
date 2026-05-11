// Walk a ProseMirror doc (e.g. a tiptap editor's state.doc) and return
// one record per "tag-eligible" paragraph — i.e. paragraphs long enough
// to carry semantic signal. Each record carries the paragraph's stable
// hash (so we can re-locate it after edits move its position) plus the
// current absolute doc positions and plain text.
//
// Used by the per-edit sync pipeline to:
//   - diff against the previously-saved set of hashes for this page
//   - embed new/changed paragraphs
//   - apply tier-1 (paragraph-level) tag verdicts
//
// Tier 2 / 3 (sentence + word+context) consume the same {text, pHash}
// pair to keep their from/to offsets relative to the paragraph.

import { contentHash } from './clusterMath.js';

const MIN_PARAGRAPH_CHARS = 20;

// Returns [{ pHash, from, to, text }] for every paragraph node in
// `doc` with at least MIN_PARAGRAPH_CHARS of trimmed text. from/to are
// absolute ProseMirror positions valid for the doc passed in — they
// shift if the user keeps editing, so callers should re-walk the doc
// when they need fresh positions.
export function extractParagraphTags(doc) {
  if (!doc?.descendants) return [];
  const out = [];
  doc.descendants((node, pos) => {
    if (node.type?.name !== 'paragraph') return true;
    const text = (node.textContent || '').trim();
    if (text.length < MIN_PARAGRAPH_CHARS) return false; // don't recurse into text nodes
    out.push({
      pHash: contentHash(text),
      from: pos,                       // position OF the paragraph node
      to: pos + node.nodeSize,         // exclusive end of the paragraph node
      text,
    });
    return false; // paragraphs are leaf-ish; stop descending
  });
  return out;
}
