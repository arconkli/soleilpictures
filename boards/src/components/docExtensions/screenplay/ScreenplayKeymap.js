// Screenplay editing keymap (Tab/Enter cycling) + auto-uppercase + smart
// parenthetical wrapping. Added to the editor ONLY in screenplay mode.
//
// priority:1000 so its keymap plugin registers before StarterKit / ExtraShortcuts
// / AutoDetect (Enter) / mention — array order does NOT decide precedence in
// Tiptap. Each handler GATES: it returns false (yielding to the normal doc
// keymaps) unless the caret is in a screenplayBlock and not inside a nested
// list/table, and it yields Enter/Tab to an open mention/autocomplete popup.

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { canSplit } from '@tiptap/pm/transform';
import {
  enterDecision, nextOnTab, prevOnTab, shouldUppercase, detectElementFromText,
} from './screenplayFlow.js';

// An @-mention (.entity-picker) or screenplay autocomplete (.sp-autocomplete)
// popup is open — let it own Enter/Tab.
function suggestionOpen() {
  return typeof document !== 'undefined'
    && !!document.querySelector('.entity-picker, .sp-autocomplete.is-open');
}

// The screenplayBlock at the caret, with the caret's position within it.
// Returns null when the caret isn't inside a screenplayBlock.
function caretBlockInfo(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'screenplayBlock') {
      const offset = $from.pos - $from.start(d);
      return {
        element: node.attrs.element || 'action',
        isEmpty: node.textContent.trim().length === 0,
        atStart: offset === 0,
        atEnd: offset === node.content.size,
      };
    }
  }
  return null;
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

  addStorage() {
    // True while the writer is Enter-Enter-ing forward: the caret's empty block
    // was created by the previous Enter press. Gates the escalation ladder in
    // enterDecision — a clicked-into blank line must split, never escalate.
    // Cleared by any other keydown / mousedown / blur (plugin below).
    return { enterChain: false };
  },

  addKeyboardShortcuts() {
    const cycle = (dir) => () => {
      const ed = this.editor;
      if (suggestionOpen()) return false;
      const info = caretBlockInfo(ed.state);
      if (!info || inListOrTable(ed.state)) return false;
      const next = dir > 0 ? nextOnTab(info.element) : prevOnTab(info.element);
      const chain = ed.chain().focus().updateAttributes('screenplayBlock', { element: next });
      // Smart parenthetical: entering an empty parenthetical drops in "()" with
      // the caret between the parens.
      if (next === 'parenthetical' && info.isEmpty) {
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
        const info = caretBlockInfo(state);
        if (!info || inListOrTable(state)) return false;
        if (!state.selection.empty) return false;
        const decision = enterDecision({ ...info, inChain: this.storage.enterChain });
        this.storage.enterChain = true; // this press starts/continues the flow
        // Escalate: retype the empty line in place (empty cue → action → scene).
        if (decision.kind === 'escalate') {
          return ed.chain().focus().updateAttributes('screenplayBlock', { element: decision.element }).run();
        }
        // Split. screenplayBlock is `defining`, so stock splitBlock would leave
        // a default paragraph behind (at line start it even retypes the EMPTY
        // half) — split with an explicit typesAfter instead, so the block the
        // caret lands in carries exactly the element enterDecision chose and
        // the block before the split keeps its own element + text untouched.
        return ed.chain().focus().command(({ tr, dispatch }) => {
          const spType = tr.doc.type.schema.nodes.screenplayBlock;
          const pos = tr.selection.from;
          const typesAfter = [{ type: spType, attrs: { element: decision.element } }];
          if (!canSplit(tr.doc, pos, 1, typesAfter)) return false;
          if (dispatch) {
            tr.split(pos, 1, typesAfter);
            tr.scrollIntoView();
          }
          return true;
        }).run();
      },
      Tab: cycle(1),
      'Shift-Tab': cycle(-1),
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
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
          // Any non-Enter interaction ends the Enter-Enter flow chain — after a
          // click, an arrow key, or typing, an empty line splits instead of
          // escalating. (Enter itself is handled in the keymap shortcut, which
          // re-arms the chain.)
          handleKeyDown(view, event) {
            if (event.key !== 'Enter') storage.enterChain = false;
            return false;
          },
          handleDOMEvents: {
            mousedown() { storage.enterChain = false; return false; },
            blur() { storage.enterChain = false; return false; },
          },
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
