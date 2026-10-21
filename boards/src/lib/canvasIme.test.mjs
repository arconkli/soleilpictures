// The canvas's text fields leave a key pressed mid-syllable to the input
// method: that Enter picks the syllable, and a field that acts on it posts,
// names or tags with the word cut short, then gets the syllable again where it
// has gone (봄 광고고). tests/canvas-ime.spec.js types Korean into three of
// them through Chromium's IME; the rest are pinned here, each asking the shared
// rule (lib/composerKeys.js) before any key of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const IMPORTS_RULE = /import \{[^}]*\bisComposingKey\b[^}]*\} from '(?:\.\.\/)+lib\/composerKeys\.js';/;
const GUARD = /if \(isComposingKey\(e\)\) return;/g;

// File → how many of its key handlers are text fields.
const FIELDS = {
  '../components/TagPicker.jsx': 1,
  '../components/CanvasSurface.jsx': 2,        // a project's name; a grid's columns × rows
  '../components/CanvasComment.jsx': 1,
  '../components/CanvasVoteCard.jsx': 1,       // the question
  '../components/ArrowPopover.jsx': 1,         // the label
  '../components/SizeInput.jsx': 1,
  '../components/ToolOptionsBar.jsx': 2,       // a line's angle and its width
  '../components/SketchPadOverlay.jsx': 1,     // a layer's name
  '../components/GridTemplatePanel.jsx': 1,    // the search
  '../components/film/FilmDock.jsx': 1,        // go to a timecode
  '../components/CommentInlinePopover.jsx': 1, // a doc comment's reply
  '../components/RichNoteEditor.jsx': 1,
};

test('every text field on the canvas and its bars asks the shared rule first', () => {
  for (const [file, n] of Object.entries(FIELDS)) {
    const src = read(file);
    assert.match(src, IMPORTS_RULE, `${file} imports isComposingKey`);
    const guards = src.match(GUARD) || [];
    assert.ok(guards.length >= n, `${file}: ${guards.length} of its ${n} field(s) guarded`);
  }
});

// The pickers' list keys and the shared dismissal: Enter mid-syllable picked
// the highlighted row in Safari (its composition has ended by the keydown, so
// only keyCode 229 marks it), and Escape mid-syllable closed the tag picker.
test('a picker\'s Enter and a popover\'s Escape leave a syllable to the input method', () => {
  for (const file of ['../hooks/useListboxNav.js', '../hooks/useDismissOnOutside.js', '../hooks/useAnchoredPopover.js']) {
    const src = read(file);
    assert.match(src, IMPORTS_RULE, `${file} imports isComposingKey`);
    assert.match(src, /isComposingKey\(e\)/, `${file} asks it`);
  }
  assert.doesNotMatch(read('../hooks/useListboxNav.js'), /nativeEvent\?\.isComposing/, 'no rule of its own');
});
