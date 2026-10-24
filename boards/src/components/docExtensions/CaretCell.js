// The table cell the caret is in, marked `dl-cell-on` for the doc look's
// ring round it (mockup G-table): the cell the table bar's Row and Column act
// beside (components/doc/DocTableBar.jsx). A selection of cells has its own
// mark (prosemirror-tables' selectedCell), and a reader's caret none.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const KEY = new PluginKey('soleilCaretCell');

function ring(state) {
  const sel = state.selection;
  if (sel.$anchorCell) return DecorationSet.empty;
  const { $from } = sel;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    const role = node.type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') {
      const pos = $from.before(d);
      return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'dl-cell-on' })]);
    }
  }
  return DecorationSet.empty;
}

export const CaretCell = Extension.create({
  name: 'soleilCaretCell',
  addProseMirrorPlugins() {
    const { editor } = this;
    return [new Plugin({
      key: KEY,
      state: {
        init: (_, state) => ring(state),
        apply: (tr, was, _old, state) => (tr.docChanged || tr.selectionSet ? ring(state) : was),
      },
      props: {
        decorations: (state) => (editor.isEditable ? KEY.getState(state) : null),
      },
    })];
  },
});
