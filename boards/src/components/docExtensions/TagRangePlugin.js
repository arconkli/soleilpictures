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

// Re-walk the doc, build a hash → paragraph-position map, then paint
// a single inline decoration over the trigger word (when known).
// Paragraph-tier applies have no keyword position — they render
// margin-only via DocTagGutter, so we skip them here.
//
// The decoration is purely visual: no data-tag-* attributes so
// hovering the text doesn't open a popover (the margin dot does).
function buildDecorations(doc, ranges) {
  if (!ranges?.length || !doc?.descendants) return DecorationSet.empty;
  const byHash = new Map(); // pHash → { paraFrom, paraText }
  doc.descendants((node, pos) => {
    if (node.type?.name !== 'paragraph') return true;
    const text = (node.textContent || '').trim();
    if (text.length < 20) return false;
    const h = contentHash(text);
    if (!byHash.has(h)) byHash.set(h, { paraFrom: pos + 1, paraText: text });
    // First-occurrence wins on duplicate paragraphs.
    return false;
  });

  const decos = [];
  for (const r of ranges) {
    // Skip paragraph-tier applies — no keyword position, no inline tint.
    if (typeof r.keywordOffset !== 'number' || typeof r.keywordLength !== 'number') continue;
    if (r.keywordLength <= 0) continue;
    const p = byHash.get(r.pHash);
    if (!p) continue;
    const start = p.paraFrom + Math.max(0, r.keywordOffset);
    const end = Math.min(p.paraFrom + p.paraText.length, start + r.keywordLength);
    if (end <= start) continue;
    decos.push(Decoration.inline(start, end, {
      class: 'tt-tag-word',
      style: `--tag-color: ${r.tagColor}`,
      // Carry tag identity on the DOM so hovering the tinted word
      // can open the same popover as hovering the margin dot.
      'data-tag-id': r.tagId,
      'data-tag-name': r.tagName,
      'data-source': r.source || '',
    }));
  }
  return DecorationSet.create(doc, decos);
}
