// depthDock.test.mjs — node --test src/lib/depthDock.test.mjs
//
// The bands matter more than the mechanism. A dock that shows at zero cards
// double-books the empty panel; one that shows past the threshold is nagging a
// board that is already worth returning to; one that throws on a null takes the
// canvas down on a render path. All three are cheap to assert and expensive to
// find in production, which is exactly what happened to the near-cap warning
// this module is modelled on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowDepthDock, DEPTH_DOCK_MAX } from './depthDock.js';

const show = (o) => shouldShowDepthDock({ canEdit: true, ...o });

test('the band is [1, DEPTH_DOCK_MAX)', () => {
  assert.equal(show({ genuine: 0 }), false, 'at zero the empty panel already owns the message');
  assert.equal(show({ genuine: 1 }), true,  'one card is the whole point — the panel just vanished');
  assert.equal(show({ genuine: 5 }), true);
  assert.equal(show({ genuine: DEPTH_DOCK_MAX }), false, 'at the threshold the board carries itself');
  assert.equal(show({ genuine: DEPTH_DOCK_MAX + 40 }), false);
});

test('a custom max moves the band with it', () => {
  assert.equal(show({ genuine: 6, max: 10 }), true);
  assert.equal(show({ genuine: 10, max: 10 }), false);
});

test('permission and surface gates win over the count', () => {
  assert.equal(shouldShowDepthDock({ genuine: 3, canEdit: false }), false, 'read-only viewers get no add affordance');
  assert.equal(show({ genuine: 3, isPublic: true }), false, 'never on a public share view');
  assert.equal(show({ genuine: 3, dismissed: true }), false, 'waving it away has to stick');
});

test('canEdit is opt-in, not assumed', () => {
  // The real caller passes canEdit explicitly; if the default ever flips to
  // true, a public board would start offering an upload button.
  assert.equal(shouldShowDepthDock({ genuine: 3 }), false);
});

test('junk input returns false instead of throwing into a render', () => {
  // `{a} = {}` covers undefined but NOT null — the exact shape that broke
  // shouldWarnNearCap, caught by its own junk-input case.
  assert.doesNotThrow(() => shouldShowDepthDock(null));
  assert.equal(shouldShowDepthDock(null), false);
  assert.equal(shouldShowDepthDock(undefined), false);
  assert.equal(show({ genuine: null }), false);
  assert.equal(show({ genuine: undefined }), false);
  assert.equal(show({ genuine: NaN }), false);
  assert.equal(show({ genuine: 'lots' }), false);
  assert.equal(show({ genuine: 3, max: NaN }), false);
  assert.equal(show({ genuine: -2 }), false, 'a negative count is nonsense, not "below the threshold"');
});

test('a numeric string still reads as a count', () => {
  // cards.length is always a number today, but Number() coercion is the
  // contract the near-cap rule set and divergence between the two is a trap.
  assert.equal(show({ genuine: '3' }), true);
});
