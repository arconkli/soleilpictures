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
import {
  nextOnEnter, nextOnTab, prevOnTab, shouldUppercase, detectElementFromText,
} from './screenplayFlow.js';

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
        // On an EMPTY line, escalate the line IN PLACE (no extra blank block):
        // empty character → action, empty action → scene, etc.
        if (empty && nextEl !== cur) {
          return ed.chain().focus().updateAttributes('screenplayBlock', { element: nextEl }).run();
        }
        // Otherwise split and make the NEW block a screenplayBlock carrying the
        // next element (dialogue → character, character → dialogue, …). splitBlock
        // on a `defining` node yields a default paragraph, so setNode (convert).
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
        // Keep at least one screenplayBlock in the doc. Deleting all content
        // leaves ProseMirror's default empty `paragraph` (not a screenplayBlock),
        // which grays out the element selector and makes Enter/Tab inert (their
        // gates require a screenplayBlock). Restore a Scene Heading in the SAME
        // dispatch so the writer is never stranded after clearing the page.
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const { doc, schema } = newState;
          const spType = schema.nodes.screenplayBlock;
          if (!spType) return null;
          if (doc.childCount === 1) {
            const only = doc.firstChild;
            if (only.type.name === 'paragraph' && only.content.size === 0) {
              const tr = newState.tr.setNodeMarkup(0, spType, { element: 'scene' });
              return tr.setSelection(TextSelection.create(tr.doc, 1));
            }
          }
          return null;
        },
        props: {
          // Auto-uppercase scene/character/transition lines AND auto-format an
          // action line into a Scene Heading / Transition the moment its text
          // says so. handleTextInput fires only for LOCAL keystroke input (never
          // for remote Yjs updates) and not during IME composition — so this is
          // collaboration- and IME-safe.
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const $from = state.doc.resolve(from);
            let depth = null;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === 'screenplayBlock') { depth = d; break; }
            }
            if (depth == null) return false;
            const node = $from.node(depth);
            const element = node.attrs.element || 'action';

            // Uppercase the just-typed char on uppercase elements.
            const insert = shouldUppercase(element) ? text.toUpperCase() : text;

            // Would this keystroke turn an ACTION line into a slugline/transition?
            const blockStart = $from.start(depth);
            const blockEnd = $from.end(depth);
            const content = node.textContent;
            const head = content.slice(0, from - blockStart) + insert;
            const resultText = head + content.slice(to - blockStart);
            const detected = detectElementFromText(element, resultText);
            if (detected) {
              // Promote the block + uppercase the whole line (scene/transition
              // are uppercase) in ONE transaction → one undo step.
              const finalText = shouldUppercase(detected) ? resultText.toUpperCase() : resultText;
              const caret = blockStart + (shouldUppercase(detected) ? head.toUpperCase().length : head.length);
              const tr = state.tr
                .insertText(finalText, blockStart, blockEnd)
                .setNodeMarkup($from.before(depth), undefined, { ...node.attrs, element: detected });
              tr.setSelection(TextSelection.create(tr.doc, caret));
              view.dispatch(tr);
              return true;
            }

            if (insert === text) return false; // nothing to change
            view.dispatch(state.tr.insertText(insert, from, to));
            return true;
          },
        },
      }),
    ];
  },
});
