// Comment mark — wraps a range of text and ties it to a comment thread by id.
// Visual: a soft tint + dotted underline (.tt-comment).
//
// The mark IS the anchor: because it rides inside the Y.XmlFragment, the
// commented range survives concurrent edits for free — no stored offsets, and
// nothing to remap. The thread record itself (body, replies, resolved) lives in
// the `docComments` Y.Map, keyed by this id.
//
// Clicking the mark opens its thread. That's handled by the hosts, which read
// data-comment-id off the clicked span: DocPageEditor.handleEditorClick for
// docs, NoteTiptapSurface / NoteCardCollab for notes.
//
// Shared by BOTH schemas — components/docExtensions/baseExtensions.js and
// components/noteExtensions/noteExtensions.js — so a commented note round-trips
// through noteDocState's generateHTML/generateJSON with the span intact.

import { Mark, mergeAttributes } from '@tiptap/core';

export const CommentMark = Mark.create({
  name: 'comment',
  // Allow other inline marks (bold etc.) to coexist on commented text.
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      id: { default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => attrs.id ? { 'data-comment-id': attrs.id } : {},
      },
    };
  },

  parseHTML() { return [{ tag: 'span[data-comment-id]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'tt-comment' }), 0];
  },

  addCommands() {
    return {
      setComment: (id) => ({ chain }) => chain().setMark('comment', { id }).run(),
      unsetComment: () => ({ chain }) => chain().unsetMark('comment').run(),
      // Remove the comment mark with a specific id wherever it appears in the
      // doc. Used when a thread is deleted so its highlight doesn't linger as a
      // dead underline with no thread behind it. (removeMark doesn't shift
      // positions, so iterating original positions is safe.)
      removeCommentById: (id) => ({ state, dispatch }) => {
        const markType = state.schema.marks.comment;
        if (!markType || id == null) return false;
        const tr = state.tr;
        let found = false;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return;
          const m = node.marks.find(mk => mk.type === markType && mk.attrs.id === id);
          if (m) { tr.removeMark(pos, pos + node.nodeSize, m); found = true; }
        });
        if (found && dispatch) dispatch(tr);
        return found;
      },
    };
  },
});
