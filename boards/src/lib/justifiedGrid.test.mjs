// justifiedGrid.test.mjs — the Files grid's justified rows.
//
//   node --test src/lib/justifiedGrid.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TILE_SIZES, CAPTION_H, GALLERY_GAP, ASPECT_MIN, ASPECT_MAX,
  aspectOfItem, layoutGallery, visibleRange, gridNeighbor, tileImageSrc,
  readTileSize, writeTileSize,
} from './justifiedGrid.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('a picture keeps its own shape, clamped so one panorama can\'t flatten a row', () => {
  assert.equal(aspectOfItem({ kind: 'image', card: { w: 300, h: 200 } }), 1.5);
  assert.equal(aspectOfItem({ kind: 'image', card: { w: 300, h: 200 } }, { w: 4000, h: 2000 }), 2);
  assert.equal(aspectOfItem({ kind: 'image', card: { w: 1000, h: 100 } }), ASPECT_MAX);
  assert.equal(aspectOfItem({ kind: 'image', card: { w: 100, h: 1000 } }), ASPECT_MIN);
  assert.equal(aspectOfItem({ kind: 'pdf', card: { w: 300, h: 300 } }), 0.78);
  assert.equal(aspectOfItem({ kind: 'note' }), 1);
  assert.equal(aspectOfItem({ kind: 'mystery' }), 1);
  assert.equal(aspectOfItem({ isGroup: true }), 1.25);
});

test('rows fill the width exactly and never overlap', () => {
  const entries = Array.from({ length: 23 }, (_, i) => ({ id: `t${i}`, aspect: [1.5, 0.75, 1, 2, 1.33][i % 5] }));
  const width = 1000;
  const { tiles, height } = layoutGallery(entries, { width, rowHeight: TILE_SIZES.m });
  assert.equal(tiles.length, 23);
  const rows = new Map();
  for (const t of tiles) rows.set(t.row, [...(rows.get(t.row) || []), t]);
  const last = Math.max(...rows.keys());
  for (const [r, ts] of rows) {
    ts.sort((a, b) => a.x - b.x);
    assert.equal(ts[0].x, 0);
    for (let i = 1; i < ts.length; i++) assert.equal(ts[i].x, ts[i - 1].x + ts[i - 1].w + GALLERY_GAP);
    // Every full row reaches the right edge; the last is left as it falls.
    const right = ts[ts.length - 1].x + ts[ts.length - 1].w;
    if (r !== last) assert.ok(Math.abs(right - width) <= 1, `row ${r} ends at ${right}`);
    else assert.ok(right <= width);
    // Same height across a row, preview + caption.
    assert.equal(new Set(ts.map((t) => t.h)).size, 1);
    assert.equal(ts[0].h - ts[0].previewH, CAPTION_H);
  }
  // Rows stack with the gap between them.
  const tops = [...rows.values()].map((ts) => ts[0]).sort((a, b) => a.y - b.y);
  for (let i = 1; i < tops.length; i++) assert.equal(tops[i].y, tops[i - 1].y + tops[i - 1].h + GALLERY_GAP);
  assert.equal(height, tops[tops.length - 1].y + tops[tops.length - 1].h);
});

test('the last row stays at the target size rather than ballooning', () => {
  const { tiles } = layoutGallery([{ id: 'a', aspect: 1 }], { width: 1000, rowHeight: 170 });
  assert.equal(tiles[0].previewH, 170);
  assert.equal(tiles[0].w, 170);
});

test('nothing to lay out, or no width yet, is empty', () => {
  assert.deepEqual(layoutGallery([], { width: 500 }), { tiles: [], height: 0 });
  assert.deepEqual(layoutGallery([{ id: 'a', aspect: 1 }], { width: 0 }), { tiles: [], height: 0 });
});

test('only tiles near the viewport are in range', () => {
  const entries = Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, aspect: 1 }));
  const { tiles } = layoutGallery(entries, { width: 1000, rowHeight: 100 });
  const [s, e] = visibleRange(tiles, 2000, 2600, 0);
  assert.ok(s > 0 && e < tiles.length && e > s);
  for (let i = s; i < e; i++) assert.ok(tiles[i].y <= 2600 && tiles[i].y + tiles[i].h >= 2000);
  assert.ok(tiles[s - 1].y + tiles[s - 1].h < 2000);
  assert.ok(tiles[e].y > 2600);
  assert.deepEqual(visibleRange([], 0, 100), [0, 0]);
});

test('arrow keys: ←/→ follow reading order, ↑/↓ take the nearest tile in the next row', () => {
  // Two rows of three equal tiles.
  const { tiles } = layoutGallery(Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, aspect: 1 })), { width: 3 * 100 + 2 * GALLERY_GAP, rowHeight: 100 });
  assert.deepEqual([...new Set(tiles.map((t) => t.row))], [0, 1]);
  assert.equal(gridNeighbor(tiles, 2, 'right'), 3);
  assert.equal(gridNeighbor(tiles, 3, 'left'), 2);
  assert.equal(gridNeighbor(tiles, 0, 'left'), 0);
  assert.equal(gridNeighbor(tiles, 5, 'right'), 5);
  assert.equal(gridNeighbor(tiles, 1, 'down'), 4);
  assert.equal(gridNeighbor(tiles, 4, 'up'), 1);
  assert.equal(gridNeighbor(tiles, 1, 'up'), 1);
  assert.equal(gridNeighbor(tiles, 4, 'down'), 4);
});

test('a tile loads the smallest stored picture that covers it', () => {
  const meta = { previewSmKey: 'sm', previewSmW: 640, previewKey: 'lg', previewW: 1280, w: 4000, h: 3000 };
  assert.equal(tileImageSrc('r2:orig', meta, 300), 'r2:sm');
  assert.equal(tileImageSrc('r2:orig', meta, 900), 'r2:lg');
  assert.equal(tileImageSrc('r2:orig', meta, 2000), 'r2:orig');
  assert.equal(tileImageSrc('r2:orig', { previewKey: 'lg' }, 300), 'r2:lg');
  assert.equal(tileImageSrc('r2:orig', null, 300), 'r2:orig');
  assert.equal(tileImageSrc('https://x/y.png', meta, 300), 'https://x/y.png');
});

test('tile size is remembered on the device, and junk reads as the default', () => {
  const s = memStore();
  assert.equal(readTileSize(s), 'm');
  writeTileSize('l', s);
  assert.equal(readTileSize(s), 'l');
  writeTileSize('xxl', s);
  assert.equal(readTileSize(s), 'l');
  assert.equal(readTileSize({ getItem: () => { throw new Error('denied'); } }), 'm');
});
