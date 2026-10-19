import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE, SIZES, LAYOUT_DEFAULT, SIDEBAR_LAYOUT_KEY, OLD_SIDEBAR_W_KEY,
  defaultLayout, sanitizeLayout, layoutFromOldWidth, readSidebarLayout, writeSidebarLayout,
  sidebarFootprint, arrangementOf, frameVars, toggledLayout, handleSpecs, dragLayout, resetLayout, keyLayout,
  SIDE_FITS_QUERY, KEPT_FITS_QUERY,
} from './sidebarLayout.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

// A 1440×900 window: the sidebar at its top-left, a full-height card's bottom 8px off the window's.
const VIEW = { top: 0, full: 900 - EDGE, vw: 1440, coarse: false, hug: 380 };
const rect = (x, y, w, h) => ({ x, y, w, h });
// Stacked, the default: the clusters 312 wide and 380 tall, the files under them to the bottom.
const stacked = (layout = defaultLayout(), over = {}) => ({
  ...VIEW, layout, arr: 'stack',
  t: rect(8, 8, layout.stack.tw, 380), f: rect(8, 396, layout.stack.fw, 900 - 8 - 396), x: 8 + layout.stack.fw, ...over,
});
// Side by side, the default: the clusters hugging their 380px, the files the whole height.
const sideBySide = (layout = { ...defaultLayout(), arr: 'side' }, over = {}) => ({
  ...VIEW, layout, arr: 'side',
  t: rect(8, 8, layout.side.tw, 380), f: rect(8 + layout.side.tw + 8, 8, layout.side.fw, 884),
  x: 8 + layout.side.tw + 8 + layout.side.fw, ...over,
});

test('the defaults are the sidebar as it was: 320 stacked, 640 side by side', () => {
  assert.equal(sidebarFootprint(defaultLayout()), 320);
  assert.equal(sidebarFootprint({ ...defaultLayout(), arr: 'side' }), 640);
  // A touch screen keeps the files under the clusters.
  assert.equal(arrangementOf({ ...defaultLayout(), arr: 'side' }, { coarse: true }), 'stack');
  assert.equal(sidebarFootprint({ ...defaultLayout(), arr: 'side' }, { coarse: true }), 320);
  // A window too narrow for side by side keeps the files under the clusters, whatever was chosen.
  assert.equal(SIDE_FITS_QUERY, '(min-width: 920px)');
  assert.equal(KEPT_FITS_QUERY, '(min-width: 864px)');
  const side = { ...defaultLayout(), arr: 'side' };
  assert.equal(arrangementOf(side, { roomy: false }), 'stack');
  assert.equal(sidebarFootprint(side, { roomy: false }), 320);
  assert.equal(frameVars(side, { roomy: false })['--sbf-fh'], 'auto');
  // Side by side the button keeps fits a little narrower: as narrow as its two cards can be.
  const kept = { ...side, pinned: true };
  assert.equal(arrangementOf(kept, { roomy: false, snug: true }), 'side');
  assert.equal(arrangementOf(kept, { roomy: false, snug: false }), 'stack');
  assert.equal(arrangementOf(side, { roomy: false, snug: true }), 'stack', 'not kept: stacked below 920');
  // The button goes from what shows: chosen side by side, but stacked by the window, it keeps it side by side.
  const fromShown = toggledLayout(side, 'stack');
  assert.deepEqual([fromShown.arr, fromShown.pinned], ['side', true]);
  assert.deepEqual(toggledLayout(defaultLayout()).arr, 'side');
  assert.deepEqual(toggledLayout(toggledLayout(defaultLayout())), defaultLayout());
});

