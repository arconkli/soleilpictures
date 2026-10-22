// docBarFold.test.mjs — the doc's one row of tools (the owner's pick
// "A + C's side panel", 2026-10-21) folds into ⋯ as its room narrows, in a
// fixed order, and is always one row.
//
//   node --test src/lib/docBarFold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  docBarGroups, docBarWidth, docBarFit, docBarPhoneGroups, DOC_BAR_SIZES, FOLD_STEPS, TOUCH_FOLD_STEPS, SCRIPT_FOLD_STEPS,
} from './docBarFold.js';

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

test('docked, the doc\'s icon, style, B I U, lists, link, comment, + and ⋯', () => {
  assert.deepEqual(ids(docBarGroups(7)), [
    'docIcon', 'style', 'bold italic underline',
    'bullet ordered task', 'link comment', 'insert more',
  ]);
});

// A docked doc can be a quarter of the window (DocCard's side ratio), 320px
// of a 1280px screen: the row folds on until B I U, + and ⋯ are all there is,
// and that fits.
test('narrower still, the link, the lists and comment fold, then the doc\'s type, then its style', () => {
  assert.deepEqual(ids(docBarGroups(12)), ['docIcon', 'style', 'bold italic underline', 'insert more']);
  assert.deepEqual(ids(docBarGroups(FOLD_STEPS.length)), ['bold italic underline', 'insert more']);
  assert.deepEqual(docBarGroups.folded(FOLD_STEPS.length).slice(-7),
    ['link', 'ordered', 'comment', 'task', 'bullet', 'doc', 'style']);
  assert.ok(docBarWidth(docBarGroups(FOLD_STEPS.length), DOC_BAR_SIZES.desktop) <= 296);
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
  assert.deepEqual(docBarGroups.folded(7),
    ['find', 'font', 'size', 'strike', 'code', 'clear', 'align', 'undo', 'redo', 'color', 'docLabel']);
});

// Under a finger (A-ipad, AC-ipad) there's no ⌘F to find with, and less room
// for each tool: Find stays while the fonts, the rarer marks, alignment and
// the colour fold, and goes with undo and redo before the link, the numbered
// list and the doc's name.
test('under a finger, with room: the mockup\'s iPad row, Find kept', () => {
  assert.deepEqual(ids(docBarGroups(4, 'doc', 'touch')), [
    'doc', 'undo redo', 'style', 'bold italic underline',
    'bullet ordered task', 'link comment', 'insert', 'find more',
  ]);
  assert.deepEqual(docBarGroups.folded(4, 'doc', 'touch'), ['font', 'size', 'strike', 'code', 'clear', 'align', 'color']);
});

test('under a finger with the side panel open: the mockup\'s AC-ipad row', () => {
  assert.deepEqual(ids(docBarGroups(9, 'doc', 'touch')), [
    'docIcon', 'style', 'bold italic underline', 'bullet task', 'comment', 'insert more',
  ]);
});

test('an iPad\'s room picks those rows: the page beside the page list, and with the panel too', () => {
  const s = DOC_BAR_SIZES.touch;
  // A-ipad: 1194px across, the page list's 220 and the bar's margins off.
  assert.equal(docBarFit(870, s, 'doc', 'touch'), 4);
  // AC-ipad: the panel's 288 off that too.
  assert.equal(docBarFit(582, s, 'doc', 'touch'), 9);
});

test('under a finger every step narrows the row, and the narrowest is B I U, + and ⋯', () => {
  for (const size of [DOC_BAR_SIZES.desktop, DOC_BAR_SIZES.touch]) {
    let last = Infinity;
    for (let level = 0; level <= TOUCH_FOLD_STEPS.length; level++) {
      const w = docBarWidth(docBarGroups(level, 'doc', 'touch'), size);
      assert.ok(w < last, `level ${level} is ${w}, not under ${last}`);
      last = w;
    }
  }
  assert.deepEqual(ids(docBarGroups(TOUCH_FOLD_STEPS.length, 'doc', 'touch')), ['bold italic underline', 'insert more']);
  assert.ok(docBarWidth(docBarGroups(TOUCH_FOLD_STEPS.length, 'doc', 'touch'), DOC_BAR_SIZES.touch) <= 274);
  assert.equal(docBarFit(10, DOC_BAR_SIZES.touch, 'doc', 'touch'), TOUCH_FOLD_STEPS.length);
});

test('either way, every tool folds once, and ⋯ never', () => {
  for (const steps of [FOLD_STEPS, TOUCH_FOLD_STEPS]) {
    const flat = steps.flat();
    assert.equal(new Set(flat).size, flat.length);
    assert.ok(!flat.includes('more'));
  }
  assert.deepEqual([...FOLD_STEPS.flat()].sort(), [...TOUCH_FOLD_STEPS.flat()].sort());
});

// On a phone the tools ride on the keyboard (mockup A-phone), one row that
// scrolls sideways: the style, B I U, the lists, link and comment, + and ⋯,
// which holds the rest of the text's tools. A screenplay's is its element,
// undo and redo, link, comment and bookmark.
test('a phone\'s row over the keyboard', () => {
  assert.deepEqual(ids(docBarPhoneGroups('doc')), [
    'style', 'bold italic underline', 'bullet ordered task', 'link comment', 'insert more',
  ]);
  assert.deepEqual(docBarPhoneGroups.folded('doc'),
    ['font', 'size', 'strike', 'code', 'color', 'clear', 'align', 'undo', 'redo']);
  assert.deepEqual(ids(docBarPhoneGroups('script')), ['element', 'undo redo', 'link comment bookmark']);
  assert.deepEqual(docBarPhoneGroups.folded('script'), []);
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
