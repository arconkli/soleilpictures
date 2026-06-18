// Collaborative editing surface for a note card. Mounted ONLY while a note is
// being edited (one at a time, keyed by the editing note), so we never pay for
// a Tiptap instance per canvas note. Binds a Tiptap editor to the note's own
// Y.XmlFragment via Collaboration → character-level co-typing with the same
// CRDT stack the Docs feature uses.
//
// Read-only display (every non-editing note, public /share, thumbnails) keeps
// rendering the derived `card.html` string, which this surface writes through
// on every edit. So the fragment is the collaborative source of truth and
// card.html is its cache.

import { useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import { noteExtensions } from './noteExtensions/noteExtensions.js';
import {
  ensureNoteFragment,
  seedNoteFragmentFromHtml,
  noteFragmentToHtml,
} from '../lib/noteDocState.js';
import { linkifyNoteHtml } from '../lib/noteLinkify.js';
import { cardHeightForBody } from '../lib/noteMeasure.js';
import { ensureFontsFromHtml } from '../lib/googleFonts.js';
import './noteTiptap.css';

const NOTE_AUTOSIZE_MAX = 480;

export function NoteTiptapSurface({
  ydoc,
  cardYMap,
  html,
  manuallyResized = false,
  autoFocus = false,
  onChangeHTML,
  onAutoSize,
  onExitEdit,
}) {
  // Resolve (and lazily seed) the fragment ONCE for this editing session.
  const fragment = useMemo(() => {
    if (!ydoc || !cardYMap) return null;
    ensureNoteFragment(ydoc, cardYMap);
    // Seed from legacy html on first-ever edit (idempotent, guarded).
    seedNoteFragmentFromHtml(ydoc, cardYMap, html);
    return ensureNoteFragment(ydoc, cardYMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, cardYMap]);

  const writeRaf = useRef(0);
  const manualRef = useRef(manuallyResized);
  manualRef.current = manuallyResized;
  const onChangeRef = useRef(onChangeHTML);
  onChangeRef.current = onChangeHTML;
  const onAutoSizeRef = useRef(onAutoSize);
  onAutoSizeRef.current = onAutoSize;
  const onExitRef = useRef(onExitEdit);
  onExitRef.current = onExitEdit;

  const editor = useEditor({
    extensions: [
      ...noteExtensions,
      Placeholder.configure({ placeholder: 'Write a note…', showOnlyWhenEditable: true }),
      ...(fragment ? [Collaboration.configure({ fragment })] : []),
    ],
    autofocus: autoFocus ? 'end' : false,
    editable: true,
    editorProps: {
      attributes: {
        // The measurer (createNoteMeasurer / cardHeightForBody) and the note
        // CSS both key off .note-body — Tiptap must render INTO it.
        class: 'note-body',
        // Tiptap/ProseMirror manages its own selection and is immune to the
        // Grammarly overlay that breaks a raw contenteditable's drag-select,
        // so (unlike the legacy note) we can leave Grammarly on, matching docs.
        'data-gramm': 'true',
        spellcheck: 'true',
      },
    },
    // Create once for this editing session; the fragment is stable per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragment]);

  // Write-through card.html + auto-size on every edit (rAF-coalesced).
  useEffect(() => {
    if (!editor) return undefined;
    const flush = () => {
      writeRaf.current = 0;
      if (!fragment) return;
      try {
        const cached = linkifyNoteHtml(noteFragmentToHtml(fragment));
        onChangeRef.current?.(cached);
      } catch (_) { /* noop */ }
      // Auto-size to content unless the user pinned a height.
      if (!manualRef.current && editor?.view?.dom) {
        try {
          const h = Math.min(NOTE_AUTOSIZE_MAX, cardHeightForBody(editor.view.dom));
          onAutoSizeRef.current?.(h);
        } catch (_) { /* noop */ }
      }
    };
    const onUpdate = () => {
      if (writeRaf.current) cancelAnimationFrame(writeRaf.current);
      writeRaf.current = requestAnimationFrame(flush);
    };
    editor.on('update', onUpdate);
    // Inject any Google-catalog fonts referenced by the seeded content.
    try { ensureFontsFromHtml(editor.getHTML()); } catch (_) { /* noop */ }
    // One measure on open so a seeded note sizes correctly.
    onUpdate();
    return () => {
      editor.off('update', onUpdate);
      if (writeRaf.current) cancelAnimationFrame(writeRaf.current);
    };
  }, [editor, fragment]);

  // Exit edit on blur — unless focus is moving into the formatting toolbar /
  // a popover (mirrors the legacy commit's relatedTarget guard).
  useEffect(() => {
    if (!editor) return undefined;
    const onBlur = ({ event }) => {
      const next = event?.relatedTarget;
      if (next && (next.closest?.('.tob') || next.closest?.('.cp-pop') || next.closest?.('.ctx-menu'))) {
        return;
      }
      // Force a final synchronous write-through before exiting.
      if (writeRaf.current) { cancelAnimationFrame(writeRaf.current); writeRaf.current = 0; }
      if (fragment) {
        try { onChangeRef.current?.(linkifyNoteHtml(noteFragmentToHtml(fragment))); } catch (_) {}
      }
      onExitRef.current?.();
    };
    editor.on('blur', onBlur);
    return () => editor.off('blur', onBlur);
  }, [editor, fragment]);

  // Escape exits edit mode (collaborative edits are already shared — there is
  // no "revert" like the legacy note had).
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      editor?.commands.blur();
    }
  };

  if (!editor) return <div className="note-body" />;
  return (
    <EditorContent
      editor={editor}
      className="note-edit-wrap"
      onKeyDown={onKeyDown}
      // Stop canvas drag/marquee from starting on a pointerdown inside the note.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
