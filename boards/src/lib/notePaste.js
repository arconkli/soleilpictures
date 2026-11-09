// Plain-text paste for notes. ProseMirror's own plain-text paste splits on
// /(?:\r\n?|\n)+/, so every blank line in what you copied vanished: two
// paragraphs arrived as one run of lines. Here each line break starts a new
// paragraph and an empty line stays an empty paragraph, the same rule
// noteBodyToHtml (lib/noteBody.js) uses to open a text-only note, and what
// pressing Enter produces in the editor.
//
// Checked prosemirror-view's default plain-text parser (collapses blank lines)
// and lib/noteBody.js noteBodyToHtml (same line rule, but html for seeding,
// not a Slice); built this small Slice builder because the
// clipboardTextParser hook needs a Slice from the editor's schema.

import { Fragment, Slice } from '@tiptap/pm/model';

// Text → its lines. \r\n and \r become \n; one entry per line, '' for an
// empty one. "a\n" is ['a', '']: a line break after a, as in a text editor.
export function noteTextLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
}

// editorProps.clipboardTextParser (text, $context, plain, view) → Slice.
// Open at both ends, so a single line pastes inline into the current
// paragraph. `marks` are the marks at the caret, as ProseMirror's default
// applies them.
export function noteTextSlice(text, schema, marks = null) {
  const para = schema.nodes.paragraph;
  const nodes = noteTextLines(text).map((line) => (
    line ? para.create(null, schema.text(line, marks)) : para.create()
  ));
  return Slice.maxOpen(Fragment.fromArray(nodes));
}

// A textStyle mark with no attribute set renders as a bare <span> and splits
// a run for nothing. Google Docs wraps pasted text in one.
const isEmptyTextStyle = (mark) => mark.type.name === 'textStyle'
  && Object.values(mark.attrs).every((v) => v == null || v === '');

function stripEmptyTextStyle(fragment) {
  let changed = false;
  const out = [];
  fragment.forEach((node) => {
    let next = node;
    const content = node.isLeaf ? node.content : stripEmptyTextStyle(node.content);
    if (content !== node.content) next = node.copy(content);
    const marks = next.marks.filter((m) => !isEmptyTextStyle(m));
    if (marks.length !== next.marks.length) next = next.mark(marks);
    if (next !== node) changed = true;
    out.push(next);
  });
  // fromArray joins neighbouring text that now carries the same marks.
  return changed ? Fragment.fromArray(out) : fragment;
}

// editorProps.transformPasted: the same slice with empty textStyle marks
// dropped (the same object back when there are none).
export function dropEmptyTextStyle(slice) {
  const content = stripEmptyTextStyle(slice.content);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}
