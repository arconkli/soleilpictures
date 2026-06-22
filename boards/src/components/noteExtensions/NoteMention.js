// Custom Tiptap node for a note @-mention chip. Inline atom whose HTML is the
// EXACT legacy note contract: <span class="tt-link tt-link-manual"
// data-entity-ref='<json>'>label</span>. Keeping the markup identical means the
// read-only display renderer (renderHtmlWithAutoLinks → EntityLink, which keys
// off data-entity-ref) and every other html consumer keep working unchanged
// once note text moves into a Y.XmlFragment.
//
// Atom (leaf) inline node: the chip is one selectable unit. The label is stored
// as an attribute and emitted as the node's static text so generateHTML/parse
// round-trips it.

import { Node, mergeAttributes } from '@tiptap/core';

export const NoteMention = Node.create({
  name: 'noteMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      entityRef: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-entity-ref');
          if (!raw) return null;
          try { return JSON.parse(raw); } catch (_) { return null; }
        },
        renderHTML: (attrs) =>
          attrs.entityRef ? { 'data-entity-ref': JSON.stringify(attrs.entityRef) } : {},
      },
      // The visible chip text. Parsed from textContent; emitted as the static
      // child in renderHTML (not as an attribute).
      label: {
        default: '',
        parseHTML: (el) => el.textContent || '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-entity-ref]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ class: 'tt-link tt-link-manual' }, HTMLAttributes),
      node.attrs.label || '',
    ];
  },

  addCommands() {
    return {
      insertNoteMention: (attrs) => ({ chain }) =>
        chain().insertContent({ type: this.name, attrs }).run(),
    };
  },
});
