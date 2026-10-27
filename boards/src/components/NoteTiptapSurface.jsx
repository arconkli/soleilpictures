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

import { scrubPastedHtml } from '../lib/pasteScrub.js';
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
  noteCommentScope,
  getNoteUndoManager,
  noteFragmentIsBlank,
} from '../lib/noteDocState.js';
import { bodyHasText } from '../lib/noteBody.js';
import { useAddCommentFlow } from './AddCommentFlow.jsx';
import { CommentInlinePopover } from './CommentInlinePopover.jsx';
import { linkifyNoteHtml } from '../lib/noteLinkify.js';
import { cardHeightForBody } from '../lib/noteMeasure.js';
import { sanitizeNoteHtml } from '../lib/sanitizeNoteHtml.js';
import { ensureFontsFromHtml } from '../lib/googleFonts.js';
import { setActiveNoteEditor } from '../lib/noteEditorRegistry.js';
import { anyModalOpen } from '../lib/modalGuard.js';
import { startTouchScrollGesture } from '../lib/touchScroll.js';
import { takeNoteTypeAhead } from '../lib/noteTypeAhead.js';
import './noteTiptap.css';

const NOTE_AUTOSIZE_MAX = 480;

// UI that belongs to this editing session, wherever it is portaled: focus or a
// click landing in any of these is still "in the note", not leaving it. The
// custom-font dialog (.cfont) is one: it takes focus for its name field, and
// reading that as an exit unmounted the bar that owns it, so the dialog
// vanished within a frame (NOTES-04). Modal hands focus back to the note when
// it closes. The toolbar's own menus (.tob-menu, and its size presets'
// .size-combo-tl) are portaled out of .tob, so they are named too.
const EDIT_SESSION_UI = '.tob, .tob-menu, .size-combo-tl, .cp-pop, .ctx-menu, .entity-picker, .cand-pop, .inline-composer, .comment-inline-pop, .cfont';
const inEditSessionUi = (el) => !!el?.closest?.(EDIT_SESSION_UI);

// Card height the READ-ONLY note needs when its html carries link previews.
// The live editor never contains the .note-link-preview blocks linkify
// appends to the cached html, so sizing from the editor alone left every note
// with a URL clipped after editing, behind a "Show all" chip (NOTES-07).
// Lays the html out once in a hidden .note-body inside the same note (same
// width, fonts and preview styles) and measures its natural height. That
// height doesn't depend on the card's, so taking the max with the editor's
// measure settles instead of growing on every flush. 0 when nothing to add.
function displayHeightWithPreviews(editorDom, html) {
  if (!html || html.indexOf('note-link-preview') < 0) return 0;
  const note = editorDom?.closest?.('.note');
  if (!note) return 0;
  const probe = document.createElement('div');
  probe.className = 'note-body';
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, {
    position: 'absolute', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none',
    width: `${editorDom.clientWidth}px`, height: 'auto', flex: 'none', overflow: 'visible',
  });
  probe.innerHTML = sanitizeNoteHtml(html);
  note.appendChild(probe);
  try { return cardHeightForBody(probe); } finally { probe.remove(); }
}

