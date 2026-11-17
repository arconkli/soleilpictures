import test from 'node:test';
import assert from 'node:assert/strict';
import { placeMenu, placeFlyout } from './ctxMenuFit.js';
import { typeaheadIndex, inSafeTriangle, tidyMenu } from './menuKeys.js';

const win = { vw: 1000, vh: 800 };

test('placeMenu: fits at the pointer', () => {
  const p = placeMenu({ x: 100, y: 100, w: 240, h: 300, ...win });
  assert.deepEqual(p, { left: 100, top: 100, maxHeight: undefined, originX: 'left', originY: 'top' });
});
test('placeMenu: flips to the left of the pointer', () => {
  const p = placeMenu({ x: 900, y: 100, w: 240, h: 300, ...win });
  assert.equal(p.left, 660);
  assert.equal(p.originX, 'right');
});
test('placeMenu: clamps when neither side has room', () => {
  const p = placeMenu({ x: 100, y: 100, w: 300, h: 100, vw: 320, vh: 800 });
  assert.equal(p.left, 12);
});
test('placeMenu: flips up', () => {
  const p = placeMenu({ x: 100, y: 700, w: 240, h: 300, ...win });
  assert.equal(p.top, 400);
  assert.equal(p.originY, 'bottom');
  assert.equal(p.maxHeight, undefined);
});
test('placeMenu: pinned to the foot when neither side fits', () => {
  const p = placeMenu({ x: 100, y: 400, w: 240, h: 600, ...win });
  assert.equal(p.top, 800 - 8 - 600);
  assert.equal(p.maxHeight, undefined);
});
test('placeMenu: taller than the room scrolls', () => {
  const p = placeMenu({ x: 100, y: 400, w: 240, h: 900, ...win });
  assert.equal(p.top, 8);
  assert.equal(p.maxHeight, 800 - 16);
});
test('placeMenu: bottom excludes the tab bar', () => {
  const p = placeMenu({ x: 100, y: 500, w: 240, h: 200, ...win, bottom: 650 });
  assert.equal(p.top, 300);
});
test('placeMenu: above ends at y, capped when taller', () => {
  assert.equal(placeMenu({ x: 10, y: 500, w: 200, h: 300, ...win, above: true }).top, 200);
  const p = placeMenu({ x: 10, y: 200, w: 200, h: 300, ...win, above: true });
  assert.equal(p.top, 8);
  assert.equal(p.maxHeight, 192);
});

const menu = { left: 100, right: 340, top: 50, bottom: 400 };
test('placeFlyout: right when it fits, lined up with its row', () => {
  const f = placeFlyout({ menu, row: { top: 120 }, w: 200, h: 150, ...win });
  assert.equal(f.side, 'right');
  assert.equal(f.left, 342);
  assert.equal(f.top, 116);
});
test('placeFlyout: a 1280px window, menu 806..1038, 200px flyout opens right', () => {
  const m = { left: 806, right: 1038, top: 300, bottom: 640 };
  const f = placeFlyout({ menu: m, row: { top: 340 }, w: 200, h: 220, vw: 1280, vh: 800 });
  assert.equal(f.side, 'right');
  assert.equal(f.left, 1040);
  // Exactly to the pad still fits right; one pixel more goes left.
  assert.equal(placeFlyout({ menu: { ...m, right: 1070 }, row: { top: 340 }, w: 200, h: 220, vw: 1280, vh: 800 }).side, 'right');
  assert.equal(placeFlyout({ menu: { ...m, right: 1071 }, row: { top: 340 }, w: 200, h: 220, vw: 1280, vh: 800 }).side, 'left');
  // A flyout's own flyout asks for the side its parent went and still takes the right when it fits.
  assert.equal(placeFlyout({ menu: { left: 1040, right: 1240, top: 340, bottom: 560 }, row: { top: 380 }, w: 200, h: 100, vw: 1280, vh: 800, prefer: 'right' }).side, 'left');
});
test('placeFlyout: left when the right has no room', () => {
  const f = placeFlyout({ menu: { ...menu, left: 700, right: 940 }, row: { top: 120 }, w: 200, h: 150, ...win });
  assert.equal(f.side, 'left');
  assert.equal(f.left, 698 - 200);
});
test('placeFlyout: prefer left, and none', () => {
  assert.equal(placeFlyout({ menu, row: { top: 0 }, w: 50, h: 50, ...win, prefer: 'left' }).side, 'left');
  assert.equal(placeFlyout({ menu: { left: 150, right: 450, top: 0, bottom: 100 }, row: { top: 0 }, w: 400, h: 50, vw: 700, vh: 800 }).side, null);
});
test('placeFlyout: moves up to fit, floors at pad, caps when taller', () => {
  assert.equal(placeFlyout({ menu, row: { top: 700 }, w: 200, h: 300, ...win }).top, 492);
  assert.equal(placeFlyout({ menu, row: { top: 0 }, w: 200, h: 100, ...win }).top, 8);
  const f = placeFlyout({ menu, row: { top: 300 }, w: 200, h: 900, ...win });
  assert.equal(f.top, 8);
  assert.equal(f.maxHeight, 784);
});

