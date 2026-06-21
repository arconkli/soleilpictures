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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import { noteExtensions } from './noteExtensions/noteExtensions.js';
import { NoteMentionExtension } from './noteExtensions/NoteMentionExtension.js';
import { NotePresence } from './NotePresence.jsx';
import { EntityPicker } from './EntityPicker.jsx';
import { useEntityTrie } from '../hooks/useEntityNameTrie.js';
import { recordEntityLinks } from '../lib/recordEntityLinks.js';
import { coerceRef } from '../lib/entityRef.js';
import { makeCandidateNamePlugin } from './docExtensions/CandidateNamePlugin.js';
import { ReadableColors } from './docExtensions/ReadableColors.js';
import { useCandidateTagging } from '../hooks/useCandidateTagging.js';
import { CandidatePromptPopover } from './CandidatePromptPopover.jsx';
import { tagCard } from '../lib/tagsApi.js';
import { useFeedback } from './AppFeedback.jsx';
import {
  ensureNoteFragment,
  seedNoteFragmentFromHtml,
  noteFragmentToHtml,
  setNoteCacheFields,
} from '../lib/noteDocState.js';
import { linkifyNoteHtml } from '../lib/noteLinkify.js';
import { cardHeightForBody } from '../lib/noteMeasure.js';
import { ensureFontsFromHtml } from '../lib/googleFonts.js';
import { setActiveNoteEditor } from '../lib/noteEditorRegistry.js';
import './noteTiptap.css';

const NOTE_AUTOSIZE_MAX = 480;

