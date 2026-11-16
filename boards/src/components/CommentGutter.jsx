import { useEffect, useMemo, useRef, useState } from 'react';
import { commentsMap, readComments } from '../lib/docState.js';
import { fromDocThread } from '../lib/commentModel.js';
import { commentBy } from '../lib/commentAuthor.js';
import { useCommentSeen } from './comments/useCommentSeen.js';
import { t as tr } from '@lingui/core/macro';

// Right-margin layer that draws a dot per open comment thread on the active
// page: neutral ink at rest, solid ink when there is something unread in it.
// Each is a real button with a 24px hit area; pressing one (or Enter on it)
// opens its thread through the parent's onOpenThread (id, { byKey }).
//
// Positioning: the gutter is absolute-positioned inside .doc-editor-wrap;
// each dot's `top` is computed from editor.view.coordsAtPos() of the
// comment mark's first occurrence on the page.
export function CommentGutter({ ydoc, scope, pageId, editor, onOpenThread, currentUser = null, boardId = null, cardId = null }) {
  const [threads, setThreads] = useState([]);
  const [positions, setPositions] = useState({});
  // On a page with no margin to spare (a phone, a narrow pane) the dots would
  // fall off the side: there are none then, and the words themselves, which
  // are tinted and open their thread, are the way in.
  const gutterRef = useRef(null);
  const [fits, setFits] = useState(true);
  const { unread } = useCommentSeen({ userId: currentUser?.id || null, boardId, cardId });
  const shaped = useMemo(() => new Map(threads.map((t) => [t.id, fromDocThread(t)])), [threads]);

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
      const g = gutterRef.current?.getBoundingClientRect();
      const host = wrap.closest('.doc-surface')?.getBoundingClientRect();
      // (the dot is the middle 8px of its 24px button)
      if (g) setFits(g.right - 8 * z <= Math.min(window.innerWidth, host ? host.right : Infinity) + 0.5);
      const next = {};
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const m of node.marks) {
          if (m.type.name !== 'comment') continue;
          const id = m.attrs.id;
          if (!ids.has(id) || next[id]) continue; // first occurrence per thread
          try {
            const coords = editor.view.coordsAtPos(pos);
            next[id] = { top: (coords.top - wrapRect.top) / (z || 1) - 2 };
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
    <div ref={gutterRef} className="comment-gutter">
      {fits && threads.map((t) => {
        const m = shaped.get(t.id);
        const isNew = unread(m);
        const mine = !!m?.root.authorId && m.root.authorId === currentUser?.id;
        const words = String(m?.root.deleted ? tr`This comment was deleted.` : t.body || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        // whose it is, as a phrase of its own (lib/commentAuthor.js), then
        // one message around it
        const whose = commentBy(m?.root.authorName, mine);
        const label = isNew ? tr`${whose}: ${words} (unread)` : tr`${whose}: ${words}`;
        return (
          <button
            key={t.id}
            type="button"
            data-thread={t.id}
            className={`comment-gutter-dot${isNew ? ' is-unread' : ''}`}
            style={{ top: ((positions[t.id]?.top) ?? -9999) + 'px' }}
            aria-label={label}
            onClick={(e) => onOpenThread?.(t.id, { byKey: e.detail === 0 })}
          />
        );
      })}
    </div>
  );
}