const rect = { left: 300, right: 500, top: 100, bottom: 300 };
test('inSafeTriangle: inside, outside and slack', () => {
  const origin = { x: 280, y: 150 };
  assert.equal(inSafeTriangle({ x: 290, y: 160 }, origin, rect, 'right'), true);
  assert.equal(inSafeTriangle({ x: 290, y: 330 }, origin, rect, 'right'), false);
  assert.equal(inSafeTriangle({ x: 150, y: 150 }, origin, rect, 'right'), false);
  assert.equal(inSafeTriangle({ x: 400, y: 200 }, origin, rect, 'right'), true);
  // 3px above the flyout's top edge: inside the 4px slack; 10px: outside
  assert.equal(inSafeTriangle({ x: 300, y: 97 }, origin, rect, 'right'), true);
  assert.equal(inSafeTriangle({ x: 300, y: 90 }, origin, rect, 'right'), false);
  // flyout on the left
  assert.equal(inSafeTriangle({ x: 490, y: 160 }, { x: 520, y: 150 }, rect, 'left'), true);
});

const L = ['Open', 'Share…', 'Save as', 'Send to', 'Sort', '"Quoted"'];
test('typeaheadIndex: next, wrap, repeat, none, ellipsis', () => {
  assert.equal(typeaheadIndex(L, 0, 's'), 1);
  assert.equal(typeaheadIndex(L, 1, 'sa'), 2);
  assert.equal(typeaheadIndex(L, 4, 's'), 1);
  assert.equal(typeaheadIndex(L, 1, 'ss'), 2);
  assert.equal(typeaheadIndex(L, 4, 'ss'), 1);
  assert.equal(typeaheadIndex(L, 0, 'z'), -1);
  assert.equal(typeaheadIndex(L, 0, ''), -1);
  assert.equal(typeaheadIndex(['…Rename', 'Copy'], 1, 'r'), 0);
  assert.equal(typeaheadIndex(L, 0, 'q'), 5);
  assert.equal(typeaheadIndex(L, -1, 'o'), 0);
});

test('tidyMenu: headers, ends, doubles, empty captions', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  assert.deepEqual(tidyMenu([{ header: 'EDIT' }, a, { header: 'X' }, { divider: true }, b, { divider: true }]),
    [a, { divider: true }, b]);
  assert.deepEqual(tidyMenu([a, { divider: true }, { caption: 'Recent' }, { divider: true }, b]),
    [a, { divider: true }, b]);
  assert.deepEqual(tidyMenu([a, { caption: 'Recent' }]), [a]);
  const cap = { caption: 'Recent' };
  assert.deepEqual(tidyMenu([a, cap, b]), [a, cap, b]);
  assert.deepEqual(tidyMenu([{ divider: true }]), []);
});
