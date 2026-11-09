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

import { isInternalPaste, scrubPastedHtml } from '../lib/pasteScrub.js';
import { noteTextSlice, dropEmptyTextStyle } from '../lib/notePaste.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  stripNoteChromeForSeed,
} from '../lib/noteDocState.js';
import { bodyHasText, htmlHasContent, htmlHasText } from '../lib/noteBody.js';
import { useAddCommentFlow } from './AddCommentFlow.jsx';
import { CommentInlinePopover } from './CommentInlinePopover.jsx';
import { linkifyNoteHtml } from '../lib/noteLinkify.js';
import { cardHeightForBody, cardHeightForContent } from '../lib/noteMeasure.js';
import { ySyncPluginKey } from 'y-prosemirror';
import { sanitizeNoteHtml } from '../lib/sanitizeNoteHtml.js';
import { ensureFontsFromHtml } from '../lib/googleFonts.js';
import { setActiveNoteEditor, ensureClientRectVisible } from '../lib/noteEditorRegistry.js';
import { anyModalOpen } from '../lib/modalGuard.js';
import { coarsePointer, noteTypingAttrs, typingBand, clampToBox } from '../lib/noteTouchTyping.js';
import { startTouchScrollGesture } from '../lib/touchScroll.js';
import { takeNoteTypeAhead } from '../lib/noteTypeAhead.js';
import { releaseTouchKeyboard, touchKeyboardHeld } from '../lib/touchKeyboard.js';
import { createNoteUndoRoute } from '../lib/noteUndoRoute.js';
import { noteEntryRange } from '../lib/noteEntryPoint.js';
import { inertContainer } from '../lib/inertHtml.js';
import { TextSelection } from '@tiptap/pm/state';
import './noteTiptap.css';
import { isComposingKey } from '../lib/composerKeys.js';

const NOTE_AUTOSIZE_MAX = 480;
// The "Show all" ceiling (the chip in cards.jsx NoteCardCollab). A note that
// was already taller than NOTE_AUTOSIZE_MAX when it opened grows up to this
// instead, so editing never cuts a note shown in full back to 480.
const NOTE_SHOW_ALL_MAX = 1600;
// A co-editor's typing arrives here through y-sync. Their own client writes
// the html cache at once; this one re-derives it only after they pause, so
// some client always leaves html matching the merged note.
const REMOTE_CACHE_DEBOUNCE_MS = 400;

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

// The link-preview cards of the note's cached html (linkify appends them; the
// fragment never holds them), drawn under the editor so a note keeps them while
// it is edited instead of opening a blank band where they were. Parsed inert,
// then sanitized like every other render of note html.
function previewBlocksHtml(html) {
  if (!html || html.indexOf('note-link-preview') < 0) return '';
  const root = inertContainer(html);
  const blocks = Array.from(root.querySelectorAll('.note-link-preview')).map((n) => n.outerHTML).join('');
  return blocks ? sanitizeNoteHtml(blocks) : '';
}

function selectRange(view, r) {
  const { doc } = view.state;
  view.dispatch(view.state.tr.setSelection(TextSelection.between(doc.resolve(r.from), doc.resolve(r.to))));
  // EditorView.focus() focuses with preventScroll, and the transaction above
  // never asked for scrollIntoView: nothing on the canvas or in the note moves.
  view.focus();
}

// Put the selection where the gesture that opened the note landed (see
// lib/noteEntryPoint.js). The end when the point maps to nothing.
function placeAtEntry(ed, entry, tries = 0, done = null) {
  if (!ed || ed.isDestroyed) return;
  const view = ed.view;
  if (!view.dom.isConnected && tries < 3) {
    requestAnimationFrame(() => placeAtEntry(ed, entry, tries + 1, done));
    return;
  }
  try {
    if (entry.scrollTop) view.dom.scrollTop = entry.scrollTop;
    const r = noteEntryRange(view, entry);
    if (r) { selectRange(view, r); done?.(); return; }
  } catch (_) { /* fall through to the end */ }
  ed.commands.focus('end');
  done?.();
}

