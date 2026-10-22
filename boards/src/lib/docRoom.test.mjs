// How much room a doc has where it is shown, from what DocSurface measures:
// a doc docked beside the board, or one of two side by side, can be as narrow
// as a phone's on any screen, so the layout follows the space, not the device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SHEET_W, PAPER_PAD_X, TIGHT_W, RAIL_ROOM_W, GIVE, paperRoom, railRoom } from './docRoom.js';
import { PAGE_W } from '../components/docExtensions/DocPagination.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(SRC, 'styles.css'), 'utf8');

test('the sheet and the paper\'s padding are the ones the page and the CSS use', () => {
  assert.equal(SHEET_W, PAGE_W);
  assert.match(css, /\.doc-paper \{[^}]*padding: 32px 24px 96px;/, 'the paper\'s own 24px a side');
  assert.equal(PAPER_PAD_X, 48);
});

test('a paper that holds an actual-size sheet has room for the page', () => {
  assert.equal(paperRoom(SHEET_W + PAPER_PAD_X), 'page');
  assert.equal(paperRoom(1400), 'page');
});

test('a paper narrower than the sheet is narrow, and as narrow as a phone\'s is tight', () => {
  assert.equal(paperRoom(SHEET_W + PAPER_PAD_X - 1), 'narrow');
  assert.equal(paperRoom(700), 'narrow');
  assert.equal(paperRoom(TIGHT_W + 1), 'narrow');
  assert.equal(paperRoom(TIGHT_W), 'tight');
  assert.equal(paperRoom(390), 'tight');
});

test('each line gives a little on the way back, so a scrollbar coming and going cannot flip it', () => {
  const edge = SHEET_W + PAPER_PAD_X;
  assert.equal(paperRoom(edge, 'narrow'), 'narrow', 'back at the line: still narrow');
  assert.equal(paperRoom(edge + GIVE - 1, 'narrow'), 'narrow');
  assert.equal(paperRoom(edge + GIVE, 'narrow'), 'page');
  assert.equal(paperRoom(edge - 1, 'page'), 'narrow', 'going in needs no give');
  assert.equal(paperRoom(TIGHT_W + GIVE, 'tight'), 'tight');
  assert.equal(paperRoom(TIGHT_W + GIVE + 1, 'tight'), 'narrow');
  assert.equal(paperRoom(TIGHT_W + 1, 'narrow'), 'narrow');
});

test('a paper not laid out yet keeps what it had', () => {
  assert.equal(paperRoom(0, 'tight'), 'tight');
  assert.equal(paperRoom(NaN), 'page');
});

test('the page list fits beside a page while the surface has room for both, with the same give', () => {
  assert.equal(railRoom(RAIL_ROOM_W), true);
  assert.equal(railRoom(RAIL_ROOM_W - 1), false);
  assert.equal(railRoom(RAIL_ROOM_W, false), false, 'tucked: back at the line is not enough');
  assert.equal(railRoom(RAIL_ROOM_W + GIVE, false), true);
  assert.equal(railRoom(0, false), false);
  assert.equal(railRoom(0), true);
});
