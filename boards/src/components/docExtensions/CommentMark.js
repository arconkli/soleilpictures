// Comment mark — wraps a range of text and ties it to a comment thread by id.
// Visual: a highlighted underline in the comment color. Click the mark to
// open its thread in the side panel (handled by the host via a CustomEvent).

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
