// The wheel modifier matrix, both modes, every modifier.
//
// Two things are worth failing a build over.
//
//   1. Pan mode must stay byte-for-byte what shipped before the preference
//      existed. Everyone currently using the app is on it, and a preference
//      that quietly changes the default is a regression wearing a feature's
//      clothes.
//
//   2. ctrl+wheel must mean zoom in BOTH modes. That is not a modifier choice —
//      it is how macOS and Windows deliver a trackpad pinch to the page. Making
//      ctrl mean pan in zoom mode would silently break pinch-to-zoom for every
//      laptop user, and nothing else in the suite would notice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWheelIntent, WHEEL_MODES, DEFAULT_WHEEL_MODE } from './wheelMode.js';

const wheel = (over = {}) => ({
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  deltaX: 0, deltaY: 100, ...over,
});

test('pan is the default, and is one of the modes', () => {
  assert.equal(DEFAULT_WHEEL_MODE, 'pan');
  assert.ok(WHEEL_MODES.includes('pan') && WHEEL_MODES.includes('zoom'));
});

test('pan mode is exactly what shipped before the preference existed', () => {
  const pan = (over) => resolveWheelIntent({ mode: 'pan', ...wheel(over) });
  assert.equal(pan({}), 'pan', 'plain wheel pans');
  assert.equal(pan({ ctrlKey: true }), 'zoom');
  assert.equal(pan({ metaKey: true }), 'zoom');
  assert.equal(pan({ shiftKey: true }), 'pan', 'shift never zoomed here');
  assert.equal(pan({ altKey: true }), 'pan');
  assert.equal(pan({ deltaX: 200, deltaY: 0 }), 'pan', 'horizontal trackpad swipe');
});

test('zoom mode: a plain wheel zooms — the whole point', () => {
  assert.equal(resolveWheelIntent({ mode: 'zoom', ...wheel() }), 'zoom');
  assert.equal(resolveWheelIntent({ mode: 'zoom', ...wheel({ deltaY: -100 }) }), 'zoom');
});

test('zoom mode: the modifiers become the pan gestures', () => {
  const zoom = (over) => resolveWheelIntent({ mode: 'zoom', ...wheel(over) });
  assert.equal(zoom({ metaKey: true }), 'pan');
  assert.equal(zoom({ altKey: true }), 'pan', 'Windows has no cmd — alt is the escape hatch');
  assert.equal(zoom({ shiftKey: true }), 'pan');
});

test('zoom mode: a horizontal trackpad swipe stays a swipe', () => {
  assert.equal(resolveWheelIntent({ mode: 'zoom', ...wheel({ deltaX: 120, deltaY: 4 }) }), 'pan');
  // Vertical-dominant with a little horizontal drift is still a zoom.
  assert.equal(resolveWheelIntent({ mode: 'zoom', ...wheel({ deltaX: 4, deltaY: 120 }) }), 'zoom');
});

test('ctrl+wheel zooms in EVERY mode — this is trackpad pinch', () => {
  for (const mode of WHEEL_MODES) {
    assert.equal(resolveWheelIntent({ mode, ...wheel({ ctrlKey: true }) }), 'zoom',
      `pinch must still zoom in ${mode} mode`);
    // Pinch with any other modifier held is still a pinch.
    assert.equal(resolveWheelIntent({ mode, ...wheel({ ctrlKey: true, altKey: true, shiftKey: true }) }), 'zoom');
    // Pinch reports horizontal drift on some trackpads; still a pinch.
    assert.equal(resolveWheelIntent({ mode, ...wheel({ ctrlKey: true, deltaX: 300, deltaY: 1 }) }), 'zoom');
  }
});

test('an unknown or missing mode falls back to pan, never to zoom', () => {
  // A corrupt localStorage blob or an older/newer client must not silently
  // hand someone the non-default gesture.
  for (const bogus of [undefined, null, '', 'ZOOM', 'scroll', 42, {}]) {
    assert.equal(resolveWheelIntent({ mode: bogus, ...wheel() }), 'pan');
  }
  assert.equal(resolveWheelIntent(), 'pan', 'no argument at all');
});

test('every mode × modifier combination resolves to pan or zoom', () => {
  // Exhaustive: the handler branches on this string and has no third case.
  for (const mode of [...WHEEL_MODES, 'nonsense']) {
    for (const ctrlKey of [false, true]) {
      for (const metaKey of [false, true]) {
        for (const altKey of [false, true]) {
          for (const shiftKey of [false, true]) {
            for (const [deltaX, deltaY] of [[0, 100], [0, -100], [100, 0], [0, 0]]) {
              const got = resolveWheelIntent({ mode, ctrlKey, metaKey, altKey, shiftKey, deltaX, deltaY });
              assert.ok(got === 'pan' || got === 'zoom', `${mode} ${ctrlKey}${metaKey}${altKey}${shiftKey} → ${got}`);
            }
          }
        }
      }
    }
  }
});
