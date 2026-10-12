import { useState } from 'react';
import { InlineComposer } from './InlineComposer.jsx';
import { addCommentThread } from '../lib/docState.js';
import { notifyCommentMentions } from '../lib/commentMentions.js';
import { encodeAnchor, resolveAnchor } from '../lib/bookmarkRelPos.js';

// Imperative helper: opens an InlineComposer next to the live editor
// selection and on commit creates a tt-comment mark + a thread record.
//
// The MARK is the anchor — because it rides inside the Y.XmlFragment the
// commented range survives concurrent edits with no stored offsets to remap.
// Shared by the doc editor and note cards; the only difference is the scope
// (docState cardScope vs noteDocState noteCommentScope) and that notes have no
// pages, so they pass activePageId = null.
//
// Usage:
//   const addComment = useAddCommentFlow({ ydoc, scope, activePageId, currentUser, getEditor });
//   <button onClick={addComment.open}>+ Comment</button>
//   {addComment.node}
export function useAddCommentFlow({
  ydoc, scope, activePageId, currentUser, getEditor,
  // Optional — enables @-mentions in the composer and the notification that
  // follows. Without them the composer is plain text, exactly as before.
  workspaceId = null, boardId = null, cardId = null,
}) {
  const [composer, setComposer] = useState(null);
  //   composer = { rect, from, to, relFrom, relTo } | null

  const open = () => {
    const editor = getEditor?.();
    // A read-only editor is a view-only reader: their thread would never
    // leave the tab (the board room drops a viewer's writes).
    if (!editor || !editor.isEditable) return;
    const sel = editor.state.selection;
    if (sel.empty) return;
    const winSel = window.getSelection();
    const rect = winSel?.rangeCount ? winSel.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect) return;
    // Also keep Yjs relative anchors: the composer stays open while people
    // type, and a collaborator's edit arrives as a whole-document replace
    // that nothing maps raw positions through. Without them the highlight
    // landed on whatever text had shifted under the old offsets.
    setComposer({
      rect, from: sel.from, to: sel.to,
      relFrom: encodeAnchor(editor, sel.from), relTo: encodeAnchor(editor, sel.to),
    });
  };

  const commit = (body, { mentions = [] } = {}) => {
    const editor = getEditor?.();
    if (!editor || !composer) { setComposer(null); return; }
    // addCommentThread generates and returns the id itself
    const id = addCommentThread(ydoc, {
      pageId: activePageId,
      body,
      author: currentUser?.name || currentUser?.email || 'You',
      authorId: currentUser?.id || null,
      authorColor: currentUser?.color || 'var(--soleil)',
      mentions,
      scope,
    });
    const size = editor.state.doc.content.size;
    const rf = resolveAnchor(editor, composer.relFrom);
    const rt = resolveAnchor(editor, composer.relTo);
    const from = Math.max(0, Math.min(rf ?? composer.from, size));
    const to = Math.max(0, Math.min(rt ?? composer.to, size));
    editor.chain().focus()
      .setTextSelection({ from, to })
      .setMark('comment', { id })
      .run();
    // Fire-and-forget: a failed notification must never cost the user their
    // comment, which is already committed to the CRDT above.
    notifyCommentMentions({ workspaceId, boardId, cardId, threadId: id, userIds: mentions, preview: body });
    setComposer(null);
  };

  const node = composer && (
    <InlineComposer
      anchor={composer.rect}
      placeholder="Comment, then ⏎ to post"
      multiline
      commitLabel="Post"
      workspaceId={workspaceId}
      onCommit={commit}
      onCancel={() => setComposer(null)}
    />
  );

  return { open, node };
}
