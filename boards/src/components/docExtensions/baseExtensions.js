// Shared schema-defining Tiptap extensions for the doc editor.
// Runtime-only stuff (Collaboration, Placeholder, custom keymaps, mentions,
// etc.) is added by DocPageEditor on top of this list.

import StarterKit from '@tiptap/starter-kit';
import OrderedList from '@tiptap/extension-ordered-list';
import { mergeAttributes } from '@tiptap/core';
import Underline from '@tiptap/extension-underline';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { LinkMark } from './LinkMark.js';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { ImageResizable } from './ImageResizable.js';
import { FontSize } from './FontSize.js';
import { BoardEmbed } from './BoardEmbed.js';
import { CommentMark } from './CommentMark.js';
import { ScreenplayBlock } from './screenplay/ScreenplayBlock.js';
import { ClearFormatting } from './ClearFormatting.js';

// StarterKit's list, except a stored start below 2 renders no attribute, so a
// start of 0 (written before 2026-11-04) shows as 1. Only renderHTML differs.
export const DocOrderedList = OrderedList.extend({
  renderHTML({ HTMLAttributes }) {
    const { start, ...rest } = HTMLAttributes;
    return start >= 2
      ? ['ol', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
      : ['ol', mergeAttributes(this.options.HTMLAttributes, rest), 0];
  },
});

export const baseDocExtensions = [
  StarterKit.configure({
    history: false,
    orderedList: false,
    codeBlock: { HTMLAttributes: { class: 'tt-code' } },
    heading: { levels: [1, 2, 3, 4, 5, 6] },
  }),
  DocOrderedList,
  Underline,
  Subscript,
  Superscript,
  LinkMark,
  ImageResizable.configure({ HTMLAttributes: { class: 'tt-img' } }),
  Table.configure({ resizable: true, HTMLAttributes: { class: 'tt-table' } }),
  TableRow, TableCell, TableHeader,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TextStyle, Color, FontFamily, FontSize,
  Highlight.configure({ multicolor: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  BoardEmbed,
  CommentMark,
  ClearFormatting,
  // Always in the schema so parse/serialize works everywhere; harmless for
  // prose docs (never instantiated unless screenplay mode is on).
  ScreenplayBlock,
];
