// A paragraph's identity for tags: the hash of its trimmed text, as every
// applied tag range stores it (pHash, from contentHash). A paragraph under 20
// characters has none — too short to anchor a tag to.

import { contentHash } from './clusterMath.js';

// Worked out once per paragraph node and remembered: an edit leaves every
// paragraph it didn't touch the same node, so after a keystroke the readers
// below hash one paragraph between them, not the whole doc each.
const hashByNode = new WeakMap();
export function paragraphHash(node) {
  let h = hashByNode.get(node);
  if (h === undefined) {
    const text = (node.textContent || '').trim();
    h = text.length < 20 ? null : contentHash(text);
    hashByNode.set(node, h);
  }
  return h;
}

// Where each paragraph of `doc` starts (the position of its first
// character), by hash, with the paragraph; the first of two equal paragraphs
// wins.
export function paragraphStarts(doc) {
  const starts = new Map();
  doc.descendants((node, pos) => {
    if (node.type?.name !== 'paragraph') return true;
    const h = paragraphHash(node);
    if (h != null && !starts.has(h)) starts.set(h, { from: pos + 1, node });
    return false;
  });
  return starts;
}

// The absolute [from, to) box of each applied range in `doc`; a range whose
// paragraph isn't there (edited away, or on another page) has none.
export function rangeBoxes(doc, ranges) {
  if (!doc || !ranges?.length) return [];
  const starts = paragraphStarts(doc);
  const boxes = [];
  for (const r of ranges) {
    const p = starts.get(r.pHash);
    if (!p) continue;
    boxes.push({ from: p.from + r.startOffset, to: p.from + r.startOffset + r.length });
  }
  return boxes;
}
