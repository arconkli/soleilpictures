// The boards engine's text on the board (scripts/engine/build.mjs): a script
// page laid out as a screenplay, and image captions that fit their one line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { screenplayHtml, fitCaption } from '../../scripts/engine/build.mjs';

test('script page: speeches centred, action left, a name needs a line under it', () => {
  const html = '<h2>4. INT. HUT - NIGHT</h2><p>Rain on the roof.</p><p></p><p>NEIL</p><p>(quiet)</p><p>It&#39;ll take a day.</p>'
    + '<p></p><p>Duncan writes.</p><p></p><p>MARY (V.O.)</p><p>Watch the weather.</p><p></p><p>FADE OUT.</p>';
  const out = screenplayHtml(html);
  const C = '<p style="text-align: center">';
  assert.ok(out.startsWith('<h2>4. INT. HUT - NIGHT</h2><p>Rain on the roof.</p>'));
  assert.ok(out.includes(`${C}NEIL</p>${C}(quiet)</p>${C}It&#39;ll take a day.</p>`));
  assert.ok(out.includes('<p>Duncan writes.</p>'));
  assert.ok(out.includes(`${C}MARY (V.O.)</p>${C}Watch the weather.</p>`));
  assert.ok(out.endsWith('<p>FADE OUT.</p>')); // capitals with nothing under it is a transition, not a speech
});

test('captions: one line over the picture, cut to whole words or left off', () => {
  assert.equal(fitCaption('Relief boat', 300), 'Relief boat');
  assert.equal(fitCaption('Opening wide. Hold it longer than feels right', 200), 'Opening wide. Hold it');
  assert.equal(fitCaption('Lighthouse keepers cottage', 80), null); // fewer than two words would fit
  assert.equal(fitCaption('3 · CLOSE — brake lever', 120), '3 · CLOSE');
});
