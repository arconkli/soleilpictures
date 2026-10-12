// filmHud.test.mjs — what the review player says on screen (lib/filmHud.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hudText, shuttleText } from './filmHud.js';

test('shuttle shows only when it isn’t plain play', () => {
  assert.equal(shuttleText({ dir: 1, rate: 1 }), null);
  assert.equal(shuttleText({ dir: 1, rate: 4 }), '▶▶ 4×');
  assert.equal(shuttleText({ dir: -1, rate: 1 }), '◀ 1×');
  assert.equal(shuttleText({ dir: -1, rate: 2 }), '◀◀ 2×');
  assert.equal(shuttleText({ dir: 0, rate: 1 }), null);
});

test('messages', () => {
  assert.equal(hudText('firstFrame'), 'First frame');
  assert.equal(hudText('loopOn', { whole: true }), 'Loop on · whole clip');
  assert.equal(hudText('out', { tc: '00:00:01:00', frames: 25 }), 'Out 00:00:01:00 · 25 fr');
  assert.equal(hudText('speed', { rate: 0.5 }), 'Speed 0.5×');
  assert.equal(hudText('volume', { volume: 0.6 }), 'Volume 60%');
  assert.equal(hudText('guide', { label: '2.39:1' }), 'Guides 2.39:1');
  assert.equal(hudText('guide', {}), 'Guides off');
  assert.equal(hudText('copied', { tc: '01:00:00:00' }), 'Copied 01:00:00:00');
  assert.equal(hudText('nope'), null);
});