export function NoteTiptapSurface({
  ydoc,
  cardYMap,
  html,
  cardId = null,
  boardId = null,
  awareness = null,
  manuallyResized = false,
  autoFocus = false,
  onExitEdit,
}) {
  const { workspaceId } = useEntityTrie();
  const feedback = useFeedback();

  // Resolve (and lazily seed) the fragment ONCE for this editing session.
  const fragment = useMemo(() => {
    if (!ydoc || !cardYMap) return null;
    ensureNoteFragment(ydoc, cardYMap);
    seedNoteFragmentFromHtml(ydoc, cardYMap, html);
    return ensureNoteFragment(ydoc, cardYMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, cardYMap]);

  const writeRaf = useRef(0);
  const editorRef = useRef(null);
  const manualRef = useRef(manuallyResized);
  manualRef.current = manuallyResized;
  const onExitRef = useRef(onExitEdit);
  onExitRef.current = onExitEdit;

  // In-context candidate-name discovery (shared with the doc editor). Notes
  // have no range-underline infra, so a promote tags the whole note card
  // (it joins the tag's cross-board collection) rather than pinning a span.
  const {
    candidateIndexRef,
    candidatePrompt, setCandidatePrompt,
    candidateBusy, promoteCandidate, dismissCandidate,
  } = useCandidateTagging({
    editorRef, workspaceId,
    notify: (t) => feedback.toast(t),
    applyPromotedTag: async (tag) => {
      if (!tag?.id || !cardId || !boardId) return false;
      await tagCard({ workspaceId, boardId, cardId, tagId: tag.id, source: 'user' });
      return true;
    },
  });
  const candidateExt = useMemo(() => Extension.create({
    name: 'soleilNoteCandidateNames',
    addProseMirrorPlugins: () => [makeCandidateNamePlugin({
      getIndex: () => candidateIndexRef.current,
    })],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const onCandidateClick = (e) => {
    const candEl = e.target?.closest?.('.tt-candidate[data-name]');
    if (!candEl) return;
    setCandidatePrompt({
      anchor: candEl.getBoundingClientRect(),
      name: candEl.dataset.name || (candEl.textContent || '').trim(),
      count: Number(candEl.dataset.count) || 0,
      sample: candEl.dataset.sample || '',
      el: candEl,
    });
  };

  // Write the derived html + auto-size height onto the card map under
  // NOTE_ORIGIN (off the board undo stack; persisted + synced). Readers
  // (canvas display, thumbnails, card_index) pick it up via the normal
  // ydoc → readCards path.
  const writeCache = (patch) => {
    if (ydoc && cardYMap) setNoteCacheFields(ydoc, cardYMap, patch);
  };

  // @-mention picker state, driven by the suggestion plugin.
  const [mention, setMention] = useState(null); // { range, query, clientRect } | null
  const mentionExt = useMemo(() => NoteMentionExtension({
    onStart: (props) => {
      setMention({ range: props.range, query: props.query, clientRect: props.clientRect?.() || null });
      return () => setMention(null);
    },
    onUpdate: (props) => {
      setMention({ range: props.range, query: props.query, clientRect: props.clientRect?.() || null });
    },
    onKeyDown: () => false, // the picker handles its own arrow/enter/escape
  }), []);

  const editor = useEditor({
    extensions: [
      ...noteExtensions,
      Placeholder.configure({ placeholder: 'Write a note…', showOnlyWhenEditable: true }),
      mentionExt,
      candidateExt,
      // Keep per-span colors readable on this note's surface in both themes
      // (scoped stylesheet override; never mutates content).
      ReadableColors,
      ...(fragment ? [Collaboration.configure({ fragment })] : []),
    ],
    // The surface mounts ONLY to edit (double-click / tap / new card), so always
    // place the caret at the end on mount — matching the legacy editor, which
    // focused + collapsed-to-end on entry. (autoFocus prop kept for callers.)
    autofocus: 'end',
    editable: true,
    editorProps: {
      attributes: {
        // The measurer (cardHeightForBody) and the note CSS both key off
        // .note-body — Tiptap must render INTO it.
        class: 'note-body',
        // Grammarly OFF on notes. Grammarly paints its underlines via its own
        // absolutely-positioned overlay, which does NOT follow the canvas's
        // `transform: scale(zoom)` — so at any zoom ≠ 100% its squiggles drift
        // left of the words (the "spellcheck misalignment" bug). Native
        // spellcheck underlines are painted INTO the text layer, so they scale
        // with the canvas and stay aligned. (The legacy RichNoteEditor already
        // turns Grammarly off; we now match it here.)
        'data-gramm': 'false',
        'data-gramm_editor': 'false',
        'data-enable-grammarly': 'false',
        spellcheck: 'true',
      },
      // Toggle a checklist item by clicking its box, even mid-edit.
      handleClickOn: (view, pos, _node, _nodePos, event) => {
        if (!event.target?.closest?.('.ck-box')) return false;
        const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
        for (let d = $pos.depth; d > 0; d--) {
          const n = $pos.node(d);
          if (n.type.name === 'noteChecklistItem') {
            const itemPos = $pos.before(d);
            view.dispatch(view.state.tr.setNodeMarkup(itemPos, undefined, { ...n.attrs, checked: !n.attrs.checked }));
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
      // Tab inserts two spaces (legacy note behaviour); Shift-Tab falls through
      // to the checklist lift keymap.
      handleKeyDown: (view, event) => {
        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          view.dispatch(view.state.tr.insertText('  '));
          return true;
        }
        return false;
      },
    },
    // Create once for this editing session; the fragment is stable per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragment]);

  editorRef.current = editor;

  // Register as the active note editor so the bottom toolbar drives it.
  useEffect(() => {
    if (!editor) return undefined;
    setActiveNoteEditor(editor);
    return () => setActiveNoteEditor(null);
  }, [editor]);

  // Write-through card.html + auto-size on every edit (rAF-coalesced).
  useEffect(() => {
    if (!editor) return undefined;
    const flush = () => {
      writeRaf.current = 0;
      if (!fragment) return;
      try {
        writeCache({ html: linkifyNoteHtml(noteFragmentToHtml(fragment)), body: null });
      } catch (_) { /* noop */ }
      if (!manualRef.current && editor?.view?.dom) {
        try {
          const h = Math.min(NOTE_AUTOSIZE_MAX, cardHeightForBody(editor.view.dom));
          writeCache({ h: Math.round(h) });
        } catch (_) { /* noop */ }
      }
    };
    const onUpdate = () => {
      if (writeRaf.current) cancelAnimationFrame(writeRaf.current);
      writeRaf.current = requestAnimationFrame(flush);
    };
    editor.on('update', onUpdate);
    try { ensureFontsFromHtml(editor.getHTML()); } catch (_) { /* noop */ }
    onUpdate(); // one measure on open so a seeded note sizes correctly
    return () => {
      editor.off('update', onUpdate);
      if (writeRaf.current) cancelAnimationFrame(writeRaf.current);
    };
  }, [editor, fragment]);

  // Exit edit on blur — unless focus is moving into the formatting toolbar /
  // a popover, or the @-mention picker is open (clicking a row blurs the editor).
  const mentionOpenRef = useRef(false);
  mentionOpenRef.current = !!mention;
  useEffect(() => {
    if (!editor) return undefined;
    const onBlur = ({ event }) => {
      const next = event?.relatedTarget;
      if (next && (next.closest?.('.tob') || next.closest?.('.cp-pop') || next.closest?.('.ctx-menu') || next.closest?.('.entity-picker') || next.closest?.('.cand-pop'))) {
        return;
      }
      if (mentionOpenRef.current) return;
      if (writeRaf.current) { cancelAnimationFrame(writeRaf.current); writeRaf.current = 0; }
      if (fragment) {
        try { writeCache({ html: linkifyNoteHtml(noteFragmentToHtml(fragment)), body: null }); } catch (_) {}
      }
      onExitRef.current?.();
    };
    editor.on('blur', onBlur);
    return () => editor.off('blur', onBlur);
  }, [editor, fragment]);

  // Escape exits edit mode (collaborative edits are already shared — there is
  // no "revert" like the legacy note had).
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !mention) {
      e.preventDefault();
      editor?.commands.blur();
    }
  };

  const commitMention = (targets) => {
    const ed = editorRef.current;
    const t = targets?.[0];
    if (!ed || !t || !mention) { setMention(null); return; }
    const ref = coerceRef(t);
    if (!ref) { setMention(null); return; }
    const label = t.title || t.name || ref.kind || 'mention';
    ed.chain().focus()
      .deleteRange(mention.range)
      .insertContent([
        { type: 'noteMention', attrs: { entityRef: ref, label } },
        { type: 'text', text: ' ' },
      ])
      .run();
    if (cardId && workspaceId) {
      recordEntityLinks({
        source: { kind: 'note', id: cardId, workspace: workspaceId, boardId },
        refs: [{ ref }],
      }).catch(() => {});
    }
    setMention(null);
  };

  if (!editor) return <div className="note-body" />;
  return (
    <>
      <EditorContent
        editor={editor}
        className="note-edit-wrap"
        onKeyDown={onKeyDown}
        onClick={onCandidateClick}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {candidatePrompt && (
        <CandidatePromptPopover
          anchor={candidatePrompt.anchor}
          name={candidatePrompt.name}
          count={candidatePrompt.count}
          sample={candidatePrompt.sample}
          busy={candidateBusy}
          onPromote={promoteCandidate}
          onDismiss={dismissCandidate}
          onClose={() => setCandidatePrompt(null)}
        />
      )}
      {mention && workspaceId && (
        <EntityPicker
          workspaceId={workspaceId}
          anchor={mention.clientRect}
          initialQuery={mention.query}
          onCommit={commitMention}
          onCancel={() => setMention(null)}
        />
      )}
      {awareness && (
        <NotePresence editor={editor} awareness={awareness} boardId={boardId} cardId={cardId} />
      )}
    </>
  );
}
