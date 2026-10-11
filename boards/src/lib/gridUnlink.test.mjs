// A linked grid leaving its cluster (copied or moved through Files) takes the
// shared template's layout along and drops its links — the other board has
// neither the template nor the sequence (lib/gridState.js unlinkGridForCopy).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkGridForCopy } from './gridState.js';

const LAYOUT = { rows: 2, cols: 2 };
const templates = { t1: { id: 't1', name: 'Shot', layout: LAYOUT, textStyle: { size: 14 } } };

test('a linked grid carries its template layout and family style, without the links', () => {
  const out = unlinkGridForCopy({ id: 'g', kind: 'grid', templateId: 't1', seqId: 's1' }, templates);
  assert.deepEqual(out.layout, LAYOUT);
  assert.deepEqual(out.textStyle, { size: 14 });
  assert.equal('templateId' in out, false);
  assert.equal('seqId' in out, false);
});

test("the card's own text style wins over the template's", () => {
  const out = unlinkGridForCopy({ id: 'g', kind: 'grid', templateId: 't1', textStyle: { size: 18 } }, templates);
  assert.deepEqual(out.textStyle, { size: 18 });
});

test('a missing template falls back to the layout the card already had', () => {
  const out = unlinkGridForCopy({ id: 'g', kind: 'grid', templateId: 'gone', layout: { rows: 1, cols: 3 } }, templates);
  assert.deepEqual(out.layout, { rows: 1, cols: 3 });
  assert.equal('templateId' in out, false);
});

test('a card with no links comes back as it was', () => {
  const card = { id: 'n', kind: 'note', html: '<p>hi</p>' };
  assert.equal(unlinkGridForCopy(card, templates), card);
  assert.equal(unlinkGridForCopy(null, templates), null);
});

import { gridLinkOf, relinkGrid } from './gridState.js';

test("a move's undo puts the link back: the grid rejoins its family and sequence", () => {
  const before = { id: 'g', kind: 'grid', templateId: 't1', seqId: 's1' };
  const place = gridLinkOf(before);
  const moved = unlinkGridForCopy(before, templates);           // what arrived on the other board
  const back = relinkGrid(moved, place, { hasTemplate: (t) => t === 't1', hasSequence: (q) => q === 's1' });
  assert.equal(back.templateId, 't1');
  assert.equal(back.seqId, 's1');
  assert.equal('layout' in back, false);      // the family's layout, not a frozen copy
  assert.equal('textStyle' in back, false);
});

test('a template or sequence that has gone since keeps the layout the move wrote', () => {
  const before = { id: 'g', kind: 'grid', templateId: 't1', seqId: 's1' };
  const back = relinkGrid(unlinkGridForCopy(before, templates), gridLinkOf(before), {});
  assert.deepEqual(back.layout, LAYOUT);
  assert.equal('templateId' in back, false);
  assert.equal('seqId' in back, false);
});

test('an unlinked card is left alone', () => {
  const card = { id: 'n', kind: 'note' };
  assert.equal(relinkGrid(card, gridLinkOf(card), { hasTemplate: () => true }), card);
});
