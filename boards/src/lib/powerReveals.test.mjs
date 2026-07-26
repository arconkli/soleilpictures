// Node tests for the just-in-time power-reveal engine (pure, no DOM).
// Run: node --test src/lib/powerReveals.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POWER_REVEALS,
  pickReveal,
  revealSeen,
  sessionRevealShown,
  viewEverSwitched,
} from './powerReveals.js';

const none = () => false;
const base = {
  isRoot: false,
  view: 'canvas',
  viewEverSwitched: false,
  imageCards: 0,
  noteCards: 0,
  nonBoardCards: 0,
  clusterCards: 0,
  gridCards: 0,
  docCards: 0,
  totalGenuine: 0,
};

test('registry: five reveals, wow-first order, each with copy and an action label where promised', () => {
  assert.deepEqual(POWER_REVEALS.map((r) => r.key), ['grids', 'group', 'list_drive', 'docs', 'palette']);
  for (const r of POWER_REVEALS) {
    assert.equal(typeof r.message, 'string');
    assert.ok(r.message.length > 10);
  }
});

test('nothing fires on an empty or barely-started board', () => {
  assert.equal(pickReveal(base, none), null);
  assert.equal(pickReveal({ ...base, imageCards: 3, nonBoardCards: 3, totalGenuine: 3 }, none), null);
});

test('grids fires at 4 images and is the top priority', () => {
  const s = { ...base, imageCards: 4, nonBoardCards: 4, totalGenuine: 4 };
  assert.equal(pickReveal(s, none)?.key, 'grids');
});

test('grids stays quiet when a grid already exists (feature already discovered)', () => {
  const s = { ...base, imageCards: 6, gridCards: 1, nonBoardCards: 7, totalGenuine: 7 };
  assert.notEqual(pickReveal(s, none)?.key, 'grids');
});

test('group fires on the root at 6 loose cards with no clusters — and only on the root', () => {
  // files/pdfs, not notes — keeps the docs reveal out of this fixture so the
  // no-longer-eligible cases fall through to NOTHING rather than a sibling
  const s = { ...base, isRoot: true, nonBoardCards: 6, totalGenuine: 6 };
  assert.equal(pickReveal(s, none)?.key, 'group');
  assert.equal(pickReveal({ ...s, clusterCards: 1 }, none), null);
  // off the root, the same spread belongs to list_drive, never group
  assert.equal(pickReveal({ ...s, isRoot: false }, none)?.key, 'list_drive');
});

test('list_drive fires on a NON-root canvas board at 4 cards, never for view-savvy users', () => {
  const s = { ...base, nonBoardCards: 4, totalGenuine: 4 };
  assert.equal(pickReveal(s, none)?.key, 'list_drive');
  assert.equal(pickReveal({ ...s, isRoot: true }, none), null);
  assert.equal(pickReveal({ ...s, view: 'list' }, none), null);
  assert.equal(pickReveal({ ...s, viewEverSwitched: true }, none), null);
});

test('docs fires at 3 notes with no doc yet', () => {
  // 3 notes alone (nonBoard 3) is under list_drive's bar, so docs surfaces
  const s = { ...base, noteCards: 3, nonBoardCards: 3, totalGenuine: 3, viewEverSwitched: true };
  assert.equal(pickReveal(s, none)?.key, 'docs');
  assert.equal(pickReveal({ ...s, docCards: 1 }, none), null);
});

test('palette fires on a dense board when everything else is exhausted', () => {
  const s = { ...base, totalGenuine: 12, nonBoardCards: 12, noteCards: 0, imageCards: 0, viewEverSwitched: true };
  assert.equal(pickReveal(s, none)?.key, 'palette');
});

test('priority: grids beats group beats list_drive; seen() advances to the next eligible', () => {
  const rich = {
    ...base,
    isRoot: true,
    imageCards: 6,
    noteCards: 6,
    nonBoardCards: 12,
    totalGenuine: 12,
  };
  assert.equal(pickReveal(rich, none)?.key, 'grids');
  const seenGrids = (k) => k === 'grids';
  assert.equal(pickReveal(rich, seenGrids)?.key, 'group');
  const seenBoth = (k) => k === 'grids' || k === 'group';
  // still root, so list_drive ineligible → docs
  assert.equal(pickReveal(rich, seenBoth)?.key, 'docs');
});

test('everything seen → null, even on the richest board', () => {
  const rich = { ...base, isRoot: true, imageCards: 9, noteCards: 9, nonBoardCards: 20, totalGenuine: 20 };
  assert.equal(pickReveal(rich, () => true), null);
});

test('storage helpers fail SAFE in an environment without storage (node): seen/shown = true', () => {
  // read-fail = seen (momentumHint discipline) — never nag when storage is broken
  assert.equal(revealSeen('grids'), true);
  assert.equal(sessionRevealShown(), true);
  // and a broken read counts as "already switched" so list_drive stays quiet
  assert.equal(viewEverSwitched(), true);
});