test('whatever storage holds comes back as a layout', () => {
  assert.deepEqual(sanitizeLayout(null), defaultLayout());
  assert.deepEqual(sanitizeLayout('nonsense'), defaultLayout());
  const l = sanitizeLayout({ arr: 'side', stack: { tw: 9999, fw: 10, th: 'tall', bottom: 50 }, side: { tw: 'x', fw: 5000.4, tBottom: 'full', fBottom: 12 } });
  assert.equal(l.arr, 'side');
  assert.deepEqual(l.stack, { tw: SIZES.stackMaxW, fw: SIZES.filesMinW, th: 'hug', bottom: EDGE + SIZES.treeMinH + EDGE + SIZES.filesMinH });
  assert.deepEqual(l.side, { tw: LAYOUT_DEFAULT.side.tw, fw: SIZES.filesMaxW, tBottom: 'full', fBottom: EDGE + SIZES.filesMinH });
  // Only side by side is ever kept by the button.
  assert.equal(l.pinned, false);
  assert.equal(sanitizeLayout({ arr: 'side', pinned: true }).pinned, true);
  assert.equal(sanitizeLayout({ arr: 'stack', pinned: true }).pinned, false);
  assert.equal(sanitizeLayout({ arr: 'side', pinned: 'yes' }).pinned, false);
});

test('the old one width carries over: narrow stays stacked at it, wide goes side by side split as before', () => {
  assert.deepEqual(layoutFromOldWidth(320).stack, { ...LAYOUT_DEFAULT.stack, tw: 312, fw: 312 });
  assert.equal(layoutFromOldWidth(400).stack.fw, 392);
  const wide = layoutFromOldWidth(640);
  assert.equal(wide.arr, 'side');
  assert.deepEqual([wide.side.tw, wide.side.fw], [240, 384]);
  assert.equal(sidebarFootprint(wide), 640);
  assert.equal(sidebarFootprint(layoutFromOldWidth(760)), 760);
  assert.deepEqual(layoutFromOldWidth('nope'), defaultLayout());
});

test('read and write: the new key first, then the old width, and storage that throws is no layout at all', () => {
  assert.deepEqual(readSidebarLayout(memory()), defaultLayout());
  assert.equal(readSidebarLayout(memory({ [OLD_SIDEBAR_W_KEY]: '640' })).arr, 'side');
  const s = memory({ [OLD_SIDEBAR_W_KEY]: '640' });
  writeSidebarLayout({ ...defaultLayout(), stack: { ...LAYOUT_DEFAULT.stack, tw: 250 } }, s);
  assert.equal(readSidebarLayout(s).stack.tw, 250);
  assert.equal(readSidebarLayout(s).arr, 'stack');
  assert.ok(s.m.has(SIDEBAR_LAYOUT_KEY));
  assert.deepEqual(readSidebarLayout(memory({ [SIDEBAR_LAYOUT_KEY]: '{bad json' })), defaultLayout());
  assert.deepEqual(readSidebarLayout(broken), defaultLayout());
  assert.doesNotThrow(() => writeSidebarLayout(defaultLayout(), broken));
});

test('what the CSS lays the cards out by', () => {
  assert.deepEqual(frameVars(defaultLayout()), {
    '--sbf-tw': '312px', '--sbf-fw': '312px', '--sbf-th': 'auto', '--sbf-fh': 'auto', '--sbf-frame-h': '100%', '--sbf-nav-max': '42vh',
  });
  const short = { ...defaultLayout(), stack: { tw: 200, fw: 400, th: 260, bottom: 600 } };
  assert.deepEqual(frameVars(short), {
    '--sbf-tw': '200px', '--sbf-fw': '400px', '--sbf-th': '260px', '--sbf-fh': 'auto', '--sbf-frame-h': '608px', '--sbf-nav-max': 'none',
  });
  const side = { ...defaultLayout(), arr: 'side', side: { tw: 200, fw: 500, tBottom: 300, fBottom: 'full' } };
  assert.deepEqual(frameVars(side), {
    '--sbf-tw': '200px', '--sbf-fw': '500px', '--sbf-th': '292px', '--sbf-fh': '100%', '--sbf-frame-h': '100%', '--sbf-nav-max': 'none',
  });
  assert.equal(frameVars({ ...side, side: { ...side.side, tBottom: 'hug' } })['--sbf-th'], 'auto');
  assert.equal(frameVars({ ...side, side: { ...side.side, tBottom: 'full' } })['--sbf-th'], '100%');
});

