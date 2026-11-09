// Shared schema-defining Tiptap extensions for the collaborative note editor.
// This SAME list drives both the live editor (NoteRichEditor, via the
// Collaboration binding) and the headless html↔fragment serializers
// (noteDocState.js generateJSON/generateHTML) — so parse and serialize are
// guaranteed symmetric and legacy note html seeds natively.
//
// Runtime-only concerns (Collaboration, Placeholder, keymaps, the @ picker)
// are layered on top by NoteRichEditor; they are NOT in this schema list.
//
// The extension set is a deliberate SUBSET of the doc editor's baseExtensions
// plus three custom nodes (NoteMention, NoteChecklist, NoteChecklistItem) that
// emit the exact legacy note html contract the read-only consumers expect.

import StarterKit from '@tiptap/starter-kit';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import Blockquote from '@tiptap/extension-blockquote';
import Code from '@tiptap/extension-code';
import { mergeAttributes } from '@tiptap/core';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import { FontSize } from '../docExtensions/FontSize.js';
import { CommentMark } from '../docExtensions/CommentMark.js';
import { NoteMention } from './NoteMention.js';
import { NoteChecklist, NoteChecklistItem } from './NoteChecklist.js';
import { ClearFormatting } from '../docExtensions/ClearFormatting.js';

// Whether html anchors (a seeded older note, a paste) become link marks in
// the note fragment. ON since 2026-11 (phase 2). y-prosemirror meets a mark
// its schema doesn't know by DELETING that paragraph's text from the shared
// fragment, for every collaborator (createTextNodesFromYText), and that
// delete is not on anyone's undo stack. That is why this shipped in two
// promotes. Phase 1 (2b1fe402, 2026-10-12) put the mark in the schema with
// nothing parsing into it. Phase 2 (this) parses into it. It is safe because
// no build without the mark can reach a note any more. Every build since
// 2026-10-12 has it. A tab from before then can't be reloaded by
// MIN_CLIENT_BUILD (the build watch, lib/buildWatch.js, came on 2026-10-17 in
// 78cb45ae), but it synced through the PartyKit host, whose project and room
// data were deleted on 2026-10-23, so it can no longer receive or send a
// note's fragment. And no phone-app session has been seen since tracking
// began on 2026-10-22. Never remove Link from this list: notes now hold the mark.
export const NOTE_LINK_MARKS = true;

export const noteExtensions = [
  StarterKit.configure({
    // Collaboration registers its own (yUndo) history; double-registering the
    // history plugin throws. See DocPageEditor.
    history: false,
    // Notes never used code blocks or horizontal rules; keep them out of the
    // schema so pasted content can't introduce them.
    codeBlock: false,
    horizontalRule: false,
    heading: { levels: [1, 2, 3] },
    // Lists, quotes and inline code are re-added below with their markdown
    // input rules (and quote/code shortcuts) stripped.
    bulletList: false,
    orderedList: false,
    blockquote: false,
    code: false,
  }),
  // Same list nodes/commands (schema + toolbar toggles unchanged) minus the
  // "- " / "* " / "1. " markdown input rules: typing a plain dash list kept
  // flipping into a real <ul> the user didn't ask for. Lists stay reachable
  // via the formatting toolbar; typed "- " remains literal text and Enter
  // auto-continues the prefix (NoteTiptapSurface handleKeyDown). listItem
  // still ships via StarterKit, so toggleBulletList/toggleOrderedList work.
  BulletList.extend({ addInputRules: () => [] }),
  OrderedList.extend({
    addInputRules: () => [],
    // A stored start below 2 renders no attribute, so a 0 shows as 1.
    renderHTML({ HTMLAttributes }) {
      const { start, ...rest } = HTMLAttributes;
      return start >= 2
        ? ['ol', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
        : ['ol', mergeAttributes(this.options.HTMLAttributes, rest), 0];
    },
  }),
  // Quotes and inline code stay in the schema (older notes and pastes hold
  // them, and y-prosemirror deletes what a schema can't parse), but nothing
  // typed makes them any more: "> " turned a line into a quote and a pair of
  // backticks turned words into code mid-sentence, which read as glitches.
  // Their shortcuts (⇧⌘B, ⌘E) and Code's paste rule go too. A quiet look for
  // the ones that exist lives in styles.css (.note-body blockquote / code).
  Blockquote.extend({ addInputRules: () => [], addKeyboardShortcuts: () => ({}) }),
  Code.extend({ addInputRules: () => [], addPasteRules: () => [], addKeyboardShortcuts: () => ({}) }),
  Underline,
  // Inline color / font-family / font-size live on the textStyle mark and
  // render as <span style="…"> — matching the legacy wrapSelectionStyle output.
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  // Word-level comments, the same mark the doc editor uses. MUST live in this
  // schema list (not the runtime one): noteDocState round-trips notes through
  // generateHTML/generateJSON against exactly this array, so a mark missing
  // here would be silently stripped from card.html on the next keystroke —
  // i.e. every comment anchor in the note would evaporate.
  CommentMark,
  // Named links ("Read the brief" → https://…). Without the mark a pasted
  // hyperlink kept only its words, and opening a note whose html had one
  // rewrote it without the URL (NOTES-09). Bare URLs are NOT stored as links:
  // they stay plain text (stripNoteChromeForSeed unwraps old auto-links) and
  // noteLinkify links them, with their preview, on every write-through — so
  // Link's paste rule (which marks every pasted URL) is off for good.
  // Clicks don't navigate while editing; the read-only note is where a link
  // opens. Phase 2 is on (see NOTE_LINK_MARKS above): anchors parse into link
  // marks, and Link's own URI check drops javascript: and friends.
  Link.extend({
    parseHTML() { return NOTE_LINK_MARKS ? this.parent?.() : []; },
    addPasteRules() { return []; },
  }).configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
  ClearFormatting,
  // Custom nodes — must keep their exact html contract (see each file).
  NoteMention,
  NoteChecklist,
  NoteChecklistItem,
];
