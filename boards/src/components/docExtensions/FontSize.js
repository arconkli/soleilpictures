// Font-size extension for Tiptap v2 (the official package only ships in v3).
// Adds a `fontSize` attribute to the TextStyle mark and exposes
// setFontSize / unsetFontSize commands.
//
// Usage: editor.chain().setFontSize('18px').run()

import { Extension } from '@tiptap/core';

export const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => el.style.fontSize?.replace(/['"]+/g, '') || null,
          renderHTML: (attrs) => {
            if (!attrs.fontSize) return {};
            return { style: `font-size: ${attrs.fontSize}` };
          },
        },
      },
    }];
  },

  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) =>
        chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) =>
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});
