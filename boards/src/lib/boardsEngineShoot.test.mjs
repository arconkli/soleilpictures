// The shoot's sub-cluster preview wait (previewsDrawn), against a tiny fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { previewsDrawn, previewWait } from '../../scripts/engine/shoot.mjs';

const rect = { width: 200, bottom: 300, right: 300, top: 100, left: 100 };
const card = ({ title, wrap = null, rectOf = rect }) => ({
  getBoundingClientRect: () => rectOf,
  querySelector: (sel) => (sel.includes('.bc-name') ? { textContent: ` ${title} ` } : sel === '.bc-thumb-wrap' ? wrap : null),
});
const wrapOf = (...els) => ({ querySelectorAll: () => els });
const doc = (...cards) => ({ querySelectorAll: () => cards });
const run = (titles, ...cards) => previewsDrawn({ titles }, doc(...cards), 1000, 800);

test('a card for a sub-cluster with cards is not settled until its wrap holds a drawn picture', () => {
  assert.equal(run(['Locations'], card({ title: 'Locations' })), false, 'a placeholder: no wrap yet');
  assert.equal(run(['Locations'], card({ title: 'Locations', wrap: wrapOf() })), false, 'a wrap with nothing drawn');
  assert.equal(run(['Locations'], card({ title: 'Locations', wrap: wrapOf({ tagName: 'IMG', complete: false, naturalWidth: 0 }) })), false);
  assert.equal(run(['Locations'], card({ title: 'Locations', wrap: wrapOf({ tagName: 'IMG', complete: true, naturalWidth: 40 }) })), true);
  assert.equal(run(['Locations'], card({ title: 'Locations', wrap: wrapOf({ tagName: 'svg' }) })), true);
});

test('a card for a child with no cards, or one out of view, is settled without a wrap', () => {
  assert.equal(run(['Locations'], card({ title: 'Empty' })), true);
  assert.equal(run(['Locations'], card({ title: 'Locations', rectOf: { ...rect, left: 2000 } })), true);
});

test('after a preview that never drew is reported, later shots wait 2 s instead of 20 s', () => {
  const state = {};
  assert.equal(previewWait(state), 20000);
  state.previewReported = true;
  assert.equal(previewWait(state), 2000);
});
