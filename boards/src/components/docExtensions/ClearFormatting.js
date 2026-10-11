// "Clear formatting" — strips the selection's inline formatting (bold, italic,
// colour, font, size, highlight…) back to the surface's own defaults, the way
// ⌘\ does in Google Docs. Links and comment anchors are CONTENT, not
// formatting, so they survive. With an empty selection it clears the stored
// marks, so whatever is typed next starts plain.
//
// Lives in both schema lists (doc + note). It defines no nodes or marks, so
// the headless html↔fragment serializers are unaffected.

import { Extension } from '@tiptap/core';

const KEEP = new Set(['link', 'comment']);

export const ClearFormatting = Extension.create({
  name: 'clearFormatting',

  addCommands() {
    return {
      clearFormatting: () => ({ state, tr, dispatch }) => {
        const { from, to, empty } = state.selection;
        const types = Object.values(state.schema.marks).filter(t => !KEEP.has(t.name));
        if (dispatch) {
          if (!empty) types.forEach(t => tr.removeMark(from, to, t));
          const keep = (state.storedMarks || state.selection.$from.marks()).filter(m => KEEP.has(m.type.name));
          tr.setStoredMarks(keep);
        }
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-\\': () => this.editor.commands.clearFormatting(),
    };
  },
});
