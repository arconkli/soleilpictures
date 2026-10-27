import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportFrame, EXPORT_LONG_SIDE } from './exportFrame.js';

// Export → PNG image / PDF (lib/exportBoard.js). The picture is drawn by the
// covers' renderer; tests/board-export.spec.js downloads one in a browser.

const COVERS_ZOOM = 1.5; // renderThumbnail.js MAX_ZOOM

test('an export keeps the board\'s own shape, not the cover\'s 16:9', () => {
  const tall = exportFrame(1000, 3000, COVERS_ZOOM);
  assert.equal(tall.height, EXPORT_LONG_SIDE);
  assert.ok(Math.abs(tall.width / tall.height - 1 / 3) < 0.002, `${tall.width}×${tall.height}`);
  const wide = exportFrame(8000, 2000, COVERS_ZOOM);
  assert.deepEqual(wide, { width: EXPORT_LONG_SIDE, height: EXPORT_LONG_SIDE / 4 });
});

test('a small board is drawn at the covers\' zoom, not blown up to fill the file', () => {
  assert.deepEqual(exportFrame(348, 248, COVERS_ZOOM), { width: 522, height: 372 });
});

test('a sliver of a board still makes a picture', () => {
  const strip = exportFrame(100000, 60, COVERS_ZOOM);
  assert.equal(strip.width, EXPORT_LONG_SIDE);
  assert.equal(strip.height, 1);
});

test('the renderer draws the export in that frame, as a PNG', () => {
  const src = readFileSync(new URL('./renderThumbnail.js', import.meta.url), 'utf8');
  assert.match(src, /export async function renderBoardPng\(/);
  assert.match(src, /exportFrame\(plan\.contentW, plan\.contentH, MAX_ZOOM\)/);
  assert.match(src, /type: 'image\/png'/);
});

test('the canvas exports the board itself, not an <svg> it hoped to find', () => {
  const canvas = readFileSync(new URL('../components/CanvasSurface.jsx', import.meta.url), 'utf8');
  const exporter = readFileSync(new URL('./exportBoard.js', import.meta.url), 'utf8');
  // Since 2026-05-27 BoardThumbnail draws an <img>: the old lookup never found
  // one, and every export said "Nothing to export."
  assert.doesNotMatch(canvas, /querySelector\?\.\('svg'\)|exportSvgRef/);
  assert.match(canvas, /const picture = \{ cards, strokes, arrows, boards, bgColor: board\?\.bg_color \|\| null \};/);
  assert.match(exporter, /renderBoardPng\(board\)/);
  // The PDF prints from a frame: a pop-up opened after the drawing is blocked.
  assert.doesNotMatch(exporter, /window\.open\(/);
});
