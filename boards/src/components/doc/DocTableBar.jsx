import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { selectedRect } from '@tiptap/pm/tables';
import { yUndoPluginKey } from 'y-prosemirror';
import { Btn, Group, Toolbar } from '../toolbar/Toolbar.jsx';
import { MenuButton, MenuItem, MenuSep } from '../toolbar/Menu.jsx';
import { useFeedback } from '../AppFeedback.jsx';
import { safeRun } from '../../lib/safeEditorCmd.js';
import { undoToast } from '../../lib/undoToast.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import {
  Check, Columns2, ColumnsPlusLeft, ColumnsPlusRight, Rows, RowsPlusBottom, RowsPlusTop, Trash2,
} from '../../lib/icons.js';

// A table's own bar (the owner's pick of 2026-10-21, mockup G-table): with the
// caret in a table, over the table's top right edge, Row and Column add one
// either side of the caret's or delete it, Header row turns the first row's
// header on and off, and Delete table deletes it, with Undo. Over a long
// table it stays at the top of the page's view until the table's last row
// takes it on up; over a table too narrow for its words (a phone's, a doc in
// a narrow pane) Row and Column are their icons, and Header row is in Row's
// menu. Each is a step back of its own (⌘Z), apart from the typing before
// it. ⌥F10 in the table goes to it, as a bar for the thing at the caret does
// in other editors, and Escape back to the cell; out of a table ⌥F10 is the
// doc's bar's. A press leaves the focus, and the caret, in the cell.

// The table the selection is in: where it starts, and what the bar shows.
// A table's last row or column isn't the bar's to delete (prosemirror-tables
// does nothing then); Delete table is.
function tableAt(ed) {
  if (!ed || ed.isDestroyed || !ed.isEditable) return null;
  const { $from } = ed.state.selection;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.type.name !== 'table') continue;
    let header = node.childCount > 0 && node.firstChild.childCount > 0;
    node.firstChild?.forEach((cell) => { if (cell.type.name !== 'tableHeader') header = false; });
    let rowGoes = false;
    let colGoes = false;
    try {
      const r = selectedRect(ed.state);
      rowGoes = !(r.top === 0 && r.bottom === r.map.height);
      colGoes = !(r.left === 0 && r.right === r.map.width);
    } catch (_) {}
    return { pos: $from.before(d), header, rowGoes, colGoes };
  }
  return null;
}
const same = (a, b) => a === b || (!!a && !!b && a.pos === b.pos && a.header === b.header
  && a.rowGoes === b.rowGoes && a.colGoes === b.colGoes);

const keep = (e) => e.preventDefault();
// The gap between the bar and the table's top, or the top of the page's view.
const GAP = 8;

