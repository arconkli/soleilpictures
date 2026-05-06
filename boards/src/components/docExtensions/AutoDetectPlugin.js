import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const AUTO_DETECT_KEY = new PluginKey('autoDetect');

// Watches the doc for typed phrases matching workspace entity names.
// Adds dotted underline decorations on candidates. Skips text that's
// already inside a `link` mark, inline `code` mark, or `codeBlock` node.
//
//   options = { getIndex(): NameIndex | null }
export function makeAutoDetectPlugin({ getIndex }) {
  return new Plugin({
    key: AUTO_DETECT_KEY,
    state: {
      init() { return DecorationSet.empty; },
      apply(_tr, _old, _oldState, newState) {
        const index = getIndex?.();
        if (!index) return DecorationSet.empty;
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
            // Universal hairline visual — `tt-link tt-link-auto` shares
            // styling with manual links (just lower opacity at rest).
            // The data-records attr carries the candidate matches so
            // hover handlers can hydrate them into refs.
            decos.push(Decoration.inline(pos + m.start, pos + m.end, {
              class: 'tt-link tt-link-auto',
              'data-records': JSON.stringify(m.records),
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
