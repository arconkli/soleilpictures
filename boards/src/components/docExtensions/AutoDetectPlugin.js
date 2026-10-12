import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const AUTO_DETECT_KEY = new PluginKey('autoDetect');

// Watches the doc for typed phrases matching workspace entity names.
// Adds dotted underline decorations on candidates. Skips text that's
// already inside a `link` mark, inline `code` mark, or `codeBlock` node.
//
//   options = {
//     getIndex(): NameIndex | null,
//     getIgnored?(): Set<string>           // per-doc ignored terms, lowered
//     getAppliedRangeSet?(doc): Array<{from,to}> // applied tag ranges, as
//                                          // absolute positions in `doc` (the
//                                          // doc being decorated). Decorations
//                                          // whose [start,end) overlap any
//                                          // active range are suppressed —
//                                          // the colored underline wins.
//   }
export function makeAutoDetectPlugin({ getIndex, getIgnored, getAppliedRangeSet }) {
  const build = (doc) => {
    const index = getIndex?.();
    if (!index) return DecorationSet.empty;
    const decos = [];
    // Build the suppression range list once per recompute. Each
    // entry is an absolute [from, to) range in doc positions.
    const applied = getAppliedRangeSet?.(doc) || [];
    doc.descendants((node, pos, parent) => {
      if (node.type.name === 'codeBlock') return false;
      if (!node.isText) return;
      if (parent?.type?.name === 'codeBlock') return;
      // Skip text already wrapped in a link or inline code mark.
      for (const m of node.marks) {
        if (m.type.name === 'link' || m.type.name === 'code') return;
      }
      const text = node.text;
      const ignored = getIgnored?.() || null;
      for (const m of index.findMatches(text)) {
        // Per-doc ignore list — kill the decoration if the matched
        // text is in the doc's "don't auto-link here" suppression
        // list. Workspace-wide ignore lives in the trie itself.
        if (ignored && ignored.has(text.slice(m.start, m.end).toLowerCase())) continue;
        const absStart = pos + m.start;
        const absEnd = pos + m.end;
        // Suppress if any applied tag range covers this match — the
        // colored underline is already showing on top of it.
        if (rangesOverlap(applied, absStart, absEnd)) continue;
        // Universal hairline visual — `tt-link tt-link-auto` shares
        // styling with manual links (just lower opacity at rest).
        // The data-records attr carries the candidate matches so
        // hover handlers can hydrate them into refs.
        decos.push(Decoration.inline(absStart, absEnd, {
          class: 'tt-link tt-link-auto',
          'data-records': JSON.stringify(m.records),
        }));
      }
      return true;
    });
    return DecorationSet.create(doc, decos);
  };

  return new Plugin({
    key: AUTO_DETECT_KEY,
    state: {
      init(_config, state) { return build(state.doc); },
      apply(tr, old, _oldState, newState) {
        // Re-walk only when the doc changed or the owner says the index /
        // ignore list / applied ranges moved (a tr with this key's meta —
        // DocPageEditor sends one). A caret move or selection change used to
        // re-run the trie over every text node and JSON.stringify every
        // match, per arrow key.
        if (!tr.docChanged && !tr.getMeta(AUTO_DETECT_KEY)) return old;
        return build(newState.doc);
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
