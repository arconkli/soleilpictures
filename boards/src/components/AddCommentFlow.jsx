import { useCallback, useEffect, useRef, useState } from 'react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { encodeAnchor, resolveAnchor } from '../lib/bookmarkRelPos.js';
import { CommentPartHost, NewDocCommentPart } from './comments/commentPartHost.jsx';

// A new comment on the selected words, in a doc and in a note. The card it is
// written in is the shared one (comments/DocFloatCards.jsx NewDocComment, a
// CommentCard with no thread), kept beside the words while the page scrolls;
// the words wear a quiet tint until the comment is posted or put away.
//
// The MARK is the anchor: it rides inside the Y.XmlFragment, so the commented
// range survives concurrent edits with no stored offsets to remap. The doc
// editor and the note editor differ only in the scope (docState cardScope vs
// noteDocState noteCommentScope) and in that a note has no pages.
//
//   const addComment = useAddCommentFlow({ ydoc, scope, surface, activePageId, currentUser, getEditor, onPosted });
//   <button onClick={addComment.open}>Comment</button>
//   {addComment.node}
//
// open() answers false when there is nothing to comment on (no words
// selected, or a reader's editor), so the caller can say so.

const pendingKey = new PluginKey('cmtPending');
// The tint under the words a comment is being written on. A decoration, not
// a mark: nothing is written to the doc until the comment is.
const pendingPlugin = () => new Plugin({
  key: pendingKey,
  state: {
    init: () => null,
    apply(tr, was) {
      const set = tr.getMeta(pendingKey);
      if (set !== undefined) return set;
      if (!was || !tr.docChanged) return was;
      const from = tr.mapping.map(was.from, 1);
      const to = tr.mapping.map(was.to, -1);
      return to > from ? { from, to } : null;
    },
  },
  props: {
    decorations(state) {
      const at = pendingKey.getState(state);
      if (!at) return null;
      const size = state.doc.content.size;
      const from = Math.max(0, Math.min(at.from, size));
      const to = Math.max(from, Math.min(at.to, size));
      return to > from ? DecorationSet.create(state.doc, [Decoration.inline(from, to, { class: 'cmt-pending' })]) : null;
    },
  },
});