test('the handles: every right and bottom edge, the gap, and a corner for each card that has two edges', () => {
  const st = stacked();
  const hs = handleSpecs('stack', st);
  assert.deepEqual(hs.map((h) => h.id), ['treeRight', 'filesRight', 'divider', 'bottom', 'corner']);
  const divider = hs.find((h) => h.id === 'divider');
  assert.deepEqual([divider.y, divider.h], [388, 8], 'the divider is the gap between the cards');
  const sd = sideBySide();
  const hs2 = handleSpecs('side', sd);
  assert.deepEqual(hs2.map((h) => h.id), ['split', 'right', 'treeBottom', 'bottom', 'treeCorner', 'corner']);
  const split = hs2.find((h) => h.id === 'split');
  assert.deepEqual([split.x, split.w], [8 + 240, 8], 'the split is the gap between the cards');
  assert.equal(split.y + split.h, 8 + 380 - 12, 'and only where they face each other');
  assert.ok(hs2.filter((h) => h.kind === 'corner').every((h) => !h.focus), 'corners only repeat two edges: not in the Tab order');
  // A finger gets a bigger edge to hold.
  assert.equal(handleSpecs('side', sd, { coarse: true }).find((h) => h.id === 'right').w, 16);
});

test('side by side, the gap trades width between the cards, and nothing gets thinner than its least', () => {
  const r = dragLayout(sideBySide(), 'split', -30, 0);
  assert.deepEqual([r.layout.side.tw, r.layout.side.fw], [210, 414]);
  assert.equal(r.layout.side.tw + r.layout.side.fw, 624, 'the total stays');
  const far = dragLayout(sideBySide(), 'split', -500, 0).layout.side;
  assert.deepEqual([far.tw, far.fw], [SIZES.treeMinW, 624 - SIZES.treeMinW]);
  const other = dragLayout(sideBySide(), 'split', 900, 0).layout.side;
  assert.deepEqual([other.tw, other.fw], [624 - SIZES.filesMinW, SIZES.filesMinW]);
});

test('side by side, the files widen to the room the board leaves, and pulled narrow enough they stack', () => {
  const r = dragLayout(sideBySide(), 'right', 200, 0);
  assert.equal(r.layout.side.fw, 584);
  assert.equal(r.flip, null);
  const capped = dragLayout(sideBySide(), 'right', 2000, 0).layout.side.fw;
  assert.equal(capped, Math.min(SIZES.filesMaxW, 1440 - SIZES.room - 0 - 8 - 240 - 8));
  // The pointer at 600 from the left: still side by side, the files at their least.
  assert.equal(dragLayout(sideBySide(), 'right', -40, 0).layout.side.fw, 344);
  // The files' right edge starts 640 from the left.
  const stay = dragLayout(sideBySide(), 'right', 510 - 640, 0);
  assert.equal(stay.layout.arr, 'side');
  // Under 500: stacked, the files' right edge under the pointer, the clusters as they were stacked.
  const flip = dragLayout(sideBySide(), 'right', 470 - 640, 0);
  assert.equal(flip.layout.arr, 'stack');
  assert.equal(flip.flip, 'filesRight');
  assert.equal(flip.layout.stack.fw, 470 - 8);
  assert.equal(flip.layout.stack.tw, LAYOUT_DEFAULT.stack.tw);
  assert.equal(flip.layout.side.fw, LAYOUT_DEFAULT.side.fw, 'side by side keeps its own sizes for next time');
  // Stacked from a narrow window, the files no wider than the room it leaves.
  const tight = dragLayout({ ...sideBySide(), vw: 940 }, 'right', 470 - 640, 0);
  assert.equal(tight.layout.arr, 'stack');
  assert.equal(tight.layout.stack.fw, 462);
  assert.equal(dragLayout(sideBySide(), 'corner', -400, 0).flip, 'corner');
  // A touch screen never switches by dragging, and the arrow keys don't either.
  assert.equal(dragLayout({ ...sideBySide(), coarse: true }, 'right', -400, 0).layout.arr, 'side');
  assert.equal(keyLayout(sideBySide(), 'right', 'v', 'ArrowLeft', true).arr, 'side');
});