// Text typed before the editor came, put in at the caret as if typed there.
// A line break is the Enter key itself, run through the editor's own key
// handling, so in a list or a checklist it starts the next item as Enter does
// there (a bare splitBlock left a second paragraph inside the item).
function pressEnter(ed) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
  ed.view.someProp('handleKeyDown', (f) => f(ed.view, event));
}
function replayTyped(ed, text) {
  text.split('\n').forEach((line, i) => {
    if (i) pressEnter(ed);
    if (line) ed.commands.insertContent({ type: 'text', text: line });
  });
}

// A finger opened this note, and the keyboard keeper (lib/touchKeyboard.js)
// has held the keyboard since the tap. The editor takes the focus first, then
// the keeper goes: iOS keeps the keyboard up for a move from one editable to
// another, never for one through the page. What was typed into the keeper
// goes in at the caret as if typed there (replayTyped), as the desktop
// type-ahead does.
// It hands over once the editor really has the focus (until then the keeper
// keeps both), or after ten frames without it.
function handOffTouchKeyboard(ed, cardId, tries = 0) {
  if (!ed || ed.isDestroyed || !touchKeyboardHeld(cardId)) return;
  if (!ed.view.hasFocus() && ed.view.dom.isConnected) ed.view.focus();
  if (!ed.view.hasFocus()) {
    // Not on screen yet: the keeper keeps the keyboard and the typing until
    // it is. If the editor still can't take the focus after ten frames, it
    // takes the typing anyway and the keeper goes (the keyboard with it; a
    // tap on the note brings it back), so nothing typed is ever lost.
    if (tries < 10) {
      requestAnimationFrame(() => handOffTouchKeyboard(ed, cardId, tries + 1));
      return;
    }
  }
  const typed = releaseTouchKeyboard(cardId);
  if (typed) replayTyped(ed, typed);
}

// Where the caret goes as a note opens, then the hand-over from whatever held
// the typing meanwhile (lib/noteTypeAhead.js for a keyboard, the keeper for a
// finger). Runs once the editor is on screen (the open effect).
function openEditor(ed, cardId, entry) {
  if (!ed || ed.isDestroyed) return;
  const ahead = takeNoteTypeAhead(cardId);
  // Opened by a double-click or tap: the caret (or, for a mouse, the word)
  // goes where it landed. Not Tiptap's focus() there: it scrolls the
  // selection into view, which jumped a long note to its last line.
  if (!ahead && entry) {
    placeAtEntry(ed, entry, 0, () => handOffTouchKeyboard(ed, cardId));
    return;
  }
  // A new note, or typed-ahead text: the caret at the end, as the legacy
  // editor did.
  ed.commands.focus('end');
  ed.view.focus();
  if (ahead) replayTyped(ed, ahead);
  // Never leave a keeper behind (a touch-and-trackpad iPad can have both).
  handOffTouchKeyboard(ed, cardId);
}

// Seeding the note's fragment and creating its comment map write to the
// board's Y.Doc, and the canvas re-renders from its Y.Doc observers. Done in
// render (the useMemos below used to do it on a note's first open), that
// update reached the parent mid-render: React's "Cannot update a component
// while rendering a different component". So it happens here, in a layout
// effect, before the editor is built. The render it schedules runs before the
// browser paints, so nothing flickers, and the editor's own calls below
// (ensureNoteFragment, seedNoteFragmentFromHtml, noteCommentScope,
// getNoteUndoManager) then find the work done and write nothing.
export function NoteTiptapSurface(props) {
  const { ydoc, cardYMap, html, body } = props;
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (ydoc && cardYMap) {
      try {
        seedNoteFragmentFromHtml(ydoc, cardYMap, html, body);
        noteCommentScope(ydoc, cardYMap);
      } catch (_) { /* the editor's own calls below retry it */ }
    }
    setReady(true);
    // Once per editing session, like the fragment memo below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, cardYMap]);
  if (!ready) return <div className="note-body" />;
  return <NoteTiptapEditing {...props} />;
}

