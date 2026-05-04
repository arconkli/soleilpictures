// Replaces @tiptap/extension-link.
// Stores only a linkId — the actual targets/name live in
// ydoc.getMap('links') and are looked up at render time by the
// LinkRenderer plugin (Task 2.4).
//
// parseHTML accepts both the new <span data-link-id> format and the
// legacy <a href> format. Legacy links get a synthetic linkId so they
// don't lose their place in the doc; the renderer falls back to the
// raw href when the Y.Map lookup misses (broken-link state until a
// migration backfills the records).

import { Mark, mergeAttributes } from '@tiptap/core';

export const LinkMark = Mark.create({
  name: 'link',

  addOptions() {
    return {
      HTMLAttributes: { class: 'tt-link' },
    };
  },

  addAttributes() {
    return {
      linkId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-link-id') || null,
        renderHTML: (attrs) => attrs.linkId ? { 'data-link-id': attrs.linkId } : {},
      },
      // Legacy fallback so old <a href> serializations don't lose data.
      href: {
        default: null,
        parseHTML: (el) => el.getAttribute('href') || null,
        renderHTML: () => ({}),  // renderer plugin handles styling/href separately
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-link-id]' },
      { tag: 'a[href]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setLinkMark: (linkId) => ({ commands }) => commands.setMark(this.name, { linkId }),
      unsetLinkMark: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});
