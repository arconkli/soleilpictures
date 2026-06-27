// Insert menu — the toolbar "+" button opens a click-to-open dropdown to insert
// content that has NO other home in the toolbar: Image, Table, Divider, Code
// block, Embed board. (Headings/lists/quote/bookmark are deliberately NOT here —
// they're already one click away as their own toolbar controls.) Doc mode only;
// in screenplay mode the element <select> covers everything, so the "+" is hidden.
//
// Portaled to <body> with fixed positioning because the toolbar (.doc-tb) is an
// overflow scroll container that would clip an inline absolutely-positioned
// dropdown to a sliver (same root cause as the export-menu fix). Mirrors the
// DocExportMenu portal pattern: anchor to the trigger via getBoundingClientRect,
// flip above when there's no room below, clamp to the viewport.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Insert-only blocks (each runs on the live editor). Intentionally excludes
// anything already reachable from the toolbar (style <select>, list/quote/
// bookmark buttons) — the "+" is not a second copy of the toolbar.
function insertItems({ onInsertImage, onInsertBoardEmbed }) {
  return [
    { id: 'image', title: 'Image', subtitle: 'Upload from your machine',
      run: (e) => onInsertImage?.(e) },
    { id: 'table', title: 'Table', subtitle: 'Insert 3×3 table',
      run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'divider', title: 'Divider', subtitle: 'Horizontal rule',
      run: (e) => e.chain().focus().setHorizontalRule().run() },
    { id: 'code', title: 'Code block', subtitle: 'Monospace code',
      run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { id: 'embed', title: 'Embed board', subtitle: 'Link to another board / card',
      run: (e) => onInsertBoardEmbed?.(e) },
  ];
}

export function DocInsertMenu({ editor, disabled = false, onInsertImage, onInsertBoardEmbed }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);      // trigger wrapper
  const menuRef = useRef(null);  // portaled panel

  const items = insertItems({ onInsertImage, onInsertBoardEmbed });

  // Portaled + fixed against the trigger. Left-aligned to the button (it sits at
  // the left of the toolbar); flip above when there's no room below.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const GAP = 6, PAD = 8, MIN_W = 220;
    const measure = () => {
      const r = ref.current.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const mw = Math.max(menuRef.current?.offsetWidth || MIN_W, MIN_W);
      const mh = menuRef.current?.offsetHeight || 0;
      const spaceBelow = vh - r.bottom - PAD;
      const placeAbove = mh > 0 && spaceBelow < mh && (r.top - PAD) > spaceBelow;
      const top = placeAbove ? Math.max(PAD, r.top - mh - GAP) : r.bottom + GAP;
      const left = Math.min(Math.max(PAD, r.left), vw - mw - PAD);
      setPos({ top, left });
    };
    measure();
    const id = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', measure); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Menu lives in a portal, so the outside-click check spares BOTH refs.
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
        <div className="doc-insert-menu" role="menu" ref={menuRef}
             style={{ position: 'fixed', top: pos.top, left: pos.left }}>
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