// Unsent words are kept for the words they were written about: a short,
// stable name for those words, so starting a comment on other words opens an
// empty box, and going back to the first ones finds what was typed.
function wordsKey(text) {
  let h = 5381;
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length.toString(36)}-${h.toString(36)}`;
}

// The nearest thing that scrolls the editor, whose edges hide the words.
function clipOf(el) {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

export function useAddCommentFlow({
  ydoc, scope, surface = 'doc', activePageId = null, currentUser, getEditor, guest = false,
  workspaceId = null, boardId = null, cardId = null, onPosted,
}) {
  const [draft, setDraft] = useState(null);
  //   draft = { editor, from, to, relFrom, relTo } | null
  const draftRef = useRef(null);
  draftRef.current = draft;
  const getEditorRef = useRef(getEditor);
  getEditorRef.current = getEditor;

  const drop = useCallback((editor) => {
    try { if (editor && !editor.isDestroyed) editor.unregisterPlugin(pendingKey); } catch (_) { /* gone with its editor */ }
  }, []);
  const close = useCallback((refocus) => {
    const d = draftRef.current;
    if (!d) return;
    drop(d.editor);
    setDraft(null);
    if (refocus === true) { try { d.editor.commands.focus(); } catch (_) { /* the editor went */ } }
  }, [drop]);
  useEffect(() => () => drop(draftRef.current?.editor), [drop]);

  // A note's thread was deleted and its Undo has gone by
  // (comments/docThreadOps.js): the words lose its mark, so nothing is left
  // in the text that points at a thread that is not there. Only where the
  // editor is open on those words and the thread is still gone.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    if (surface !== 'note') return undefined;
    const onGone = (e) => {
      const d = e.detail || {};
      if (!d.threadId || (cardId && d.cardId !== cardId)) return;
      const map = scopeRef.current?.comments;
      if (map && typeof map.has === 'function' && map.has(d.threadId)) return;
      const editor = getEditorRef.current?.();
      if (!editor || editor.isDestroyed || !editor.isEditable) return;
      try { editor.commands.removeCommentById(d.threadId); } catch (_) { /* the words stay as they are */ }
    };
    document.addEventListener('soleil-comment-gone', onGone);
    return () => document.removeEventListener('soleil-comment-gone', onGone);
  }, [surface, cardId]);

  // `given`: the editor the caret is in, when the caller knows it (a doc with
  // several sheets has one editor each; the toolbar's button names the one in use).
  const open = useCallback((given) => {
    const editor = (given && given.view && given.state ? given : null) || getEditorRef.current?.();
    // A read-only editor is a view-only reader: only people who can edit
    // write comments.
    if (!editor || editor.isDestroyed || !editor.isEditable) return false;
    const sel = editor.state.selection;
    if (sel.empty) return false;
    const was = draftRef.current;
    if (was) drop(was.editor);
    try {
      editor.registerPlugin(pendingPlugin());
      editor.view.dispatch(editor.state.tr.setMeta(pendingKey, { from: sel.from, to: sel.to }).setMeta('addToHistory', false));
    } catch (_) { /* no tint: the card still opens */ }
    // Yjs relative anchors too: the card stays open while people type, and a
    // collaborator's edit arrives as a whole-document replace that nothing
    // maps raw positions through.
    let words = '';
    try { words = editor.state.doc.textBetween(sel.from, sel.to, ' '); } catch (_) { /* kept under the page alone */ }
    setDraft({
      editor, from: sel.from, to: sel.to, words: wordsKey(words),
      relFrom: encodeAnchor(editor, sel.from), relTo: encodeAnchor(editor, sel.to),
    });
    return true;
  }, [drop]);

  // Where the words are now (the anchors follow a collaborator's edit).
  const range = (d) => {
    const { editor } = d;
    const size = editor.state.doc.content.size;
    const at = pendingKey.getState(editor.state);
    const from = Math.max(0, Math.min(resolveAnchor(editor, d.relFrom) ?? at?.from ?? d.from, size));
    const to = Math.max(0, Math.min(resolveAnchor(editor, d.relTo) ?? at?.to ?? d.to, size));
    return { from: Math.min(from, to), to: Math.max(from, to) };
  };
  // The card stands beside the editor's column, level with the words; null
  // while they are scrolled out of sight.
  const getRect = useCallback(() => {
    const d = draftRef.current;
    if (!d || d.editor.isDestroyed) return null;
    try {
      const { view } = d.editor;
      const { from, to } = range(d);
      const a = view.coordsAtPos(from);
      const b = view.coordsAtPos(to);
      // beside the page's column, or beside the note
      const col = ((surface === 'note' && view.dom.closest('[data-card-id]')) || view.dom).getBoundingClientRect();
      const top = Math.min(a.top, b.top);
      const bottom = Math.max(a.bottom, b.bottom);
      const clip = clipOf(view.dom)?.getBoundingClientRect();
      const lo = Math.max(0, clip ? clip.top : 0);
      const hi = Math.min(window.innerHeight, clip ? clip.bottom : window.innerHeight);
      if (bottom < lo || top > hi) return null;
      return { left: col.left, right: col.right, top, bottom };
    } catch (_) { return null; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const post = (id) => {
    const d = draftRef.current;
    if (!d || d.editor.isDestroyed) { setDraft(null); return; }
    const { from, to } = range(d);
    drop(d.editor);
    d.editor.chain().focus()
      .setTextSelection({ from, to })
      .setMark('comment', { id })
      // the caret after the words: a selection would hide how they look now
      .setTextSelection(to)
      .run();
    setDraft(null);
    onPosted?.(id);
  };

  const node = draft && (
    <CommentPartHost
      part={NewDocCommentPart}
      onFail={() => close()}
      ydoc={ydoc} scope={scope} surface={surface} pageId={activePageId}
      currentUser={currentUser} canEdit guest={guest}
      workspaceId={workspaceId} boardId={boardId} cardId={cardId}
      draftTarget={`${activePageId ? `new.${activePageId}` : 'new'}.${draft.words}`}
      getRect={getRect}
      onPost={post}
      onClose={close}
    />
  );

  return { open, node, isOpen: !!draft };
}