export function DocTableBar({ editor, paperRef }) {
  const feedback = useFeedback();
  const t = useEditorState({ editor, selector: ({ editor: ed }) => tableAt(ed), equalityFn: same }) ?? null;
  const barRef = useRef(null);
  // { top, right, compact }: placed by its right edge, which its width (the
  // words or the icons) doesn't move. Shown first with its words, unplaced,
  // to measure them.
  const [at, setAt] = useState(null);
  const fullWidth = useRef(0);

  useLayoutEffect(() => {
    const paper = paperRef?.current;
    if (!t || !paper || !editor || editor.isDestroyed) { setAt(null); return undefined; }
    let raf = 0;
    const place = () => {
      raf = 0;
      const bar = barRef.current;
      if (editor.isDestroyed || !bar) return;
      let dom = null;
      try { dom = editor.view.nodeDOM(t.pos); } catch (_) {}
      // Tiptap's resizable table is a wrapper that scrolls a wide table
      // sideways: the edge in view is the wrapper's.
      const tbl = dom?.tagName === 'TABLE' ? dom : dom?.querySelector?.('table');
      if (!tbl) return;
      if (!bar.classList.contains('is-compact')) fullWidth.current = bar.offsetWidth;
      const a = paper.getBoundingClientRect();
      const w = dom.getBoundingClientRect();
      const r = tbl.getBoundingClientRect();
      const x0 = a.left + paper.clientLeft - paper.scrollLeft;
      const y0 = a.top + paper.clientTop - paper.scrollTop;
      const edge = Math.min(w.right, r.right);
      const bh = bar.offsetHeight;
      const view = paper.scrollTop + GAP;
      let top = r.top - y0 - GAP - bh;
      if (top < view) top = Math.min(view, r.bottom - y0 - bh);
      const next = {
        top: Math.round(top),
        right: Math.round(paper.clientWidth - (edge - x0)),
        compact: edge - Math.max(w.left, r.left) < fullWidth.current + 16,
      };
      setAt((was) => (was && was.top === next.top && was.right === next.right && was.compact === next.compact ? was : next));
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(place); };
    place();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon);
    ro?.observe(paper);
    ro?.observe(editor.view.dom);
    paper.addEventListener('scroll', soon, { passive: true });
    return () => {
      ro?.disconnect();
      paper.removeEventListener('scroll', soon);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [t, editor, paperRef]);

  // ⌥F10 in the table: to this bar, before the doc's bar takes it.
  const shown = !!t;
  useEffect(() => {
    if (!shown || !editor) return undefined;
    const onKey = (e) => {
      if (e.key !== 'F10' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.defaultPrevented || isComposingKey(e)) return;
      const dom = editor.isDestroyed ? null : editor.view.dom;
      const bar = barRef.current;
      if (!dom || !bar || !dom.contains(e.target)) return;
      const stop = bar.querySelector('[tabindex="0"]') || bar.querySelector('button:not(:disabled)');
      if (!stop) return;
      e.preventDefault();
      e.stopPropagation();
      stop.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [shown, editor]);

  if (!t) return null;
  const compact = !!at?.compact;

  // One command, a step back of its own: { ok, um }.
  const run = (name, label) => {
    if (!editor || editor.isDestroyed) return { ok: false, um: null };
    const um = yUndoPluginKey.getState(editor.state)?.undoManager || null;
    um?.stopCapturing();
    const ok = safeRun(editor.chain().focus()[name](), label);
    um?.stopCapturing();
    return { ok, um };
  };
  const toggleHeader = () => run('toggleHeaderRow', 'doc:table-header');
  const deleteTable = () => {
    const { ok, um } = run('deleteTable', 'doc:table-delete');
    if (!ok) return;
    const step = um ? um.undoStack[um.undoStack.length - 1] || null : null;
    undoToast(feedback, {
      message: 'Table deleted',
      undoManager: step ? um : null,
      stackItem: step,
      supersededMessage: 'The doc changed since — press ⌘Z to step back instead.',
      onUndo: () => { if (step) um.undo(); },
    });
  };
  const words = (text) => (compact ? { label: text } : { text });

  return (
    <Toolbar label="Table" barRef={barRef} text={() => editor}
             className={compact ? 'dl-tbar is-compact' : 'dl-tbar'}
             style={at ? { top: at.top, right: at.right } : { top: 0, right: 0, visibility: 'hidden' }}>
      <Group>
        <MenuButton {...words('Row')} icon={Rows} caret keepFocus menuLabel="Row">
          <MenuItem icon={RowsPlusTop} label="Add row above" onSelect={() => run('addRowBefore', 'doc:table-row-above')} />
          <MenuItem icon={RowsPlusBottom} label="Add row below" onSelect={() => run('addRowAfter', 'doc:table-row-below')} />
          {compact && <MenuItem label="Header row" checked={t.header} onSelect={toggleHeader} />}
          <MenuSep />
          <MenuItem icon={Trash2} label="Delete row" danger disabled={!t.rowGoes}
                    onSelect={() => run('deleteRow', 'doc:table-row-delete')} />
        </MenuButton>
        <MenuButton {...words('Column')} icon={Columns2} caret keepFocus menuLabel="Column">
          <MenuItem icon={ColumnsPlusLeft} label="Add column left" onSelect={() => run('addColumnBefore', 'doc:table-col-left')} />
          <MenuItem icon={ColumnsPlusRight} label="Add column right" onSelect={() => run('addColumnAfter', 'doc:table-col-right')} />
          <MenuSep />
          <MenuItem icon={Trash2} label="Delete column" danger disabled={!t.colGoes}
                    onSelect={() => run('deleteColumn', 'doc:table-col-delete')} />
        </MenuButton>
      </Group>
      {!compact && (
        <Group>
          <Btn text="Header row" icon={t.header ? Check : undefined} toggle on={t.header}
               className={t.header ? 'dl-tb-head' : 'dl-tb-head is-off'}
               onMouseDown={keep} onClick={toggleHeader} />
        </Group>
      )}
      <Group>
        <Btn icon={Trash2} label="Delete table" onMouseDown={keep} onClick={deleteTable} />
      </Group>
    </Toolbar>
  );
}
