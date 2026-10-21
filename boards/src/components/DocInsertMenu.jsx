// Insert menu — the toolbar "+" button opens a click-to-open dropdown to insert
// content that has NO other home in the toolbar: Image, Table, Divider, Code
// block, Embed board. (Headings/lists/quote/bookmark are deliberately NOT here —
// they're already one click away as their own toolbar controls.) Doc mode only;
// in screenplay mode the element <select> covers everything, so the "+" is hidden.
//
// Portaled to <body> with fixed positioning because the toolbar (.doc-tb) is an
// overflow scroll container that would clip an inline absolutely-positioned
// dropdown to a sliver (same root cause as the export-menu fix), and placed
// against the trigger by hooks/useAnchoredPopover.

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { safeRun } from '../lib/safeEditorCmd.js';
import { useAnchoredPopover } from '../hooks/useAnchoredPopover.js';

// Insert-only blocks (each runs on the live editor). Intentionally excludes
// anything already reachable from the toolbar (style <select>, list/quote/
// bookmark buttons) — the "+" is not a second copy of the toolbar.
// An item whose handler is missing is left out (a guest in a shared doc has
// neither: DocSurface guestMode).
function insertItems({ onInsertImage, onInsertBoardEmbed }) {
  return [
    { id: 'image', title: 'Image', subtitle: 'Upload from your machine',
      run: (e) => onInsertImage?.(e) },
    { id: 'table', title: 'Table', subtitle: 'Insert 3×3 table',
      run: (e) => safeRun(e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }), 'doc-insert:table') },
    { id: 'divider', title: 'Divider', subtitle: 'Horizontal rule',
      run: (e) => safeRun(e.chain().focus().setHorizontalRule(), 'doc-insert:divider') },
    // toggleCodeBlock → toggleNode → clearNodes when the block can't be set
    // directly: the same RangeError route the toolbar toggles are guarded on.
    { id: 'code', title: 'Code block', subtitle: 'Monospace code',
      run: (e) => safeRun(e.chain().focus().toggleCodeBlock(), 'doc-insert:code') },
    { id: 'embed', title: 'Embed cluster', subtitle: 'Link to another cluster / card',
      run: (e) => onInsertBoardEmbed?.(e) },
  ].filter((it) => (it.id === 'image' ? !!onInsertImage : it.id === 'embed' ? !!onInsertBoardEmbed : true));
}

export function DocInsertMenu({ editor, disabled = false, onInsertImage, onInsertBoardEmbed }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);      // trigger wrapper

  const items = insertItems({ onInsertImage, onInsertBoardEmbed });

  // Under the button, lined up with its left (it sits at the left of the
  // toolbar); a press outside or Escape closes it.
  const pop = useAnchoredPopover({ open, onClose: () => setOpen(false), anchorRef: ref });

  const choose = (it) => {
    if (editor) it.run(editor);
    setOpen(false);
  };

  return (
    <span className="doc-insert-wrap" ref={ref}>
      <button className="doc-tb-btn" disabled={disabled}
              title="Insert a block" aria-label="Insert a block"
              aria-haspopup="menu" aria-expanded={open}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(o => !o)}>+</button>
      {open && createPortal(
        <div className="doc-insert-menu" role="menu" ref={pop.popRef} style={pop.style}>
          {items.map(it => (
            <button key={it.id} className="doc-insert-item" role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(it)}>
              <div className="doc-insert-item-title">{it.title}</div>
              <div className="doc-insert-item-sub">{it.subtitle}</div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </span>
  );
}
