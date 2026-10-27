// adminNav.test.mjs — node --test src/lib/adminNav.test.mjs
//
// The admin header shows PRIMARY_IDS as pills and folds OVERFLOW_IDS into the
// More menu. A tab added to TABS (and to the render switch) but to neither list
// renders fine and is unreachable: that is how the Audit tab shipped, reachable
// only by typing ?tab=audit. The page needs auth to mount, and the DEV harness
// draws its own tab bar, so the three lists are read straight out of the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../pages/AdminPage.jsx', import.meta.url), 'utf8');

function list(re, what) {
  const m = src.match(re);
  assert.ok(m, `could not find ${what} in AdminPage.jsx`);
  return [...m[1].matchAll(/'([a-z0-9_-]+)'/g)].map((x) => x[1]);
}

const TABS = [...(src.match(/const TABS = \[([\s\S]*?)\];/)?.[1] || '').matchAll(/id:\s*'([a-z0-9_-]+)'/g)].map((x) => x[1]);
const PRIMARY = list(/const PRIMARY_IDS = \[([^\]]*)\]/, 'PRIMARY_IDS');
const OVERFLOW = list(/const OVERFLOW_IDS = \[([^\]]*)\]/, 'OVERFLOW_IDS');

test('every tab is reachable from the header, exactly once', () => {
  assert.ok(TABS.length > 5, 'TABS parsed');
  const shown = [...PRIMARY, ...OVERFLOW];
  for (const id of TABS) {
    assert.equal(shown.filter((x) => x === id).length, 1, `tab '${id}' is in neither the pills nor More, or in both`);
  }
  for (const id of shown) assert.ok(TABS.includes(id), `'${id}' is listed in the header but is not a tab`);
});

test('the Audit tab is in More', () => {
  assert.ok(OVERFLOW.includes('audit'));
});

test('Talk to us is in More', () => {
  assert.ok(OVERFLOW.includes('talk'));
});

test('Waitlist and Campaign are in More: the waitlist is switched off', () => {
  for (const id of ['waitlist', 'campaign']) {
    assert.ok(OVERFLOW.includes(id), `${id} is in More`);
    assert.ok(!PRIMARY.includes(id), `${id} is not a pill`);
  }
});
