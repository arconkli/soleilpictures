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
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import TextAlign from '@tiptap/extension-text-align';
import { FontSize } from '../docExtensions/FontSize.js';
import { NoteMention } from './NoteMention.js';
import { NoteChecklist, NoteChecklistItem } from './NoteChecklist.js';

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
  }),
  Underline,
  // Inline color / font-family / font-size live on the textStyle mark and
  // render as <span style="…"> — matching the legacy wrapSelectionStyle output.
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  // Custom nodes — must keep their exact html contract (see each file).
  NoteMention,
  NoteChecklist,
  NoteChecklistItem,
];
