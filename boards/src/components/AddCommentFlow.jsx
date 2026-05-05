import { useState } from 'react';
import { InlineComposer } from './InlineComposer.jsx';
import { addCommentThread } from '../lib/docState.js';

// Imperative helper: opens an InlineComposer next to the live editor
// selection and on commit creates a tt-comment mark + a thread record.
//
// Usage:
//   const addComment = useAddCommentFlow({ ydoc, scope, activePageId, currentUser, getEditor });
//   <button onClick={addComment.open}>+ Comment</button>
//   {addComment.node}
export function useAddCommentFlow({ ydoc, scope, activePageId, currentUser, getEditor }) {
  const [composer, setComposer] = useState(null);
  //   composer = { rect, from, to } | null

  const open = () => {
    const editor = getEditor?.();
    if (!editor) return;
    const sel = editor.state.selection;
    if (sel.empty) return;
    const winSel = window.getSelection();
    const rect = winSel?.rangeCount ? winSel.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect) return;
    setComposer({ rect, from: sel.from, to: sel.to });
  };

  const commit = (body) => {
    const editor = getEditor?.();
    if (!editor || !composer) { setComposer(null); return; }
    // addCommentThread generates and returns the id itself
    const id = addCommentThread(ydoc, {
      pageId: activePageId,
      body,
      author: currentUser?.name || currentUser?.email || 'You',
      authorColor: currentUser?.color || 'var(--soleil)',
      scope,
    });
    editor.chain().focus()
      .setTextSelection({ from: composer.from, to: composer.to })
      .setMark('comment', { id })
      .run();
    setComposer(null);
  };

  const node = composer && (
    <InlineComposer
      anchor={composer.rect}
      placeholder="Comment, then ⏎ to post"
      multiline
      commitLabel="Post"
      onCommit={commit}
      onCancel={() => setComposer(null)}
    />
  );

  return { open, node };
}
