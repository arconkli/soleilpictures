// Shared schema-defining Tiptap extensions for the doc editor.
// Runtime-only stuff (Collaboration, Placeholder, custom keymaps, slash
// menu, etc.) is added by DocPageEditor on top of this list.

import StarterKit from '@tiptap/starter-kit';
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

export const baseDocExtensions = [
  StarterKit.configure({
    history: false,
    codeBlock: { HTMLAttributes: { class: 'tt-code' } },
    heading: { levels: [1, 2, 3, 4, 5, 6] },
  }),
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
];
