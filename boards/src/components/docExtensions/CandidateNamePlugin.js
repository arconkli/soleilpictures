import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const CANDIDATE_NAME_KEY = new PluginKey('candidateName');

// Paints a soft dotted underline under "candidate names" — recurring
// capitalized proper nouns that aren't tags yet (from get_candidate_names,
// indexed by useCandidateNames). Tapping one opens CandidatePromptPopover
// to promote it to a character/setting tag or dismiss it.
//
// Modeled on AutoDetectPlugin: it rebuilds the whole DecorationSet on
// every transaction, reading all inputs through closures, so swapping the
// index (async load, or after a promote/dismiss) is picked up on the next
// tick. The editor forces an immediate repaint by dispatching an empty
// transaction with this plugin's meta when the index identity changes.
//
//   options = {
//     getIndex(): NameIndex | null,            // candidate-name trie
//     getAppliedRangeSet?(): Array<{from,to}>, // applied tag ranges to suppress under
//     getMentionIndex?(): NameIndex | null,    // workspace entity trie — mentions win
//   }
export function makeCandidateNamePlugin({ getIndex, getAppliedRangeSet, getMentionIndex }) {
  return new Plugin({
    key: CANDIDATE_NAME_KEY,
    state: {
      init() { return DecorationSet.empty; },
      apply(tr, old, _oldState, newState) {
        // Re-walk only when the doc changed OR a meta says the candidate
        // index / applied ranges moved; otherwise just map existing decos
        // (cursor moves and selection changes don't need a rebuild).
        if (!tr.docChanged && !tr.getMeta(CANDIDATE_NAME_KEY)) {
          return old.map(tr.mapping, tr.doc);
        }
        const index = getIndex?.();
        if (!index) return DecorationSet.empty;
        const applied = getAppliedRangeSet?.() || [];
        const mentions = getMentionIndex?.() || null;
        const decos = [];
        newState.doc.descendants((node, pos, parent) => {
          if (node.type.name === 'codeBlock') return false;
          if (!node.isText) return;
          if (parent?.type?.name === 'codeBlock') return;
          // Skip text already wrapped in a link or inline code mark.
          for (const m of node.marks) {
            if (m.type.name === 'link' || m.type.name === 'code') return;
          }
          const text = node.text;
          for (const m of index.findMatches(text)) {
            const absStart = pos + m.start;
            const absEnd = pos + m.end;
            // A colored tag range already covers this — the tag wins.
            if (rangesOverlap(applied, absStart, absEnd)) continue;
            // The name is already a real entity (e.g. just promoted, or a
            // card/board name) — its own mention underline wins; don't
            // double-paint the candidate dotted line on top.
            if (mentions) {
              const mm = mentions.longestMatchAt(text, m.start);
              if (mm && mm.start === m.start && mm.end === m.end) continue;
            }
            const rec = (m.records && m.records[0]) || {};
            decos.push(Decoration.inline(absStart, absEnd, {
              class: 'tt-candidate',
              'data-name': rec.name || text.slice(m.start, m.end),
              'data-count': String(rec.n ?? ''),
              'data-sample': rec.sample || '',
              'data-type': rec.entityType || '',
            }));
          }
          return true;
        });
        return DecorationSet.create(newState.doc, decos);
      },
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
  });
}

function rangesOverlap(ranges, a, b) {
  if (!ranges || ranges.length === 0) return false;
  for (const r of ranges) {
    if (a < r.to && b > r.from) return true;
  }
  return false;
}
