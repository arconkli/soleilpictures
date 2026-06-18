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
      // A LOCKED scene number (e.g. "5" or "5A"). null = unlocked → numbered
      // automatically by order at render time. Persisted as data-scene-lock so
      // locked numbers survive reload + collaborate (attr on a stable node).
      sceneNumber: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-scene-lock') || null,
        renderHTML: (attrs) => (attrs.sceneNumber ? { 'data-scene-lock': attrs.sceneNumber } : {}),
      },
      // Dual dialogue column: 'left' | 'right' | null. The two speakers'
      // speech blocks carry left/right so they render side by side. An attr on
      // the stable node (not a structural wrapper) converges under Yjs.
      dual: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-dual');
          return (v === 'left' || v === 'right') ? v : null;
        },
        renderHTML: (attrs) => (attrs.dual ? { 'data-dual': attrs.dual } : {}),
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
      // Lock scene numbers: stamp each scene heading, in order, with its current
      // auto number so later inserts get A/B suffixes instead of renumbering.
      lockSceneNumbers: () => ({ state, tr, dispatch }) => {
        let n = 0;
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'screenplayBlock' && node.attrs.element === 'scene') {
            n += 1;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, sceneNumber: String(n) });
          }
        });
        if (dispatch) dispatch(tr);
        return true;
      },
      // Unlock: clear every stored scene number → back to auto numbering.
      unlockSceneNumbers: () => ({ state, tr, dispatch }) => {
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'screenplayBlock' && node.attrs.sceneNumber != null) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, sceneNumber: null });
          }
        });
        if (dispatch) dispatch(tr);
        return true;
      },
      // Dual dialogue: pair the speech at the caret with the one before it so
      // they render side by side (preceding = left, current = right). Toggles
      // off if the current speech is already dual.
      toggleDualDialogue: () => ({ state, tr, dispatch }) => {
        const { doc, selection } = state;
        const blocks = [];
        doc.forEach((node, pos) => blocks.push({
          node, pos,
          end: pos + node.nodeSize,
          element: node.type.name === 'screenplayBlock' ? (node.attrs.element || 'action') : null,
          dual: node.type.name === 'screenplayBlock' ? (node.attrs.dual || null) : null,
        }));
        const head = selection.head;
        let ci = blocks.findIndex(b => head >= b.pos && head <= b.end);
        if (ci < 0) return false;
        const isSpeech = (el) => el === 'parenthetical' || el === 'dialogue';
        // C2 = the character cue starting the speech at the caret.
        let startC2 = ci;
        while (startC2 >= 0 && blocks[startC2].element !== 'character') startC2 -= 1;
        if (startC2 < 0) return false;
        let endC2 = startC2;
        while (endC2 + 1 < blocks.length && isSpeech(blocks[endC2 + 1].element)) endC2 += 1;
        // C1 = the speech immediately before C2.
        let startC1 = startC2 - 1;
        while (startC1 >= 0 && blocks[startC1].element !== 'character') startC1 -= 1;
        if (startC1 < 0) return false;
        let endC1 = startC1;
        while (endC1 + 1 < startC2 && isSpeech(blocks[endC1 + 1].element)) endC1 += 1;
        const already = !!blocks[startC2].dual;
        const setRange = (from, to, val) => {
          for (let k = from; k <= to; k += 1) {
            const b = blocks[k];
            if (!b.element) continue; // only screenplayBlocks
            tr.setNodeMarkup(b.pos, undefined, { ...b.node.attrs, dual: val });
          }
        };
        if (already) { setRange(startC1, endC1, null); setRange(startC2, endC2, null); }
        else { setRange(startC1, endC1, 'left'); setRange(startC2, endC2, 'right'); }
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});