export function NoteTiptapSurface({
  ydoc,
  cardYMap,
  html,
  body,
  cardId = null,
  boardId = null,
  currentUser = null,
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
    // body too: a note dropped as text, or made by the API/MCP, has no html,
    // and seeding from html alone opened it empty and saved that over its text.
    seedNoteFragmentFromHtml(ydoc, cardYMap, html, body);
    return ensureNoteFragment(ydoc, cardYMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, cardYMap]);

  // The note's PERSISTENT UndoManager (cached per fragment in noteDocState) —
  // handing it to Collaboration below means Cmd+Z history survives closing
  // and reopening the note instead of dying with the editor view.
  const noteUndoManager = useMemo(
    () => (ydoc && cardYMap ? getNoteUndoManager(ydoc, cardYMap) : null),
    [ydoc, cardYMap]
  );

  // Word-level comments, same stack as the doc editor: the CommentMark carries
  // the anchor (inside the fragment, so the range survives concurrent edits)
  // and the thread bodies live in a Y.Map on this card. Notes have no pages and
  // no margin gutter — the highlighted text itself is the affordance.
  const commentScope = useMemo(
    () => (ydoc && cardYMap ? noteCommentScope(ydoc, cardYMap) : null),
    [ydoc, cardYMap],
  );
  const [openThread, setOpenThread] = useState(null); // { id, anchor } | null

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

  const addComment = useAddCommentFlow({
    ydoc,
    scope: commentScope,
    activePageId: null,          // notes have no pages
    currentUser,
    getEditor: () => editorRef.current,
    workspaceId,
    boardId,
    cardId,
  });

  const onEditorClick = (e) => {
    // Commented text opens its thread — the Google-Docs gesture, and the only
    // affordance notes have (no margin gutter: a note card is small and rides
    // the canvas zoom, so a fixed-size dot in the margin doesn't work).
    const commentEl = e.target?.closest?.('.tt-comment[data-comment-id]');
    if (commentEl) {
      setOpenThread({ id: commentEl.dataset.commentId, anchor: commentEl.getBoundingClientRect() });
      return;
    }
    onCandidateClick(e);
  };

  const onCandidateClick = (e) => {
    const candEl = e.target?.closest?.('.tt-candidate[data-name]');
    if (!candEl) return;
    setCandidatePrompt({
      anchor: candEl.getBoundingClientRect(),
      name: candEl.dataset.name || (candEl.textContent || '').trim(),
      count: Number(candEl.dataset.count) || 0,
      sample: candEl.dataset.sample || '',
      entityType: candEl.dataset.type || null,
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

  // The text write-through. `body: null` is what makes a deliberate emptying
  // stick (seedNoteFragmentFromHtml heals a blank fragment from a leftover
  // body), so it is written with the html, always together. The one write it
  // refuses: a blank fragment over a card that still has body text, before
  // this session ever saw the fragment hold anything. That is a failed seed,
  // not an edit, and saving it is how body-only notes were wiped (NOTES-01).
  const sawContentRef = useRef(false);
  const writeTextCache = () => {
    if (!fragment) return;
    const blank = noteFragmentIsBlank(fragment);
    if (!blank) sawContentRef.current = true;
    else if (!sawContentRef.current && bodyHasText(cardYMap?.get?.('body'))) return;
    const serialized = noteFragmentToHtml(fragment);
    // noteFragmentToHtml answers '' when it can't serialize (a node or mark
    // this build's schema doesn't know, say from a newer peer). From a
    // fragment that holds text that is a failure, not an edit: keep the cache.
    if (!serialized && !blank) return;
    // Previews the user removed stay removed (the card's hiddenPreviews).
    const html = linkifyNoteHtml(serialized, cardYMap?.get?.('hiddenPreviews'));
    writeCache({ html, body: null });
    return html;
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
      ...(fragment ? [Collaboration.configure({
        fragment,
        // Persistent per-note undo (see getNoteUndoManager). Without this the
        // yUndoPlugin mints a fresh manager per mount and destroys it on exit.
        ...(noteUndoManager ? { yUndoOptions: { undoManager: noteUndoManager } } : {}),
      })] : []),
    ],
    // The surface mounts ONLY to edit (double-click / tap / new card), so always
    // place the caret at the end on mount — matching the legacy editor, which
    // focused + collapsed-to-end on entry. (autoFocus prop kept for callers.)
    autofocus: 'end',
    editable: true,
    // What was typed while a new note waited for this editor (its chunk is
    // fetched at the session's first edit): the caret is at the end by now.
    onCreate: ({ editor: ed }) => {
      const ahead = takeNoteTypeAhead(cardId);
      if (!ahead) return;
      const chain = ed.chain().focus('end');
      ahead.split('\n').forEach((line, i) => {
        if (i) chain.splitBlock();
        if (line) chain.insertContent({ type: 'text', text: line });
      });
      chain.run();
    },
    editorProps: {
      // Foreign pastes lose their typography so the note's own font + size
      // hold. See pasteScrub.
      transformPastedHTML: scrubPastedHtml,
      attributes: {
        // The measurer (cardHeightForBody) and the note CSS both key off
        // .note-body — Tiptap must render INTO it.
        class: 'note-body',
        // Grammarly OFF on notes. Grammarly paints its underlines via its own
        // absolutely-positioned overlay, which does NOT follow the canvas's
        // `transform: scale(zoom)` — so at any zoom ≠ 100% its squiggles drift
        // left of the words (the "spellcheck misalignment" bug). Native
        // spellcheck is OFF too: Chromium paints its squiggles at untransformed
        // glyph coordinates (they do NOT follow an ancestor transform:scale),
        // so they misalign exactly the same way at any zoom ≠ 100%. Docs keep
        // native spellcheck because DocPageEditor scales via CSS `zoom`, which
        // the squiggle painter does follow.
        'data-gramm': 'false',
        'data-gramm_editor': 'false',
        'data-enable-grammarly': 'false',
        spellcheck: 'false',
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
        // Plain-dash lists: Enter on a top-level paragraph that starts with
        // "- " continues the prefix on the next line; Enter on a bare "- "
        // clears it and ends the run (the usual editor convention). Top-level
        // paragraphs ONLY (depth 1) — real list items and checklist items
        // keep their own Enter keymaps.
        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey
            && !event.ctrlKey && !event.altKey && !event.isComposing) {
          const { state } = view;
          const { $from, empty } = state.selection;
          if (empty && $from.depth === 1 && $from.parent.type.name === 'paragraph') {
            const text = $from.parent.textContent;
            if (/^- ?$/.test(text)) {
              const start = $from.start();
              view.dispatch(state.tr.delete(start, start + $from.parent.content.size));
              return true;
            }
            if (text.startsWith('- ') && $from.parentOffset >= 2) {
              editorRef.current?.chain().splitBlock().insertContent('- ').run();
              return true;
            }
          }
        }
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
    setActiveNoteEditor(editor, { openAddComment: addComment.open });
    return () => setActiveNoteEditor(null);
  }, [editor]);

  // Deleting a thread must also strip its highlight, or the note keeps a dead
  // underline pointing at nothing. CommentInlinePopover portals to <body>, so
  // it can't call the editor directly — same window event the doc editor uses.
  useEffect(() => {
    if (!editor) return undefined;
    const onRemove = (e) => {
      const id = e.detail?.id;
      if (id != null) { try { editor.commands.removeCommentById(id); } catch (_) {} }
    };
    window.addEventListener('soleil-remove-comment-mark', onRemove);
    return () => window.removeEventListener('soleil-remove-comment-mark', onRemove);
  }, [editor]);

  // Write-through card.html + auto-size on every edit (rAF-coalesced).
  useEffect(() => {
    if (!editor) return undefined;
    const flush = () => {
      writeRaf.current = 0;
      if (!fragment) return;
      let html = null;
      try { html = writeTextCache(); } catch (_) { /* noop */ }
      if (!manualRef.current && editor?.view?.dom) {
        try {
          const h = Math.min(NOTE_AUTOSIZE_MAX, Math.max(
            cardHeightForBody(editor.view.dom),
            displayHeightWithPreviews(editor.view.dom, html),
          ));
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
  // The comment composer and the thread popover belong to this editing
  // session: both portal to <body>, and both take focus (the composer focuses
  // its textarea on mount). Treating that as "left the note" unmounted this
  // surface and the composer with it, so a note comment could never be
  // written (NOTES-03). While either is open, a blur never exits.
  const commentUiOpen = !!addComment.node || !!openThread;
  const commentUiOpenRef = useRef(false);
  commentUiOpenRef.current = commentUiOpen;
  const exitEdit = () => {
    if (writeRaf.current) { cancelAnimationFrame(writeRaf.current); writeRaf.current = 0; }
    try { writeTextCache(); } catch (_) {}
    onExitRef.current?.();
  };
  useEffect(() => {
    if (!editor) return undefined;
    const onBlur = ({ event }) => {
      if (inEditSessionUi(event?.relatedTarget)) return;
      if (mentionOpenRef.current || commentUiOpenRef.current) return;
      exitEdit();
    };
    editor.on('blur', onBlur);
    return () => editor.off('blur', onBlur);
  }, [editor, fragment]);

  // The blur above is the only exit, so once focus has moved into a toolbar
  // field (the size box, the colour pad's hex) and then gone nowhere, the note
  // stayed in edit mode with nothing focused: a click on the canvas no longer
  // closed it, and opening another note left two "editing" (NOTES-13). A press
  // outside the note and its session UI, while the editor is not focused, is
  // that missing exit. A field still holding a typed value is blurred first,
  // so the value it commits on blur lands before the bar unmounts.
  useEffect(() => {
    if (!editor) return undefined;
    const onDown = (e) => {
      if (editor.isDestroyed || editor.isFocused) return;
      if (mentionOpenRef.current || commentUiOpenRef.current || anyModalOpen()) return;
      const t = e.target;
      if (editor.view.dom.contains(t) || inEditSessionUi(t)) return;
      const a = document.activeElement;
      if (a && a !== document.body && inEditSessionUi(a)) { try { a.blur(); } catch (_) {} }
      exitEdit();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // When the comment UI closes the editor no longer has focus, so the blur
  // that normally ends editing will never come. A click somewhere else on the
  // page (what closes the thread popover) was the user leaving the note: exit.
  // Posting, cancelling or Escape hands the caret back to the note instead.
  const clickedAwayRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (!commentUiOpen) return undefined;
    clickedAwayRef.current = false;
    const onDown = (e) => {
      const t = e.target;
      clickedAwayRef.current = !(
        t?.closest?.('.inline-composer') || t?.closest?.('.comment-inline-pop')
        || t?.closest?.('.entity-picker') || t?.closest?.('.feedback-bg')
        || (editor?.view?.dom && editor.view.dom.contains(t))
      );
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      if (!editor || editor.isDestroyed) return;
      // Let the closing click land first: it may itself focus the editor.
      setTimeout(() => {
        if (!mountedRef.current || editor.isDestroyed || editor.isFocused || commentUiOpenRef.current) return;
        if (clickedAwayRef.current) exitEdit();
        else editor.commands.focus();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentUiOpen, editor]);

  // Escape exits edit mode (collaborative edits are already shared — there is
  // no "revert" like the legacy note had).
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !mention) {
      e.preventDefault();
      editor?.commands.blur();
      return;
    }
    // ⌘⌥M — matches the doc editor's Add-comment shortcut so the gesture is
    // the same wherever you're typing. No-ops on an empty selection.
    if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'm' || e.key === 'M' || e.code === 'KeyM')) {
      e.preventDefault();
      addComment.open();
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
        onClick={onEditorClick}
        // While editing we stop propagation so canvas drags can't hijack
        // typing — which also means CanvasSurface's touch-scroll branch never
        // sees this gesture. Drive the note's own overflow scroll here instead
        // (`.canvas-wrap { touch-action: none }` rules out a native scroll).
        // No preventDefault: a tap must still place the caret.
        onPointerDown={(e) => { startTouchScrollGesture(e); e.stopPropagation(); }}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {addComment.node}
      {openThread && commentScope && (
        <CommentInlinePopover
          ydoc={ydoc} scope={commentScope} threadId={openThread.id}
          anchor={openThread.anchor} currentUser={currentUser}
          workspaceId={workspaceId} boardId={boardId} cardId={cardId}
          onClose={() => setOpenThread(null)}
        />
      )}
      {candidatePrompt && (
        <CandidatePromptPopover
          anchor={candidatePrompt.anchor}
          name={candidatePrompt.name}
          count={candidatePrompt.count}
          sample={candidatePrompt.sample}
          suggestedType={candidatePrompt.entityType}
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
