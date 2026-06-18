// Screenplay element node. A SINGLE node type with an `element` enum attr
// (scene / action / character / dialogue / parenthetical / transition / shot /
// centered) rather than 8 distinct node types — so Tab/Enter cycling is just
// `updateAttributes` (the node identity + its position in the Y.XmlFragment
// never change), which converges cleanly under Yjs collaboration instead of
// racing structural splits/joins. Layout per element is pure CSS keyed on
// `data-screenplay-element`.
//
// It is a normal text block (`content: 'inline*'`), so it coexists with prose
// nodes — a doc that never instantiates it is unaffected.

import { Node, mergeAttributes } from '@tiptap/core';
import { ELEMENTS } from './screenplayFlow.js';

export const ScreenplayBlock = Node.create({
  name: 'screenplayBlock',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      element: {
        default: 'action',
        parseHTML: (el) => {
          const v = el.getAttribute('data-screenplay-element');
          return ELEMENTS.includes(v) ? v : 'action';
        },
        renderHTML: (attrs) => ({ 'data-screenplay-element': attrs.element || 'action' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-screenplay-element]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const el = node.attrs.element || 'action';
    // Namespaced `sp-el-<element>` (NOT `sp-<element>`): the bare `sp-action`
    // class collided with the canvas drawing toolbar's `.sp-action` button,
    // which boxed action lines in a gray pill. On-screen layout is keyed off
    // the `data-screenplay-element` attr, not these classes.
    return ['div', mergeAttributes({ class: `sp-el sp-el-${el}` }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      // Convert the current text block into a screenplayBlock of `element`
      // (or change an existing screenplayBlock's element).
      setScreenplayElement: (element) => ({ commands }) =>
        commands.setNode(this.name, { element }),
      // Convert a screenplayBlock back to a normal paragraph.
      clearScreenplayElement: () => ({ commands }) =>
        commands.setNode('paragraph'),
    };
  },
});
