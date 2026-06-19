// Slash command menu — type "/" anywhere in the editor to open a filterable
// list of block types to insert. Notion-style. Keyboard-driven (↑↓ + Enter).
//
// Built on @tiptap/suggestion (already a Tiptap dep) + tippy.js for the
// floating popup, rendered via createPortal so the menu sits above the
// editor without inheriting transforms.

import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Each command receives ({editor, range}) and runs Tiptap commands. The range
// covers the "/query" text so we can delete it before inserting the block.
function buildItems({ onInsertBookmark, onInsertImage, onInsertBoardEmbed }) {
  return [
    { id: 'h1', title: 'Heading 1', subtitle: 'Big section title', keywords: ['heading', 'h1', 'title'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() },
    { id: 'h2', title: 'Heading 2', subtitle: 'Medium section title', keywords: ['heading', 'h2'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() },
    { id: 'h3', title: 'Heading 3', subtitle: 'Sub-section title', keywords: ['heading', 'h3'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run() },
    { id: 'p', title: 'Paragraph', subtitle: 'Regular body text', keywords: ['paragraph', 'body', 'text'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run() },
    { id: 'bullet', title: 'Bulleted list', subtitle: 'Unordered list', keywords: ['list', 'bullet', 'ul'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
    { id: 'ordered', title: 'Numbered list', subtitle: 'Ordered list', keywords: ['list', 'numbered', 'ol'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
    { id: 'task', title: 'Task list', subtitle: 'Checkable items', keywords: ['todo', 'task', 'checklist'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
    { id: 'quote', title: 'Quote', subtitle: 'Block quote', keywords: ['quote', 'blockquote'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
    { id: 'code', title: 'Code block', subtitle: 'Monospace code', keywords: ['code', 'codeblock', 'pre'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
    { id: 'divider', title: 'Divider', subtitle: 'Horizontal rule', keywords: ['hr', 'divider', 'rule', 'separator'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
    { id: 'table', title: 'Table', subtitle: 'Insert 3×3 table', keywords: ['table', 'grid'],
      run: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'image', title: 'Image', subtitle: 'Upload from your machine', keywords: ['image', 'picture', 'photo', 'img'],
      run: ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); onInsertImage?.(editor); } },
    { id: 'bookmark', title: 'Bookmark', subtitle: 'Anchor for cross-links', keywords: ['bookmark', 'anchor', 'link'],
      run: ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); onInsertBookmark?.(editor); } },
    { id: 'embed', title: 'Embed board', subtitle: 'Link to another board / card', keywords: ['embed', 'board', 'link', 'reference'],
      run: ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); onInsertBoardEmbed?.(editor); } },
  ];
}

// In screenplay mode the prose blocks above are meaningless (and converting a
// screenplay line into a heading/list breaks it), so `/` offers the script
// elements instead — each just retypes the current line's element via the
// always-available setScreenplayElement command.
function buildScreenplayItems() {
  const el = (id, title, subtitle, keywords, element) => ({
    id, title, subtitle, keywords,
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setScreenplayElement(element).run(),
  });
  return [
    el('sp-scene', 'Scene Heading', 'INT./EXT. location — time', ['scene', 'heading', 'slug', 'slugline', 'int', 'ext'], 'scene'),
    el('sp-action', 'Action', 'Describe what happens', ['action', 'description'], 'action'),
    el('sp-character', 'Character', 'Who is speaking', ['character', 'cue', 'name', 'who'], 'character'),
    el('sp-dialogue', 'Dialogue', 'The spoken lines', ['dialogue', 'speech', 'line', 'say'], 'dialogue'),
    el('sp-paren', 'Parenthetical', 'Acting direction (wryly)', ['parenthetical', 'paren', 'wryly'], 'parenthetical'),
    el('sp-transition', 'Transition', 'CUT TO:, DISSOLVE TO:', ['transition', 'cut', 'dissolve', 'fade', 'smash'], 'transition'),
    el('sp-shot', 'Shot', 'A camera shot / angle', ['shot', 'angle', 'camera', 'pov'], 'shot'),
    el('sp-centered', 'Centered', 'Centered text (THE END)', ['centered', 'center', 'middle'], 'centered'),
  ];
}

const SlashList = forwardRef(function SlashList({ items, command }, ref) {
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') { setActive(i => (i + 1) % items.length); return true; }
      if (event.key === 'ArrowUp')   { setActive(i => (i - 1 + items.length) % items.length); return true; }
      // Tab selects like Enter (Notion/Linear convention) — without this Tab
      // fell through to the editor's Tab keymap and inserted spaces/indented
      // a list while the menu sat open.
      if (event.key === 'Enter' || event.key === 'Tab') { items[active] && command(items[active]); return true; }
      return false;
    },
  }), [items, active, command]);

  if (!items.length) return <div className="doc-slash"><div className="doc-slash-empty">No matches</div></div>;
  return (
    <div className="doc-slash" role="listbox">
      {items.map((it, i) => (
        <button key={it.id}
                className={`doc-slash-item ${i === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => command(it)}
                role="option"
                aria-selected={i === active}>
          <div className="doc-slash-item-title">{it.title}</div>
          <div className="doc-slash-item-sub">{it.subtitle}</div>
        </button>
      ))}
    </div>
  );
});

export function makeSlashExtension({ onInsertBookmark, onInsertImage, onInsertBoardEmbed, docMode } = {}) {
  const all = docMode === 'screenplay'
    ? buildScreenplayItems()
    : buildItems({ onInsertBookmark, onInsertImage, onInsertBoardEmbed });
  return Extension.create({
    name: 'slashCommand',
    addOptions() {
      return {
        suggestion: {
          char: '/',
          startOfLine: false,
          allowSpaces: false,
          items: ({ query }) => {
            const q = (query || '').toLowerCase();
            if (!q) return all;
            return all.filter(it =>
              it.title.toLowerCase().includes(q) ||
              it.subtitle.toLowerCase().includes(q) ||
              (it.keywords || []).some(k => k.includes(q))
            );
          },
          command: ({ editor, range, props }) => props.run({ editor, range }),
          render: () => {
            let component = null;
            let popup = null;
            return {
              onStart: (props) => {
                component = new ReactRenderer(SlashList, { props, editor: props.editor });
                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                  offset: [0, 6],
                  arrow: false,
                });
              },
              onUpdate: (props) => {
                component?.updateProps(props);
                popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect });
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') { popup?.[0]?.hide(); return true; }
                return component?.ref?.onKeyDown?.(props) ?? false;
              },
              onExit: () => {
                popup?.[0]?.destroy();
                component?.destroy();
                popup = null;
                component = null;
              },
            };
          },
        },
      };
    },
    addProseMirrorPlugins() {
      return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
    },
  });
}
