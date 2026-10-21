import { useEffect, useState } from 'react';
import { commentsMap, readComments } from '../lib/docState.js';

// Right-margin layer that draws a soleil-gold dot per unresolved comment
// thread on the active page. Click → opens the inline thread popover via
// the parent's onOpenThread callback.
//
// Positioning: the gutter is absolute-positioned inside .doc-editor-wrap;
// each dot's `top` is computed from editor.view.coordsAtPos() of the
// comment mark's first occurrence on the page.
export function CommentGutter({ ydoc, scope, pageId, editor, onOpenThread }) {
  const [threads, setThreads] = useState([]);
  const [positions, setPositions] = useState({});

  // Subscribe to comment-map changes.
  useEffect(() => {
    if (!ydoc) return;
    const cm = commentsMap(ydoc, scope);
    if (!cm) return;
    // A thread's resolve can be filed beside it (lib/commentKeys.js), so
    // whether it is open is readComments' to say, not the thread's own flag.
    const refresh = () => {
      setThreads(readComments(ydoc, scope).filter((t) => t.pageId === pageId && !t.resolved));
    };
    refresh();
    cm.observeDeep(refresh);
    return () => cm.unobserveDeep(refresh);
  }, [ydoc, scope, pageId]);

  // Recompute pixel positions when threads change, the doc changes, or the
  // sheet reflows. One rAF-batched pass per frame, and nothing at all on a
  // page with no open threads: it used to walk the whole doc and read layout
  // straight after ProseMirror's DOM write on every keystroke and caret move.
  useEffect(() => {
    if (!editor) return undefined;
    if (!threads.length) { setPositions(p => (Object.keys(p).length ? {} : p)); return undefined; }
    const ids = new Set(threads.map(t => t.id));
    let raf = 0;
    const recompute = () => {
      raf = 0;
      if (editor.isDestroyed) return;
      const wrap = editor.view.dom.closest('.doc-editor-wrap');
      const wrapRect = wrap?.getBoundingClientRect();
      if (!wrapRect) return;
      // The gutter renders INSIDE the zoomed wrap (zoom: var(--doc-zoom)), so
      // its CSS `top` is in LAYOUT px — but coordsAtPos deltas are client px,
      // already scaled by the zoom. Divide it back out or every dot lands at
      // top×zoom² (visibly wrong at any zoom other than 100%).
      const z = wrap.offsetWidth ? wrapRect.width / wrap.offsetWidth : 1;
      const next = {};
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const m of node.marks) {
          if (m.type.name !== 'comment') continue;
          const id = m.attrs.id;
          if (!ids.has(id) || next[id]) continue; // first occurrence per thread
          try {
            const coords = editor.view.coordsAtPos(pos);
            next[id] = { top: (coords.top - wrapRect.top) / (z || 1) + 6 };
          } catch {}
        }
        return true;
      });
      setPositions(prev => {
        const keys = Object.keys(next);
        if (keys.length === Object.keys(prev).length
            && keys.every(k => prev[k] && Math.abs(prev[k].top - next[k].top) < 0.5)) return prev;
        return next;
      });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(recompute); };
    const onTr = ({ transaction } = {}) => { if (!transaction || transaction.docChanged) schedule(); };
    schedule();
    editor.on('transaction', onTr);
    // Reflow (a window or pane resize, zoom, fonts loading) moves the lines.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(editor.view.dom);
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      editor.off('transaction', onTr);
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [editor, threads]);

  return (
    <div className="comment-gutter">
      {threads.map(t => (
        <button
          key={t.id}
          data-thread={t.id}
          className="comment-gutter-dot"
          style={{ top: ((positions[t.id]?.top) ?? -9999) + 'px' }}
          onClick={() => onOpenThread?.(t.id)}
          title={`${t.author || ''} · ${(t.body || '').slice(0, 60)}`}
        />
      ))}
    </div>
  );
}