function NoteTiptapEditing({
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
  // Where editing started: { x, y, mode, scrollTop } (lib/noteEntryPoint.js),
  // or null for the end.
  entry = null,
  // Remove a link preview by url (NoteCardCollab's removePreview).
  onRemovePreview = null,
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
  // Who answers ⌘Z: the board after a whole-note style from the note bar, the
  // text otherwise (lib/noteUndoRoute.js). One per editing session.
  const undoRouteRef = useRef(null);
  useEffect(() => {
    const route = createNoteUndoRoute(noteUndoManager);
    undoRouteRef.current = route;
    return () => { route.destroy(); if (undoRouteRef.current === route) undoRouteRef.current = null; };
  }, [noteUndoManager]);

  // Word-level comments, same stack as the doc editor: the CommentMark carries
  // the anchor (inside the fragment, so the range survives concurrent edits)
  // and the thread bodies live in a Y.Map on this card. Notes have no pages and
  // no margin gutter — the highlighted text itself is the affordance.
  const commentScope = useMemo(
    () => (ydoc && cardYMap ? noteCommentScope(ydoc, cardYMap) : null),
    [ydoc, cardYMap],
  );
  const [openThread, setOpenThread] = useState(null); // { id, anchor } | null

  // Preview cards under the editor, from the live html cache (the write-through
  // below refreshes card.html, and the parent passes it back down).
  const previewHtml = useMemo(() => previewBlocksHtml(html), [html]);

  // A local edit flushes in a microtask, a co-editor's after a debounce.
  const localQueuedRef = useRef(false);
  const remoteTimerRef = useRef(0);
  const remotePendingRef = useRef(false);
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
  // A blank fragment over a cache that still shows something (body text, or
  // html text or a picture) before this session saw any content is a failed
  // seed, not an edit.
  const sawContentRef = useRef(false);
  // A local change to the note this session (typing, undo, a paste), and a
  // link preview removed while editing whose new size is still to measure.
  const dirtyRef = useRef(false);
  const needsMeasureRef = useRef(false);
  // The note as this session found it. Opening writes nothing; these only bound
  // the auto-height once a real edit happens. A note holding text at open
  // counts as seen (the open-time flush used to set this), so deleting all of
  // it is saved rather than refused as a failed seed.
  const openRef = useRef(null);
  if (openRef.current === null) {
    const h0 = Number(cardYMap?.get?.('h'));
    const blank0 = fragment ? noteFragmentIsBlank(fragment) : true;
    if (!blank0) sawContentRef.current = true;
    openRef.current = { h: Number.isFinite(h0) && h0 > 0 ? h0 : 0, blank: blank0 };
  }
  // The html cache for the fragment as it is now, or null to leave the cache.
  const textCacheHtml = () => {
    if (!fragment) return null;
    const blank = noteFragmentIsBlank(fragment);
    if (!blank) sawContentRef.current = true;
    else if (!sawContentRef.current && (bodyHasText(cardYMap?.get?.('body')) || htmlHasContent(cardYMap?.get?.('html')))) return null;
    const serialized = noteFragmentToHtml(fragment);
    // noteFragmentToHtml answers '' when it can't serialize (a node or mark
    // this build's schema doesn't know, say from a newer peer). From a
    // fragment that holds text that is a failure, not an edit: keep the cache.
    if (!serialized && !blank) return null;
    // Previews the user removed stay removed (the card's hiddenPreviews).
    return linkifyNoteHtml(serialized, cardYMap?.get?.('hiddenPreviews'));
  };

  // Card height after a local edit, or null to leave it (a hand-resized note
  // never auto-sizes). Measured from the content, not the flex:1 body that
  // fills the card, so the note shrinks as text is deleted. Growth stops at
  // 480, or at the Show all ceiling when the note was already taller than 480
  // at open. A note that was empty at open (a new note) keeps the size it was
  // placed at as its floor; any other note fits its text, never below the card
  // minimum (40, inside cardHeightForContent).
  const autoHeight = (html) => {
    const dom = editorRef.current?.view?.dom;
    if (manualRef.current || !dom) return null;
    const { h: openH, blank } = openRef.current;
    const cap = openH > NOTE_AUTOSIZE_MAX ? Math.max(NOTE_SHOW_ALL_MAX, openH) : NOTE_AUTOSIZE_MAX;
    const floor = blank ? openH : 0;
    const need = Math.max(cardHeightForContent(dom), displayHeightWithPreviews(dom, html));
    return Math.round(Math.min(cap, Math.max(floor, need)));
  };

  // html + body + h in ONE setNoteCacheFields call (one Y transaction), which
  // also drops unchanged keys, so a no-op writes nothing. `measure` is true
  // only for this session's own edits: a co-editor's client sizes the note.
  const flush = (measure) => {
    if (!fragment) return;
    let html = null;
    try { html = textCacheHtml(); } catch (_) { html = null; }
    const patch = html != null ? { html, body: null } : {};
    if (measure) {
      try { const h = autoHeight(html); if (h != null) patch.h = h; } catch (_) { /* noop */ }
    }
    if (Object.keys(patch).length) writeCache(patch);
  };

  // A preview removed while editing: once the html without it comes back
  // (cards.jsx removePreview writes it), size the note to what is left. The
  // removal is this session's own edit, so it measures here.
  useEffect(() => {
    if (!needsMeasureRef.current) return;
    needsMeasureRef.current = false;
    try { flush(true); } catch (_) { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewHtml]);

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
    // The surface mounts ONLY to edit. The caret and the focus are set once
    // the editor is on screen (the open effect below), not by Tiptap's
    // autofocus or onCreate. (autoFocus prop kept for callers.)
    autofocus: false,
    editable: true,
    editorProps: {
      // Foreign pastes lose their typography so the note's own font + size
      // hold (see pasteScrub), and read like an older note's html: preview
      // cards dropped, a link whose words are its own address left as plain
      // text (linkify links it, with its preview, on save), h4–h6 made h3,
      // and a block's last <br> dropped. A copy from a note editor
      // (ProseMirror's data-pm-slice) is already in the note's shape.
      transformPastedHTML: (h) => (isInternalPaste(h) ? h : stripNoteChromeForSeed(scrubPastedHtml(h))),
      // Plain text keeps its blank lines (ProseMirror's own parser collapses
      // them): a line per paragraph, an empty line an empty one. notePaste.js.
      clipboardTextParser: (text, $context, _plain, view) => noteTextSlice(text, view.state.schema, $context.marks()),
      // The bare <span> Google Docs wraps text in becomes a textStyle mark with
      // no attribute once pasteScrub takes its typography: drop it.
      transformPasted: (slice) => dropEmptyTextStyle(slice),
      attributes: {
        // The measurer (cardHeightForBody) and the note CSS both key off
        // .note-body — Tiptap must render INTO it.
        class: 'note-body',
        // Grammarly OFF on notes. Grammarly paints its underlines via its own
        // absolutely-positioned overlay, which does NOT follow the canvas's
        // `transform: scale(zoom)` — so at any zoom ≠ 100% its squiggles drift
        // left of the words (the "spellcheck misalignment" bug). On a computer native
        // spellcheck is OFF too: Chromium paints its squiggles at untransformed
        // glyph coordinates (they do NOT follow an ancestor transform:scale),
        // so they misalign exactly the same way at any zoom ≠ 100%. Docs keep
        // native spellcheck because DocPageEditor scales via CSS `zoom`, which
        // the squiggle painter does follow. A phone or tablet types with its
        // keyboard's autocorrect, capitals and spellcheck on
        // (lib/noteTouchTyping.js): that is how people type there, and a
        // mistyped word left uncorrected is worse than a squiggle a little off.
        'data-gramm': 'false',
        'data-gramm_editor': 'false',
        'data-enable-grammarly': 'false',
        ...noteTypingAttrs(),
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
      // Tab / Shift-Tab: see the Tab branch below. Enter: plain-dash lists.
      handleKeyDown: (view, event) => {
        // ⌘Z / ⇧⌘Z (Ctrl-Z, Ctrl-Y, Ctrl-Shift-Z too) right after a whole-note
        // style from the note bar take back that style, which is on the
        // board's undo; every other press stays the text's (noteUndoRoute).
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.isComposing) {
          const k = (event.key || '').toLowerCase();
          const route = undoRouteRef.current;
          const undo = k === 'z' && !event.shiftKey;
          const redo = (k === 'z' && event.shiftKey) || (k === 'y' && !event.shiftKey);
          if (route && ((undo && route.undo()) || (redo && route.redo()))) {
            event.preventDefault();
            return true;
          }
        }
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
        // Tab. editorProps.handleKeyDown runs BEFORE every plugin keymap
        // (prosemirror-view someProp: direct props first), so ListItem's own
        // Tab/Shift-Tab (sink/lift) never ran: handle lists here. Tab never
        // deletes text and never moves focus out of the note: every plain
        // Tab / Shift-Tab is prevented. Composition (IME) is left alone.
        if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (event.isComposing || view.composing) return false;
          event.preventDefault();
          const ed = editorRef.current;
          const { $from, empty } = view.state.selection;
          let item = null; // the innermost list item the caret is in
          for (let d = $from.depth; d > 0 && !item; d--) {
            const name = $from.node(d).type.name;
            if (name === 'listItem' || name === 'noteChecklistItem') item = name;
          }
          if (item === 'listItem') {
            if (event.shiftKey) ed?.commands.liftListItem('listItem');
            else ed?.commands.sinkListItem('listItem');
          } else if (item === 'noteChecklistItem') {
            // Checklists don't nest (paragraph+ content): Tab does nothing;
            // Shift-Tab keeps lifting the item back to a paragraph.
            if (event.shiftKey) ed?.commands.liftListItem('noteChecklistItem');
          } else if (!event.shiftKey && empty) {
            view.dispatch(view.state.tr.insertText('  '));
          }
          return true;
        }
        return false;
      },
    },
    // Create once for this editing session; the fragment is stable per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragment]);

  editorRef.current = editor;

  // Open the editor in the frame after it mounts, once its DOM is on screen.
  // Not in Tiptap's onCreate: that runs a tick after the editor is built,
  // which can be before React has put it on screen (and, in dev, for editors
  // StrictMode builds and throws away), and a focus() there does nothing: the
  // keyboard keeper let go, and what was typed next reached the canvas as
  // shortcuts. StrictMode's rehearsal unmount cancels the first frame here;
  // a focus before it was blurred by that unmount, which closed the note.
  useEffect(() => {
    if (!editor) return undefined;
    let raf = 0;
    let tries = 0;
    const open = () => {
      raf = 0;
      if (editor.isDestroyed) return;
      if (!editor.view.dom.isConnected && tries++ < 30) {
        raf = requestAnimationFrame(open);
        return;
      }
      // Still not on screen after 30 frames: open it anyway, at the end, so
      // whatever held the typing meanwhile hands it over and lets go (the
      // keeper has no timer of its own).
      openEditor(editor, cardId, editor.view.dom.isConnected ? entry : null);
    };
    raf = requestAnimationFrame(open);
    return () => { if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Register as the active note editor so the bottom toolbar drives it.
  useEffect(() => {
    if (!editor) return undefined;
    setActiveNoteEditor(editor, {
      openAddComment: addComment.open,
      // A whole-note style written to the board (CanvasSurface's
      // onUpdateEditingNote), so ⌘Z here can find it.
      noteStyleWrite: (board, write) => {
        const route = undoRouteRef.current;
        if (route) route.styleWrite(board, write); else write();
      },
      // Several writes as one board undo step: Yjs nests transactions and the
      // outer origin wins, so the fragment, its html cache and card fields all
      // land in one 'local' step (as cards.jsx's checklist toggle does). The
      // cache is written inside so a canvas ⌘Z restores what read mode shows.
      asOneUndoStep: (fn) => {
        if (!ydoc) { fn(); return; }
        ydoc.transact(() => {
          fn();
          try { flush(false); } catch (_) { /* noop */ }
        }, 'local');
      },
    });
    return () => setActiveNoteEditor(null);
  }, [editor]);

  // Phones and tablets: the line being typed is never under the keyboard or
  // the note bar. The keyboard is laid over the page and shrinks the visual
  // viewport, so on each change to it, each caret move and each change in the
  // note's size, the board glides just enough to show the caret (CanvasSurface,
  // through the registry; the sums are in lib/noteTouchTyping.js). Never while
  // a finger is down: that is the person moving the board or dragging a
  // selection handle.
  useEffect(() => {
    if (!editor || !coarsePointer()) return undefined;
    const vv = window.visualViewport || null;
    const noteEl = editor.view.dom.closest?.('.note') || null;
    let fingers = 0;
    let raf = 0;
    const reveal = () => {
      raf = 0;
      if (editor.isDestroyed || !editor.isFocused || fingers > 0) return;
      const { view } = editor;
      const band = typingBand(window, view.dom.closest('.canvas-wrap'), document.querySelector('.tob'));
      if (!band) return;
      let caret;
      try { caret = view.coordsAtPos(view.state.selection.head); } catch (_) { return; }
      ensureClientRectVisible(view.dom, clampToBox(caret, noteEl?.getBoundingClientRect() || null), band);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(reveal); };
    const onTouch = (e) => { fingers = e.touches ? e.touches.length : 0; };
    const opts = { capture: true, passive: true };
    editor.on('selectionUpdate', schedule);
    editor.on('focus', schedule);
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    document.addEventListener('touchstart', onTouch, opts);
    document.addEventListener('touchend', onTouch, opts);
    document.addEventListener('touchcancel', onTouch, opts);
    // The note grows as it is typed into (its h lands a frame or two after
    // the keystroke): show the line once it has.
    const ro = noteEl && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(noteEl);
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      editor.off('selectionUpdate', schedule);
      editor.off('focus', schedule);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      document.removeEventListener('touchstart', onTouch, opts);
      document.removeEventListener('touchend', onTouch, opts);
      document.removeEventListener('touchcancel', onTouch, opts);
      ro?.disconnect();
    };
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

  // Write-through card.html (+ auto-size) after real changes only. Nothing is
  // written on open: the open-time measure cut every "Show all" note back to
  // 480 and rewrote html nobody had edited.
  //  - This session's edits (y-sync meta absent, or a Y.UndoManager undo/redo):
  //    mark dirty and flush in a microtask. The fragment's own Y update has
  //    already queued useYBoard's frame refresh, so the cache write lands in
  //    that same refresh: one canvas render per keystroke, not two.
  //  - A co-editor's change (isChangeOrigin, not undo): their client writes
  //    the cache; here it is re-derived 400ms after they pause, html only.
  //  - y-prosemirror drawing the fragment into the view (meta carries
  //    `binding`): not a change at all.
  useEffect(() => {
    if (!editor) return undefined;
    const onUpdate = ({ transaction } = {}) => {
      const sync = transaction?.getMeta?.(ySyncPluginKey);
      if (sync?.binding) return;
      if (sync?.isChangeOrigin && !sync.isUndoRedoOperation) {
        remotePendingRef.current = true;
        if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current);
        remoteTimerRef.current = setTimeout(() => {
          remoteTimerRef.current = 0;
          if (!remotePendingRef.current) return;
          remotePendingRef.current = false;
          flush(false);
        }, REMOTE_CACHE_DEBOUNCE_MS);
        return;
      }
      dirtyRef.current = true;
      remotePendingRef.current = false; // the local flush serializes the merged note
      if (localQueuedRef.current) return;
      localQueuedRef.current = true;
      queueMicrotask(() => {
        if (!localQueuedRef.current) return;
        localQueuedRef.current = false;
        flush(true);
      });
    };
    editor.on('update', onUpdate);
    try { ensureFontsFromHtml(editor.getHTML()); } catch (_) { /* noop */ }
    return () => {
      editor.off('update', onUpdate);
      if (remoteTimerRef.current) { clearTimeout(remoteTimerRef.current); remoteTimerRef.current = 0; }
      // Unmounted without exitEdit (the board went away): keep a pending text write.
      if (localQueuedRef.current || remotePendingRef.current) {
        localQueuedRef.current = false;
        remotePendingRef.current = false;
        try { flush(false); } catch (_) { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Leaving re-derives the text cache only when there is a reason: a change
  // this session (or one still waiting in its microtask or a co-editor's
  // debounce), a preview removed while editing, or a cache with no text beside
  // a fragment that has some (a note the API made, which has only a body, or
  // one an old seed blanked). A note opened and closed untouched keeps its
  // html byte for byte, whatever this build's serializer would write, even on
  // its first open: the fragment is seeded from the html, but only an edit
  // rewrites the html (a table, or anything else the note's schema can't hold,
  // stays in it until then). setNoteCacheFields drops unchanged keys, so a
  // re-derive that matches writes nothing. h is measured only for a local edit
  // still waiting in its microtask, or a removed preview.
  const exitEdit = () => {
    const localPending = localQueuedRef.current;
    localQueuedRef.current = false;
    const remotePending = remotePendingRef.current;
    if (remoteTimerRef.current) { clearTimeout(remoteTimerRef.current); remoteTimerRef.current = 0; }
    remotePendingRef.current = false;
    const measure = localPending || needsMeasureRef.current;
    needsMeasureRef.current = false;
    let heal = false;
    try {
      heal = !!fragment && !noteFragmentIsBlank(fragment) && !htmlHasText(cardYMap?.get?.('html'));
    } catch (_) { /* noop */ }
    if (localPending || remotePending || dirtyRef.current || measure || heal) {
      try { flush(measure); } catch (_) { /* noop */ }
    }
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
      // The stack around the editor (its empty band, the preview cards) is the note too.
      const inNote = editor.view.dom.closest?.('.note-edit-stack') || editor.view.dom;
      if (inNote.contains(t) || inEditSessionUi(t)) return;
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
    if (isComposingKey(e)) return;
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

  // The empty band of the content-height editor (a centred note's slack above
  // and below its text, the space under a short note's last line) is outside
  // the contenteditable. A press there keeps the focus and puts the caret at
  // the nearest position, as a press inside a text box would; it never reaches
  // the canvas (a drag) or moves the focus to the page (which ends editing).
  const onStackPointerDown = (e) => {
    if (e.target !== e.currentTarget || e.button > 0) return;
    e.stopPropagation();
    const view = editorRef.current?.view;
    if (!view || editorRef.current.isDestroyed) return;
    const r = noteEntryRange(view, { x: e.clientX, y: e.clientY, mode: 'caret' });
    if (r) selectRange(view, r);
  };
  const onStackMouseDown = (e) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
  };
  // Preview cards: a press keeps the focus in the editor (a click on the
  // remove button would otherwise blur it and end editing before the click
  // landed); the remove button works as it does on the read-only note.
  const onPreviewsClick = (e) => {
    e.stopPropagation();
    const btn = e.target.closest?.('.note-preview-remove');
    if (!btn) return;
    e.preventDefault();
    needsMeasureRef.current = true;
    onRemovePreview?.(btn.closest('.note-link-preview')?.dataset?.url);
  };

  if (!editor) return <div className="note-body" />;
  return (
    <>
      <div className="note-edit-stack"
           onPointerDown={onStackPointerDown}
           onMouseDown={onStackMouseDown}
           onDoubleClick={(e) => e.stopPropagation()}>
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
        {previewHtml && (
          <div className="note-edit-previews"
               onPointerDown={(e) => e.stopPropagation()}
               onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
               onClick={onPreviewsClick}
               dangerouslySetInnerHTML={{ __html: previewHtml }} />
        )}
      </div>
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
