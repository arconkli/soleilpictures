// Screenplay editing keymap (Tab/Enter cycling) + auto-uppercase + smart
// parenthetical wrapping. Added to the editor ONLY in screenplay mode.
//
// priority:1000 so its keymap plugin registers before StarterKit / ExtraShortcuts
// / AutoDetect (Enter) / mention — array order does NOT decide precedence in
// Tiptap. Each handler GATES: it returns false (yielding to the normal doc
// keymaps) unless the caret is in a screenplayBlock and not inside a nested
// list/table, and it yields Enter/Tab to an open slash/mention popup.

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { nextOnEnter, nextOnTab, prevOnTab, shouldUppercase } from './screenplayFlow.js';

// A slash (.doc-slash) or @-mention (.entity-picker) popup is open — let it own
// Enter/Tab.
function suggestionOpen() {
  return typeof document !== 'undefined'
    && !!document.querySelector('.doc-slash, .entity-picker, .sp-autocomplete.is-open');
}

function currentScreenplayElement(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'screenplayBlock') return $from.node(d).attrs.element || 'action';
  }
  return null;
}
function blockIsEmpty(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'screenplayBlock') return $from.node(d).textContent.trim().length === 0;
  }
  return false;
}
function inListOrTable(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d).type.name;
    if (n === 'listItem' || n === 'taskItem' || n === 'tableCell' || n === 'tableHeader') return true;
  }
  return false;
}

export const ScreenplayKeymap = Extension.create({
  name: 'screenplayKeymap',
  priority: 1000,

  addKeyboardShortcuts() {
    const cycle = (dir) => () => {
      const ed = this.editor;
      if (suggestionOpen()) return false;
      const cur = currentScreenplayElement(ed.state);
      if (!cur || inListOrTable(ed.state)) return false;
      const next = dir > 0 ? nextOnTab(cur) : prevOnTab(cur);
      const empty = blockIsEmpty(ed.state);
      const chain = ed.chain().focus().updateAttributes('screenplayBlock', { element: next });
      // Smart parenthetical: entering an empty parenthetical drops in "()" with
      // the caret between the parens.
      if (next === 'parenthetical' && empty) {
        return chain.command(({ tr, dispatch }) => {
          if (dispatch) {
            const pos = tr.selection.from;
            tr.insertText('()', pos);
            tr.setSelection(TextSelection.create(tr.doc, pos + 1));
          }
          return true;
        }).run();
      }
      return chain.run();
    };
    return {
      Enter: () => {
        const ed = this.editor;
        if (suggestionOpen()) return false;
        const { state } = ed;
        const cur = currentScreenplayElement(state);
        if (cur == null || inListOrTable(state)) return false;
        if (!state.selection.empty) return false;
        const empty = blockIsEmpty(state);
        const nextEl = nextOnEnter(cur, empty);
        // Enter on an empty cue/transition just retypes the current line as the
        // bail element (action) — no extra blank line.
        if (empty && nextEl !== cur && cur !== 'action') {
          return ed.chain().focus().updateAttributes('screenplayBlock', { element: nextEl }).run();
        }
        // Otherwise split and make the NEW block a screenplayBlock carrying the
        // next element. splitBlock on a `defining` node yields a default
        // paragraph, so we setNode (convert) rather than updateAttributes.
        return ed.chain().focus()
          .splitBlock()
          .setNode('screenplayBlock', { element: nextEl })
          .run();
      },
      Tab: cycle(1),
      'Shift-Tab': cycle(-1),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Uppercase typed characters in scene/character/transition lines.
          // handleTextInput fires only for LOCAL keystroke input (never for
          // remote Yjs updates) and not during IME composition — so this is
          // collaboration- and IME-safe, and insertText preserves stored marks.
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const $from = state.doc.resolve(from);
            let element = null;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === 'screenplayBlock') { element = $from.node(d).attrs.element; break; }
            }
            if (!element || !shouldUppercase(element)) return false;
            const upper = text.toUpperCase();
            if (upper === text) return false;
            view.dispatch(state.tr.insertText(upper, from, to));
            return true;
          },
        },
      }),
    ];
  },
});