test('stacked, each card has its own width, and pulled wider than 532 they go side by side', () => {
  const a = dragLayout(stacked(), 'treeRight', -100, 0).layout.stack;
  assert.deepEqual([a.tw, a.fw], [212, 312]);
  const b = dragLayout(stacked(), 'filesRight', 150, 0).layout.stack;
  assert.deepEqual([b.tw, b.fw], [312, 462]);
  assert.equal(dragLayout(stacked(), 'filesRight', -300, 0).layout.stack.fw, SIZES.filesMinW);
  assert.equal(dragLayout(stacked(), 'treeRight', -300, 0).layout.stack.tw, SIZES.treeMinW);
  const wide = dragLayout(stacked(), 'filesRight', 532 - 312 + 1, 0);
  assert.equal(wide.layout.arr, 'side');
  assert.equal(wide.flip, 'right');
  assert.equal(wide.layout.pinned, false, 'dragged there, not kept: dragging narrow stacks them again');
  // The files' right edge under the pointer (8 + 533 from the left), the clusters at their side-by-side width.
  assert.equal(8 + wide.layout.side.tw + 8 + wide.layout.side.fw, 8 + 533);
  assert.equal(dragLayout(stacked(), 'treeRight', 300, 0).layout.arr, 'side');
  assert.equal(dragLayout(stacked(), 'filesRight', 532 - 312, 0).layout.arr, 'stack', 'at 532 exactly, still stacked');
  // Clusters left wide side by side give way, so the files' right edge still lands under the pointer.
  const wideTree = { ...defaultLayout(), side: { ...LAYOUT_DEFAULT.side, tw: 480 } };
  const w2 = dragLayout(stacked(wideTree), 'filesRight', 541 - 320, 0).layout.side;
  assert.equal(8 + w2.tw + 8 + w2.fw, 541);
  assert.equal(w2.fw, SIZES.filesMinW);
  // A window without the room for side by side from a drag (under 920): the stacked card stops at
  // what it has, and a drag never switches back and forth on the way.
  const narrow = dragLayout(stacked(defaultLayout(), { vw: 900 }), 'filesRight', 400, 0);
  assert.equal(narrow.layout.arr, 'stack');
  assert.equal(narrow.layout.stack.fw, 900 - SIZES.room - 8);
  for (let x = 330; x <= 900; x += 10) {
    assert.equal(dragLayout(stacked(defaultLayout(), { vw: 880 }), 'filesRight', x - 320, 0).layout.arr, 'stack', `pointer at ${x}`);
  }
});

