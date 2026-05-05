// Auto-generated outline (TOC) for the active page. Walks the editor's
// ProseMirror document and lists every heading node, indented by level.
// Click a row to scroll the editor to that heading.

import { useEffect, useState } from 'react';

export function DocOutlinePanel({ getEditor, activePageId }) {
  const [headings, setHeadings] = useState([]);

  useEffect(() => {
    const editor = getEditor?.();
    if (!editor) { setHeadings([]); return; }
    const compute = () => {
      const out = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          out.push({
            level: node.attrs.level || 1,
            text: node.textContent || 'Untitled',
            pos: pos + 1, // inside the heading
          });
        }
      });
      setHeadings(out);
    };
    compute();
    editor.on('update', compute);
    editor.on('selectionUpdate', compute);
    return () => {
      editor.off('update', compute);
      editor.off('selectionUpdate', compute);
    };
  }, [getEditor, activePageId]);

  const jumpTo = (h) => {
    const editor = getEditor?.();
    if (!editor) return;
    editor.commands.focus();
    editor.commands.setTextSelection(h.pos);
    try {
      const dom = editor.view.domAtPos(h.pos)?.node;
      const el = dom?.nodeType === 3 ? dom.parentElement : dom;
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } catch (_) {}
  };

  return (
    <div className="doc-outline">
      {headings.length === 0 ? (
        <div className="doc-outline-empty">Add headings (⌘⌥1, ⌘⌥2, ⌘⌥3) to build an outline.</div>
      ) : (
        headings.map((h, i) => (
          <button key={i}
                  className={`doc-outline-row doc-outline-l${h.level}`}
                  style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                  onClick={() => jumpTo(h)}
                  title={h.text}>
            {h.text}
          </button>
        ))
      )}
    </div>
  );
}
