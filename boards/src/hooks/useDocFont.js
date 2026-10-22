import { useRef } from 'react';
import { ensureGoogleFontLoaded } from '../lib/googleFonts.js';
import { addRecentFont } from '../lib/customFonts.js';

// A doc bar's font: set one, and preview one while the pointer rests on it in
// the list, put back as it was if the list closes without a pick. Shared by
// the doc's bar (DocToolbar) and the doc look's (components/doc/DocBarA.jsx).
//
//   const font = useDocFont(editor);
//   font.preview(css)   // css, '' for the doc's own, or null for the font
//                       // the list opened on; { focus: false } from a
//                       // keyboard walking the list
//   font.commit(entry)  // { css, gfName?, label | name }; css '' for the
//                       // doc's own
//   font.cancel()       // the list closed without a pick
export function useDocFont(editor) {
  const setFont = (css, gfName, label) => {
    if (gfName) ensureGoogleFontLoaded(gfName);
    if (!css) { editor?.chain().focus().unsetFontFamily().run(); return; }
    editor?.chain().focus().setFontFamily(css).run();
    if (label) addRecentFont({ name: label, css, gfName });
  };

  // The font that was on when the list opened, to go back to.
  const previewBaseRef = useRef(null);
  const preview = (css, { focus = true } = {}) => {
    if (!editor) return;
    if (previewBaseRef.current === null) {
      previewBaseRef.current = editor.getAttributes('textStyle')?.fontFamily ?? '';
    }
    // Re-focus the editor on every preview tick so the selection stays
    // visually highlighted while the user hovers fonts. Without this,
    // the browser greys out the selection (focus is technically on the
    // popover row), making it hard to see what's being restyled. Not for a
    // keyboard walking the list: the focus is on its row.
    const chain = () => (focus ? editor.chain().focus() : editor.chain());
    if (css == null) {
      const base = previewBaseRef.current;
      if (base) chain().setMeta('addToHistory', false).setFontFamily(base).run();
      else      chain().setMeta('addToHistory', false).unsetFontFamily().run();
    } else if (!css) {
      chain().setMeta('addToHistory', false).unsetFontFamily().run();
    } else {
      chain().setMeta('addToHistory', false).setFontFamily(css).run();
    }
  };
  const cancel = () => {
    const base = previewBaseRef.current;
    if (base !== null && editor) {
      if (base) editor.chain().setMeta('addToHistory', false).setFontFamily(base).run();
      else      editor.chain().setMeta('addToHistory', false).unsetFontFamily().run();
    }
    previewBaseRef.current = null;
  };
  const commit = (entry) => {
    previewBaseRef.current = null;
    setFont(entry.css, entry.gfName || null, entry.label || entry.name);
  };
  return { preview, cancel, commit };
}
