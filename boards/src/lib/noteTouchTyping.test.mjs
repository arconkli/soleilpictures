// lib/noteTouchTyping.js: what a phone's note editor types with, and how far
// the board glides so the keyboard and the note bar never cover the line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keeperCapitals, noteTypingAttrs, typingBand, clampToBox, revealDelta } from './noteTouchTyping.js';

const win = ({ coarse = false, innerHeight = 800, vv = null } = {}) => ({
  innerHeight,
  visualViewport: vv,
  matchMedia: (q) => ({ matches: q === '(pointer: coarse)' && coarse }),
});
const el = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) });

test('a phone or tablet types with autocorrect, capitals and spellcheck; a computer with spellcheck off', () => {
  assert.deepEqual(noteTypingAttrs(win({ coarse: true })), { spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' });
  assert.deepEqual(noteTypingAttrs(win({ coarse: false })), { spellcheck: 'false' });
  assert.deepEqual(noteTypingAttrs(null), { spellcheck: 'false' });
  assert.deepEqual(noteTypingAttrs({ matchMedia: () => { throw new Error('old browser'); } }), { spellcheck: 'false' });
});

test('the band is the visual viewport, within the board, above the note bar', () => {
  // Keyboard up: 800px window, 420px of it showing, scrolled 30px.
  const w = win({ vv: { offsetTop: 30, height: 420, scale: 1 } });
  assert.deepEqual(typingBand(w, el(56, 800), el(380, 430)), { top: 68, bottom: 368 });
  // No keyboard, no bar: the board.
  assert.deepEqual(typingBand(win({ vv: { offsetTop: 0, height: 800, scale: 1 } }), el(56, 800), null), { top: 68, bottom: 788 });
  // A bar in the upper half doesn't cut the band.
  assert.deepEqual(typingBand(win({ vv: { offsetTop: 0, height: 800, scale: 1 } }), el(0, 800), el(10, 60)), { top: 12, bottom: 788 });
  // Pinch-zoomed: no band, the board stays put.
  assert.equal(typingBand(win({ vv: { offsetTop: 0, height: 300, scale: 2 } }), el(0, 800), null), null);
  // No visualViewport: the window.
  assert.deepEqual(typingBand(win({ innerHeight: 600 }), null, null), { top: 12, bottom: 588 });
});

test('the board moves just enough, up or down, and not at all when the line shows', () => {
  const band = { top: 68, bottom: 368 };
  assert.equal(revealDelta({ top: 300, bottom: 320 }, band), 0);
  assert.equal(revealDelta({ top: 500, bottom: 520 }, band), -152);
  assert.equal(revealDelta({ top: 20, bottom: 40 }, band), 48);
  assert.equal(revealDelta({ top: 0, bottom: 1000 }, band), 68, 'taller than the band: its top shows');
  assert.equal(revealDelta(null, band), 0);
  assert.equal(revealDelta({ top: 500, bottom: 520 }, null), 0);
});

test("a caret below a scrolling note's edge counts as the edge", () => {
  assert.deepEqual(clampToBox({ top: 900, bottom: 920 }, { top: 100, bottom: 400 }), { top: 400, bottom: 400 });
  assert.deepEqual(clampToBox({ top: 200, bottom: 220 }, { top: 100, bottom: 400 }), { top: 200, bottom: 220 });
  assert.deepEqual(clampToBox({ top: 200, bottom: 220 }, null), { top: 200, bottom: 220 });
});

test('keeperCapitals: a capital where a sentence starts, none inside one', () => {
  assert.equal(keeperCapitals('', ''), 'sentences');
  assert.equal(keeperCapitals('   ', 'harbour'), 'sentences');
  assert.equal(keeperCapitals('Boats rest.', ''), 'sentences');
  assert.equal(keeperCapitals('Boats rest. ', 'gulls'), 'sentences');
  assert.equal(keeperCapitals('He said "Stop!" ', ''), 'sentences');
  assert.equal(keeperCapitals('Boats in the ', 'harbour'), 'none');
  assert.equal(keeperCapitals('Boats in the', ''), 'none');
  assert.equal(keeperCapitals('3 boats,', ''), 'none');
});

test('keeperCapitals: a point inside a word goes to its nearer edge, a tie to the end', () => {
  assert.equal(keeperCapitals('Boats. Gu', 'lls'), 'sentences');
  assert.equal(keeperCapitals('Boats. Gull', 's'), 'none');
  assert.equal(keeperCapitals('Boats. Gu', 'll'), 'none');
  assert.equal(keeperCapitals('ha', 'rbour'), 'sentences');
  // An apostrophe stays inside a word, as the editor's wordAt has it.
  assert.equal(keeperCapitals('Ok. Do', "n't stop"), 'sentences');
  assert.equal(keeperCapitals('Ok. Do', 'n’t stop'), 'sentences');
});
