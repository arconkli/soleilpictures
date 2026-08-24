// The tab-title composition rule.
//
// The bug this locks down: a tab showing a cluster used to read
// "Soleil Clusters — Creative Workspace & Moodboard for Production Teams",
// identically for every cluster you had open, because nothing in the signed-in
// app ever set document.title. Meanwhile the signed-OUT share viewer did set
// it — so the person you sent a board to got a better tab than the person who
// made it.
//
// composeTitle is pure and carries the entire rule, so the interesting cases
// are assertable without a DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeTitle } from './documentTitle.js';

const SERVED = 'Soleil Clusters — Creative Workspace & Moodboard for Production Teams';

test('a named cluster gets its own tab', () => {
  assert.equal(
    composeTitle({ base: 'Scene 4 — diner', badge: '', served: SERVED }),
    'Scene 4 — diner — Soleil Clusters',
  );
});

test('an unnamed surface keeps the served marketing title', () => {
  // Parking on the home graph should not blank the tab out.
  assert.equal(composeTitle({ base: null, badge: '', served: SERVED }), SERVED);
});

test('the badge composes with a cluster name instead of replacing it', () => {
  // The whole point of the module. Previously these two were separate writers
  // and the later one erased the earlier.
  assert.equal(
    composeTitle({ base: 'Costume', badge: '(3) ', served: SERVED }),
    '(3) Costume — Soleil Clusters',
  );
  assert.equal(
    composeTitle({ base: 'Costume', badge: '(@2) ', served: SERVED }),
    '(@2) Costume — Soleil Clusters',
  );
});

test('the badge still works on an unnamed surface', () => {
  assert.equal(composeTitle({ base: null, badge: '(3) ', served: SERVED }), `(3) ${SERVED}`);
});

test('no served title falls back to the bare product name, never to empty', () => {
  assert.equal(composeTitle({ base: null, badge: '', served: null }), 'Soleil Clusters');
  assert.equal(composeTitle({}), 'Soleil Clusters');
  assert.equal(composeTitle(), 'Soleil Clusters');
});

test('composing is idempotent — no badge stacking on repeat calls', () => {
  // The old implementation had to regex its own prefix back off precisely
  // because it re-read its previous output. This one never reads its output.
  const once = composeTitle({ base: 'A', badge: '(1) ', served: SERVED });
  const twice = composeTitle({ base: 'A', badge: '(1) ', served: SERVED });
  assert.equal(once, twice);
  assert.equal(once, '(1) A — Soleil Clusters');
});