test('side by side from the button stays however narrow it is dragged, and the button again stacks them as they were', () => {
  const kept = toggledLayout(defaultLayout());
  assert.deepEqual([kept.arr, kept.pinned], ['side', true]);
  // The files' right edge dragged far past where they'd stack: they stay beside, at their least.
  const r = dragLayout(sideBySide(kept), 'right', 300 - 640, 0);
  assert.equal(r.flip, null);
  assert.equal(r.layout.arr, 'side');
  assert.equal(r.layout.side.fw, SIZES.filesMinW);
  // The clusters at theirs too: the narrowest two cards side by side.
  const thin = dragLayout(sideBySide({ ...kept, side: { ...kept.side, tw: SIZES.treeMinW, fw: SIZES.filesMinW } }), 'corner', -200, 0);
  assert.equal(thin.layout.arr, 'side');
  assert.equal(EDGE + thin.layout.side.tw + EDGE + thin.layout.side.fw, EDGE + SIZES.treeMinW + EDGE + SIZES.filesMinW);
  // The button again: stacked, at the stacked sizes they had, and nothing kept.
  const back = toggledLayout({ ...r.layout, stack: { ...LAYOUT_DEFAULT.stack, tw: 250, fw: 300 } });
  assert.deepEqual([back.arr, back.pinned, back.stack.tw, back.stack.fw], ['stack', false, 250, 300]);
  // Side by side that a drag got to stacks again when dragged narrow, as before.
  assert.equal(dragLayout(sideBySide(), 'right', 470 - 640, 0).layout.arr, 'stack');
});

test('stacked, a right edge dragged near the other card\'s lines up with it, and says where', () => {
  const l = { ...defaultLayout(), stack: { ...LAYOUT_DEFAULT.stack, tw: 250, fw: 312 } };
  // The clusters' edge to within 4px of the files': it meets it, with a guide at that x.
  const a = dragLayout(stacked(l), 'treeRight', 58, 0);
  assert.deepEqual([a.layout.stack.tw, a.alignX], [312, 8 + 312]);
  // 22px off: left where it is, and no guide.
  const b = dragLayout(stacked(l), 'treeRight', 40, 0);
  assert.deepEqual([b.layout.stack.tw, b.alignX], [290, null]);
  // The files' edge to the clusters' too, and the files' corner.
  const c = dragLayout(stacked(l), 'filesRight', -58, 0);
  assert.deepEqual([c.layout.stack.fw, c.alignX], [250, 8 + 250]);
  const d = dragLayout(stacked(l), 'corner', -66, -100);
  assert.deepEqual([d.layout.stack.fw, d.alignX, d.layout.stack.bottom], [250, 258, 792]);
  // Never past a card's least: the files (232 at the least) can't meet clusters 226 wide.
  const thin = { ...defaultLayout(), stack: { ...LAYOUT_DEFAULT.stack, tw: 226, fw: 300 } };
  const e = dragLayout(stacked(thin), 'filesRight', -67, 0);
  assert.deepEqual([e.layout.stack.fw, e.alignX], [233, null]);
  // Side by side, there's nothing to line up.
  assert.equal(dragLayout(sideBySide(), 'right', 5, 0).alignX, null);
});

test('stacked, the divider moves the line between the cards, snaps back to the clusters\' own height, and the files keep their bottom', () => {
  const st = stacked(undefined, { hug: 380 });
  const up = dragLayout(st, 'divider', 0, -100).layout.stack;
  assert.equal(up.th, 280);
  assert.equal(up.bottom, 'full');
  assert.equal(dragLayout(st, 'divider', 0, 6).layout.stack.th, 'hug');
  assert.equal(dragLayout(st, 'divider', 0, -1000).layout.stack.th, SIZES.treeMinH);
  assert.equal(dragLayout(st, 'divider', 0, 1000).layout.stack.th, 892 - 8 - 8 - SIZES.filesMinH, 'the files keep their least');
});

