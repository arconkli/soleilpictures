import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { contentHash } from '../../lib/clusterMath.js';

export const TAG_RANGE_KEY = new PluginKey('tagRange');

// Paints tag-color underlines over applied ranges. Range rows come
// from useAppliedTagRanges (entity_links rows with source_anchor) —
// the hook stores them in a ref that we read on every transaction.
//
// Each range is anchored to a paragraph by content-hash. We re-walk
// the doc whenever it changes, hashing every paragraph, so an edit
// elsewhere in the page doesn't disturb existing underlines — the
// paragraph keeps its hash until its own text changes.
//
//   options = {
//     getRanges(): Array<{ pHash, startOffset, length, tagColor, tagName, tagId }>,
//   }
//
// Multiple ranges sharing a paragraph stack vertically via
// text-underline-offset, but rendered as separate decorations so the
// browser composites them cleanly.
export function makeTagRangePlugin({ getRanges }) {
  return new Plugin({
    key: TAG_RANGE_KEY,
    state: {
      init(_cfg, state) { return buildDecorations(state.doc, getRanges?.() || []); },
      apply(tr, old, _oldState, newState) {
        // Re-run only when doc changed OR when the meta says ranges changed.
        if (!tr.docChanged && !tr.getMeta(TAG_RANGE_KEY)) return old.map(tr.mapping, tr.doc);
        return buildDecorations(newState.doc, getRanges?.() || []);
      },
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
  });
}

// Re-walk the doc, build a hash → paragraph-position map, then resolve
// each applied range into an inline decoration.
function buildDecorations(doc, ranges) {
  if (!ranges?.length || !doc?.descendants) return DecorationSet.empty;
  const byHash = new Map(); // pHash → { paraFrom, paraText, count }
  doc.descendants((node, pos) => {
    if (node.type?.name !== 'paragraph') return true;
    const text = (node.textContent || '').trim();
    if (text.length < 20) return false;
    const h = contentHash(text);
    if (!byHash.has(h)) byHash.set(h, { paraFrom: pos + 1, paraText: text, count: 0 });
    // If the same hash exists twice in the doc (duplicated paragraphs),
    // we attach decorations to the FIRST occurrence — good enough for v1.
    return false;
  });

  // Group by paragraph so we can stack offset for multi-tag overlaps.
  const stackByHash = new Map(); // pHash → next stack index
  const decos = [];
  for (const r of ranges) {
    const p = byHash.get(r.pHash);
    if (!p) continue;
    const start = p.paraFrom + Math.max(0, r.startOffset);
    const end = Math.min(p.paraFrom + p.paraText.length, start + Math.max(1, r.length));
    if (end <= start) continue;
    const stackIdx = stackByHash.get(r.pHash) || 0;
    stackByHash.set(r.pHash, stackIdx + 1);
    decos.push(Decoration.inline(start, end, {
      class: `tt-tag-range tt-tag-range-stack-${Math.min(stackIdx, 2)}`,
      style: `--tag-color: ${r.tagColor}`,
      'data-tag-id': r.tagId,
      'data-tag-name': r.tagName,
    }));
  }
  return DecorationSet.create(doc, decos);
}
