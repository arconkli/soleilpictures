// Comments side panel — lists every thread, grouped by page. Click a thread
// to scroll the editor to its anchor (the editor uses .tt-comment marks; we
// find the first occurrence of the matching id). Reply / resolve / delete
// inline.

import { useState } from 'react';
import { addCommentReply, deleteCommentThread, resolveComment } from '../lib/docState.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { useFeedback } from './AppFeedback.jsx';

export function DocCommentsPanel({ ydoc, scope, comments, pages, activePageId, onSelectPage, getEditor, currentUser }) {
  const [showResolved, setShowResolved] = useState(false);
  const visible = comments.filter(c => showResolved || !c.resolved);
  const pageById = (() => { const m = {}; pages.forEach(p => { m[p.id] = p; }); return m; })();

  const grouped = (() => {
    const m = new Map();
    for (const c of visible) {
      if (!m.has(c.pageId)) m.set(c.pageId, []);
      m.get(c.pageId).push(c);
    }
    return m;
  })();

  const jumpToComment = (c) => {
    if (c.pageId !== activePageId) onSelectPage?.(c.pageId);
    let tries = 0;
    const tick = () => {
      const ed = getEditor?.();
      if (!ed) { if (tries++ < 20) setTimeout(tick, 30); return; }
      // Find the first range with this comment-id mark.
      let foundFrom = null, foundTo = null;
      ed.state.doc.descendants((node, pos) => {
        if (foundFrom != null) return false;
        if (!node.isText) return;
        for (const m of node.marks) {
          if (m.type.name === 'comment' && m.attrs.id === c.id) {
            foundFrom = pos;
            foundTo = pos + (node.text || '').length;
            return false;
          }
        }
      });
      if (foundFrom != null) {
        ed.commands.focus();
        ed.commands.setTextSelection({ from: foundFrom, to: foundTo });
        try {
          const dom = ed.view.domAtPos(foundFrom)?.node;
          const el = dom?.nodeType === 3 ? dom.parentElement : dom;
          el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        } catch (_) {}
      }
    };
    tick();
  };

  return (
    <div className="doc-comments">
      <div className="doc-comments-toggle">
        <label>
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </div>
      <div className="doc-comments-body">
        {visible.length === 0 && (
          <div className="doc-comments-empty">
            Select text and right-click → Add comment.
          </div>
        )}
        {[...grouped.entries()].map(([pageId, items]) => (
          <div key={pageId} className="doc-comments-group">
            <div className="doc-comments-page">{pageById[pageId]?.name || 'Untitled'}</div>
            {items.map(c => (
              <CommentThread key={c.id}
                             ydoc={ydoc}
                             scope={scope}
                             c={c}
                             onJump={() => jumpToComment(c)}
                             currentUser={currentUser} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CommentThread({ ydoc, scope, c, onJump, currentUser }) {
  const [reply, setReply] = useState('');
  const feedback = useFeedback();
  const dot = (
    <span className="doc-comment-dot" style={{ background: c.authorColor || '#4f8df8' }}>
      {(c.author || '?')[0]?.toUpperCase()}
    </span>
  );
  return (
    <div className={`doc-comment ${c.resolved ? 'is-resolved' : ''}`} onClick={onJump}>
      <div className="doc-comment-head">
        {dot}
        <span className="doc-comment-author">{c.author || 'Someone'}</span>
        <span className="doc-comment-ts">{relativeTimeShort(c.ts)}</span>
        <span className="doc-comment-spacer" />
        <button className="doc-comment-x"
                title={c.resolved ? 'Reopen' : 'Resolve'}
                onClick={(e) => { e.stopPropagation(); resolveComment(ydoc, c.id, !c.resolved, scope); }}>
          {c.resolved ? '↺' : '✓'}
        </button>
        <button className="doc-comment-x"
                title="Delete"
                onClick={async (e) => {
                  e.stopPropagation();
                  const ok = await feedback.confirm({
                    title: 'Delete this thread?',
                    message: 'Replies will be removed too.',
                    danger: true,
                    confirmLabel: 'Delete',
                  });
                  if (ok) deleteCommentThread(ydoc, c.id, scope);
                }}>×</button>
      </div>
      <div className="doc-comment-body">{c.body}</div>
      {(c.replies || []).map(r => (
        <div key={r.id} className="doc-comment-reply">
          <div className="doc-comment-head">
            <span className="doc-comment-dot" style={{ background: r.authorColor || '#4f8df8' }}>{(r.author || '?')[0]?.toUpperCase()}</span>
            <span className="doc-comment-author">{r.author}</span>
            <span className="doc-comment-ts">{relativeTimeShort(r.ts)}</span>
          </div>
          <div className="doc-comment-body">{r.body}</div>
        </div>
      ))}
      {!c.resolved && (
        <form className="doc-comment-reply-form"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                const body = reply.trim();
                if (!body) return;
                addCommentReply(ydoc, c.id, {
                  body,
                  author: currentUser?.name || currentUser?.email || 'You',
                  authorColor: currentUser?.color || '#4f8df8',
                  scope,
                });
                setReply('');
              }}>
          <input className="doc-comment-reply-input"
                 placeholder="Reply…"
                 value={reply}
                 onChange={(e) => setReply(e.target.value)} />
        </form>
      )}
    </div>
  );
}
