// The boards engine's text on the board (scripts/engine/build.mjs): image
// captions that fit their one line. (A script is the app's own screenplay doc
// now: boardsEngine.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCaption } from '../../scripts/engine/build.mjs';

test('captions: one line over the picture, cut to whole words or left off', () => {
  assert.equal(fitCaption('Relief boat', 300), 'Relief boat');
  assert.equal(fitCaption('Opening wide. Hold it longer than feels right', 200), 'Opening wide. Hold it');
  assert.equal(fitCaption('Lighthouse keepers cottage', 80), null); // fewer than two words would fit
  assert.equal(fitCaption('3 · CLOSE — brake lever', 120), '3 · CLOSE');
});
