// Pure-logic tests for list-view file-drop placement. arrangeInFreeSpace and
// classifyDropFile are dependency-free, so they run straight in the Playwright
// Node process (like async-pool.spec.js). This pins the two invariants that
// answer "where do my files go when I drop them in list mode?":
//   1) the batch always lands in guaranteed-free space (below existing content)
//   2) N files pack into a bounded grid (no unbounded off-screen march) with
//      zero overlap among themselves.
import { expect, test } from '@playwright/test';
import { arrangeInFreeSpace, boundsOfCards } from '../src/lib/canvasGeom.js';
import { classifyDropFile, FREE_VIDEO_CAP } from '../src/lib/fileIngest.js';

const mk = (type, name, size = 1000) => ({ type, name, size });
const rectsOverlap = (a, b, aw, ah, bw, bh) =>
  a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y;

test('classifyDropFile routes every type the way the canvas does', () => {
  expect(classifyDropFile(mk('image/png', 'a.png')).route).toBe('image');
  expect(classifyDropFile(mk('video/mp4', 'a.mp4', 10 * 1024 * 1024)).route).toBe('video');
  // Over the free video cap but paid-attemptable → multipart largeMedia.
  expect(classifyDropFile(mk('video/mp4', 'a.mp4', FREE_VIDEO_CAP + 1)).route).toBe('largeMedia');
  expect(classifyDropFile(mk('audio/mpeg', 'a.mp3')).route).toBe('audio');
  // Empty MIME .pdf (some OS pickers) still detected as pdf.
  expect(classifyDropFile(mk('', 'doc.pdf')).route).toBe('pdf');
  expect(classifyDropFile(mk('application/zip', 'a.zip')).route).toBe('file');
  // Owner-not-paid → the "upload anything" feature is hard-blocked.
  expect(classifyDropFile(mk('application/zip', 'a.zip'), { canAttemptFiles: false }).route).toBe('blocked');
});

test('empty board: grid starts at the top-left margin', () => {
  const items = Array.from({ length: 5 }, () => ({ w: 320, h: 240 }));
  const out = arrangeInFreeSpace([], items);
  expect(out[0].x).toBe(80);
  expect(out[0].y).toBe(80);
  // 5 items → ceil(sqrt(5)) = 3 columns.
  expect(new Set(out.slice(0, 3).map(p => p.x)).size).toBe(3);
});

test('with existing content: the whole batch lands strictly below it', () => {
  const existing = [{ x: 0, y: 0, w: 400, h: 300 }, { x: 500, y: 100, w: 200, h: 600 }];
  const b = boundsOfCards(existing);
  const items = Array.from({ length: 6 }, () => ({ w: 320, h: 240 }));
  const out = arrangeInFreeSpace(existing, items);
  const minNewY = Math.min(...out.map(r => r.y));
  expect(minNewY).toBeGreaterThanOrEqual(b.bottom); // no overlap with existing
});

test('100 files pack into a bounded grid with no self-overlap', () => {
  const items = Array.from({ length: 100 }, () => ({ w: 320, h: 240 }));
  const out = arrangeInFreeSpace([], items);
  // Column count is capped (√100 = 10 ≤ 12), so files never march off-screen.
  const firstRow = out.filter(r => r.y === out[0].y);
  expect(firstRow.length).toBeLessThanOrEqual(12);
  // No two placed cards overlap.
  let overlap = false;
  for (let i = 0; i < out.length && !overlap; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (rectsOverlap(out[i], out[j], 320, 240, 320, 240)) { overlap = true; break; }
    }
  }
  expect(overlap).toBe(false);
});

test('mixed intrinsic sizes stay centered in a uniform cell (list order preserved)', () => {
  const items = [
    { w: 320, h: 240, tag: 'a' },
    { w: 300, h: 388, tag: 'b' },
    { w: 380, h: 130, tag: 'c' },
  ];
  const out = arrangeInFreeSpace([], items);
  // Order preserved, and each item keeps its intrinsic w/h.
  expect(out.map(r => r.tag)).toEqual(['a', 'b', 'c']);
  expect(out[1].w).toBe(300);
  expect(out[2].h).toBe(130);
});
