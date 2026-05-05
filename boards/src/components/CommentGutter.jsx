import { useEffect, useState } from 'react';
import { commentsMap } from '../lib/docState.js';

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
    const refresh = () => {
      const out = [];
      cm.forEach((v, id) => {
        if (!v) return;
        const get = (k) => v?.get?.(k) ?? v?.[k];
        const t = {
          id,
          pageId: get('pageId'),
          body: get('body'),
          author: get('author'),
          authorColor: get('authorColor'),
          ts: get('ts'),
          resolved: get('resolved') || false,
        };
        if (t.pageId === pageId && !t.resolved) out.push(t);
      });
      setThreads(out);
    };
    refresh();
    cm.observeDeep(refresh);
    return () => cm.unobserveDeep(refresh);
  }, [ydoc, scope, pageId]);

  // Recompute pixel positions when threads or editor doc changes.
  useEffect(() => {
    if (!editor) return;
    const recompute = () => {
      const wrap = editor.view.dom.closest('.doc-editor-wrap');
      const wrapRect = wrap?.getBoundingClientRect();
      if (!wrapRect) return;
      const next = {};
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const m of node.marks) {
          if (m.type.name !== 'comment') continue;
          const t = threads.find(x => x.id === m.attrs.id);
          if (!t || next[t.id]) continue; // first occurrence per thread
          try {
            const coords = editor.view.coordsAtPos(pos);
            next[t.id] = { top: coords.top - wrapRect.top + 6 };
          } catch {}
        }
        return true;
      });
      setPositions(next);
    };
    recompute();
    editor.on('transaction', recompute);
    window.addEventListener('resize', recompute);
    return () => {
      editor.off('transaction', recompute);
      window.removeEventListener('resize', recompute);
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
