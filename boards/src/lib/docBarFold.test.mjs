// docBarFold.test.mjs — the doc's one row of tools (the owner's pick
// "A + C's side panel", 2026-10-21) folds into ⋯ as its room narrows, in a
// fixed order, and is always one row.
//
//   node --test src/lib/docBarFold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docBarGroups, docBarWidth, docBarFit, DOC_BAR_SIZES, FOLD_STEPS, SCRIPT_FOLD_STEPS } from './docBarFold.js';

const ids = (groups) => groups.map((g) => g.join(' '));

test('with room, the whole row: the mockup\'s desktop bar', () => {
  assert.deepEqual(ids(docBarGroups(0)), [
    'doc', 'undo redo', 'style font size',
    'bold italic underline strike code color clear',
    'bullet ordered task align', 'link comment', 'insert', 'find more',
  ]);
});

test('with the side panel open it reads as the mockup\'s: find, fonts, the rarer marks and align in ⋯', () => {
  assert.deepEqual(ids(docBarGroups(4)), [
    'doc', 'undo redo', 'style', 'bold italic underline color',
    'bullet ordered task', 'link comment', 'insert more',
  ]);
});

test('docked, the narrowest row: the doc\'s icon, style, B I U, lists, link, comment, + and ⋯', () => {
  assert.deepEqual(ids(docBarGroups(FOLD_STEPS.length)), [
    'docIcon', 'style', 'bold italic underline',
    'bullet ordered task', 'link comment', 'insert more',
  ]);
});

test('⋯ stays at the end, and is the only tool never folded', () => {
  for (let level = 0; level <= FOLD_STEPS.length; level++) {
    const flat = docBarGroups(level).flat();
    assert.equal(flat.at(-1), 'more', `level ${level}`);
  }
  assert.ok(!FOLD_STEPS.flat().includes('more'));
});

test('widths add up the way the CSS lays the row out', () => {
  const s = DOC_BAR_SIZES.desktop;
  // One group of three 32px buttons: 4 + 32*3 + 1*2 + 4.
  assert.equal(docBarWidth([['bold', 'italic', 'underline']], s), 4 + 96 + 2 + 4);
  // Two groups: + 9 between them.
  assert.equal(docBarWidth([['bold'], ['italic']], s), 4 + 32 + 9 + 32 + 4);
  // A select is its own width.
  assert.equal(docBarWidth([['style']], s), 4 + s.style + 4);
});

test('every step narrows the row', () => {
  for (const size of [DOC_BAR_SIZES.desktop, DOC_BAR_SIZES.touch]) {
    let last = Infinity;
    for (let level = 0; level <= FOLD_STEPS.length; level++) {
      const w = docBarWidth(docBarGroups(level), size);
      assert.ok(w < last, `level ${level} is ${w}, not under ${last}`);
      last = w;
    }
  }
});

test('the fit is the least folding that fits, and the narrowest when nothing does', () => {
  const s = DOC_BAR_SIZES.desktop;
  const full = docBarWidth(docBarGroups(0), s);
  assert.equal(docBarFit(full, s), 0);
  assert.equal(docBarFit(full - 1, s), 1);
  const ac = docBarWidth(docBarGroups(4), s);
  assert.equal(docBarFit(ac, s), 4);
  assert.equal(docBarFit(ac - 1, s), 5);
  assert.equal(docBarFit(100, s), FOLD_STEPS.length);
});

test('what is folded, in order, for ⋯ to hold', () => {
  assert.deepEqual(docBarGroups.folded(0), []);
  assert.deepEqual(docBarGroups.folded(2), ['find', 'font', 'size']);
  assert.deepEqual(docBarGroups.folded(FOLD_STEPS.length),
    ['find', 'font', 'size', 'strike', 'code', 'clear', 'align', 'undo', 'redo', 'color', 'docLabel']);
});

// A screenplay's row (the mockup's AC-script): its element, title page, scene
// numbers and dual dialogue are the side panel's Elements, so the row is its
// type, undo and redo, link, comment and bookmark, and ⋯.
test('a screenplay\'s row: Screenplay ▾ | ↶ ↷ | link comment bookmark | ⋯', () => {
  assert.deepEqual(ids(docBarGroups(0, 'script')), ['script', 'undo redo', 'link comment bookmark', 'more']);
});

test('a screenplay\'s row folds the bookmark, the link, undo and redo, then its name', () => {
  assert.deepEqual(ids(docBarGroups(1, 'script')), ['script', 'undo redo', 'link comment', 'more']);
  assert.deepEqual(ids(docBarGroups(SCRIPT_FOLD_STEPS.length, 'script')), ['scriptIcon', 'comment', 'more']);
  assert.deepEqual(docBarGroups.folded(2, 'script'), ['bookmark', 'link']);
  for (let level = 0; level <= SCRIPT_FOLD_STEPS.length; level++) {
    assert.equal(docBarGroups(level, 'script').flat().at(-1), 'more', `level ${level}`);
  }
});

test('a screenplay\'s row narrows at every step, and fits where the doc\'s folds', () => {
  for (const size of [DOC_BAR_SIZES.desktop, DOC_BAR_SIZES.touch]) {
    let last = Infinity;
    for (let level = 0; level <= SCRIPT_FOLD_STEPS.length; level++) {
      const w = docBarWidth(docBarGroups(level, 'script'), size);
      assert.ok(w < last, `level ${level} is ${w}, not under ${last}`);
      last = w;
    }
  }
  const s = DOC_BAR_SIZES.desktop;
  // The Screenplay select is its own width, wider than Doc's.
  assert.equal(docBarWidth([['script']], s), 4 + s.script + 4);
  assert.ok(s.script > s.doc);
  // Whole in a pane beside another doc (~520px), where the doc's row folds.
  assert.equal(docBarFit(520, s, 'script'), 0);
  assert.ok(docBarFit(520, s) > 0);
  assert.equal(docBarFit(10, s, 'script'), SCRIPT_FOLD_STEPS.length);
});
