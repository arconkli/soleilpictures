// Custom Tiptap nodes for note checklists. They emit the EXACT legacy note
// contract so the read-only display renderer + the click-to-toggle handler
// (RichNoteEditor.onBodyClick, which keys off .ck-box) and the checklist CSS
// (.note-checklist / .ck / .ck-box / .ck-text) keep working unchanged once note
// text moves into a Y.XmlFragment:
//
//   <ul class="note-checklist">
//     <li class="ck">
//       <span class="ck-box" role="checkbox" aria-checked="false"></span>
//       <span class="ck-text">…inline…</span>
//     </li>
//   </ul>
//
// We do NOT reuse Tiptap's TaskList/TaskItem (they render data-type markup that
// none of the note consumers understand).

import { Node, mergeAttributes } from '@tiptap/core';

export const NoteChecklist = Node.create({
  name: 'noteChecklist',
  group: 'block list',
  content: 'noteChecklistItem+',
  // Parse ul.note-checklist before StarterKit's generic `ul` (bulletList).
  priority: 200,

  parseHTML() {
    return [{ tag: 'ul.note-checklist', priority: 200 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes({ class: 'note-checklist' }, HTMLAttributes), 0];
  },
});

export const NoteChecklistItem = Node.create({
  name: 'noteChecklistItem',
  // Block content (a paragraph) so the standard Tiptap list commands —
  // toggleList / splitListItem / liftListItem — operate on it. The paragraph
  // renders inside .ck-text and is margin-reset in CSS so it reads as one line,
  // matching the legacy inline checklist look.
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return {
      checked: {
        default: false,
        // Read the toggle state off the .ck-box child (aria-checked or the
        // legacy .is-checked class).
        parseHTML: (el) => {
          const box = el.querySelector(':scope > .ck-box') || el.querySelector('.ck-box');
          if (box) {
            return box.getAttribute('aria-checked') === 'true' ||
                   box.classList.contains('is-checked');
          }
          return el.getAttribute('aria-checked') === 'true';
        },
        // State is reflected on the .ck-box child in renderHTML, not the <li>.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    // Content comes from the .ck-text element; the .ck-box is chrome.
    return [{ tag: 'li.ck', contentElement: '.ck-text', priority: 200 }];
  },

  renderHTML({ node }) {
    const checked = !!node.attrs.checked;
    return [
      'li',
      { class: 'ck' },
      ['span', {
        class: checked ? 'ck-box is-checked' : 'ck-box',
        role: 'checkbox',
        'aria-checked': checked ? 'true' : 'false',
      }],
      ['div', { class: 'ck-text' }, 0],
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Enter splits into a new item (empty item → exits the list, matching the
      // legacy checklist behaviour). Shift-Tab lifts an item back to a paragraph.
      Enter: () => this.editor.commands.splitListItem('noteChecklistItem'),
      'Shift-Tab': () => this.editor.commands.liftListItem('noteChecklistItem'),
    };
  },
});