test('a bottom edge sizes its card, snaps to the window\'s bottom, and side by side to the other card\'s bottom', () => {
  const st = stacked();
  assert.equal(dragLayout(st, 'bottom', 0, -200).layout.stack.bottom, 692);
  assert.equal(dragLayout(st, 'bottom', 0, -15).layout.stack.bottom, 'full');
  assert.equal(dragLayout(st, 'bottom', 0, -2000).layout.stack.bottom, 396 + SIZES.filesMinH, 'no shorter than the files\' least');
  const corner = dragLayout(st, 'corner', 40, -200).layout.stack;
  assert.deepEqual([corner.fw, corner.bottom], [352, 692]);

  const sd = sideBySide();
  const near = dragLayout(sd, 'bottom', 0, 388 - 892 + 6);     // to 6px under the clusters' bottom
  assert.equal(near.layout.side.fBottom, 388);
  assert.equal(near.align, 388, 'a guide where they line up');
  assert.equal(dragLayout(sd, 'bottom', 0, -200).layout.side.fBottom, 692);
  assert.equal(dragLayout(sd, 'bottom', 0, -200).align, null);
  // The clusters' bottom: down to the files' bottom, back to their own height, or the whole way.
  const sd2 = sideBySide({ ...defaultLayout(), arr: 'side', side: { ...LAYOUT_DEFAULT.side, fBottom: 600 } },
    { f: rect(256, 8, 384, 592) });
  const t1 = dragLayout(sd2, 'treeBottom', 0, 600 - 388 - 4);
  assert.deepEqual([t1.layout.side.tBottom, t1.align], [600, 600]);
  assert.equal(dragLayout(sd2, 'treeBottom', 0, 7).layout.side.tBottom, 'hug');
  assert.equal(dragLayout(sd2, 'treeBottom', 0, 892 - 388 - 10).layout.side.tBottom, 'full');
  assert.equal(dragLayout(sd2, 'treeBottom', 0, 100).layout.side.tBottom, 488);
  // The clusters' corner: the gap and the bottom together.
  const tc = dragLayout(sd2, 'treeCorner', -40, 100).layout.side;
  assert.deepEqual([tc.tw, tc.fw, tc.tBottom], [200, 424, 488]);
});

test('double-click puts back what a handle sizes, and only that', () => {
  const l = { arr: 'side', stack: { tw: 200, fw: 400, th: 300, bottom: 600 }, side: { tw: 300, fw: 500, tBottom: 400, fBottom: 500 } };
  assert.deepEqual(resetLayout(l, 'side', 'split').side, { tw: 240, fw: 384, tBottom: 400, fBottom: 500 });
  assert.deepEqual(resetLayout(l, 'side', 'corner').side, { tw: 300, fw: 384, tBottom: 400, fBottom: 'full' });
  assert.deepEqual(resetLayout(l, 'side', 'treeBottom').side, { tw: 300, fw: 500, tBottom: 'hug', fBottom: 500 });
  assert.deepEqual(resetLayout(l, 'stack', 'divider').stack, { tw: 200, fw: 400, th: 'hug', bottom: 600 });
  assert.deepEqual(resetLayout(l, 'stack', 'treeRight').stack, { tw: 312, fw: 400, th: 300, bottom: 600 });
  assert.deepEqual(resetLayout(l, 'stack', 'corner').stack, { tw: 200, fw: 312, th: 300, bottom: 'full' });
  assert.deepEqual(resetLayout(l, 'stack', 'divider').side, l.side, 'the other arrangement untouched');
});

test('the arrow keys move a focused edge 16px, 64 with Shift, along its own direction only', () => {
  assert.equal(keyLayout(sideBySide(), 'right', 'v', 'ArrowRight').side.fw, 400);
  assert.equal(keyLayout(sideBySide(), 'right', 'v', 'ArrowRight', true).side.fw, 448);
  assert.equal(keyLayout(sideBySide(), 'right', 'v', 'ArrowUp'), null);
  assert.equal(keyLayout(stacked(), 'divider', 'grip', 'ArrowUp').stack.th, 364);
  assert.equal(keyLayout(stacked(), 'divider', 'grip', 'ArrowLeft'), null);
  assert.equal(keyLayout(stacked(), 'bottom', 'h', 'Enter'), null);
  // Past the stacked width, a key stops at it instead of switching.
  const w = keyLayout(stacked(defaultLayout(), {}), 'filesRight', 'v', 'ArrowRight', true);
  assert.equal(w.arr, 'stack');
});
