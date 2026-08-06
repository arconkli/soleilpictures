// OKLab colour extraction and perceptual ordering (src/lib/oklab.js).
//
// These back the auto-moodboard. The bar isn't "produces an order" — any sort
// does that — it's "produces a BETTER order than arrival", which is what
// pathCost measures.

import { expect, test } from '@playwright/test';
import {
  srgbToOklab, averageColor, deltaE, chroma, orderByColor, pathCost,
} from '../src/lib/oklab.js';

// Build a packed RGB(A) buffer from an array of [r,g,b(,a)] triples/quads.
const rgb = (px) => Uint8Array.from(px.flat());

test('OKLab lightness tracks perceived brightness, not raw channel values', () => {
  const black = srgbToOklab(0, 0, 0);
  const grey = srgbToOklab(128, 128, 128);
  const white = srgbToOklab(255, 255, 255);
  expect(black.L).toBeCloseTo(0, 3);
  expect(white.L).toBeCloseTo(1, 2);
  expect(grey.L).toBeGreaterThan(black.L);
  expect(grey.L).toBeLessThan(white.L);

  // Mid grey sits near the MIDDLE perceptually. A naive (r+g+b)/3/255 would put
  // it at 0.50 in linear terms and sort mid-tones with the shadows; the sRGB
  // transfer function is what puts it around 0.6.
  expect(grey.L).toBeGreaterThan(0.55);
});

test('neutrals have no hue, saturated colours do', () => {
  for (const v of [0, 64, 128, 200, 255]) {
    expect(chroma(srgbToOklab(v, v, v))).toBeLessThan(0.001);
  }
  expect(chroma(srgbToOklab(220, 40, 40))).toBeGreaterThan(0.1);
});

test('average colour is chroma-weighted, so one warm light beats a wall of grey', () => {
  // 63 neutral pixels + 1 strongly orange one. A plain mean would return
  // near-neutral; the eye reads this frame as warm, and so should the sort.
  const px = [];
  for (let i = 0; i < 63; i++) px.push([128, 128, 128]);
  px.push([255, 140, 20]);

  const avg = averageColor(rgb(px), 3);
  expect(avg.a).toBeGreaterThan(0.02);   // pushed toward red
  expect(avg.b).toBeGreaterThan(0.02);   // and toward yellow
  // Lightness is still a TRUE average — one bright pixel must not make a dark
  // frame sort as a light one.
  expect(avg.L).toBeLessThan(srgbToOklab(255, 140, 20).L);
});

test('a fully neutral image returns exact neutral rather than amplified noise', () => {
  const px = Array.from({ length: 64 }, () => [90, 90, 90]);
  const avg = averageColor(rgb(px), 3);
  expect(avg.a).toBe(0);
  expect(avg.b).toBe(0);
  expect(avg.L).toBeGreaterThan(0);
});

test('transparent pixels are skipped instead of dragging the average', () => {
  // 32 opaque red + 32 fully transparent pixels carrying garbage colour.
  const px = [];
  for (let i = 0; i < 32; i++) px.push([200, 30, 30, 255]);
  for (let i = 0; i < 32; i++) px.push([0, 255, 0, 0]);
  const avg = averageColor(rgb(px), 4);
  expect(avg.a).toBeGreaterThan(0);   // still reads red
  expect(avg.b).toBeGreaterThan(0);
});

test('empty or malformed input degrades to neutral instead of NaN', () => {
  for (const bad of [null, undefined, new Uint8Array(0)]) {
    const c = averageColor(bad, 3);
    expect(Number.isFinite(c.L)).toBe(true);
    expect(Number.isFinite(c.a)).toBe(true);
    expect(Number.isFinite(c.b)).toBe(true);
  }
});

test('ordering makes the sequence measurably smoother than arrival order', () => {
  // A deliberately jumbled set spanning dark/light and warm/cool.
  const swatches = [
    [255, 255, 255], [10, 10, 12], [220, 60, 40], [30, 40, 120], [240, 200, 120],
    [60, 90, 70], [200, 210, 230], [120, 40, 90], [40, 40, 44], [250, 240, 210],
    [90, 130, 160], [180, 90, 40],
  ];
  const items = swatches.map((s, i) => ({ id: `c${i}`, color: srgbToOklab(...s) }));

  const sorted = orderByColor(items);
  expect(sorted).toHaveLength(items.length);
  // Nothing lost, nothing duplicated.
  expect(new Set(sorted.map((i) => i.id)).size).toBe(items.length);
  // The whole point:
  expect(pathCost(sorted)).toBeLessThan(pathCost(items));
});

test('ordering starts at the darkest item, so the block reads dark → light', () => {
  const swatches = [[240, 240, 240], [10, 10, 10], [128, 128, 128]];
  const items = swatches.map((s, i) => ({ id: `c${i}`, color: srgbToOklab(...s) }));
  const sorted = orderByColor([...items, ...items.map((it, i) => ({ ...it, id: `d${i}` }))]);
  expect(sorted[0].color.L).toBeLessThan(0.2);
});

test('items with no colour are kept, at the end — never dropped', () => {
  const items = [
    { id: 'note' },
    { id: 'a', color: srgbToOklab(200, 30, 30) },
    { id: 'link', color: null },
    { id: 'b', color: srgbToOklab(30, 30, 200) },
    { id: 'c', color: srgbToOklab(30, 200, 30) },
  ];
  const sorted = orderByColor(items);
  expect(sorted).toHaveLength(5);
  expect(sorted.slice(-2).map((i) => i.id).sort()).toEqual(['link', 'note']);
});

test('deltaE is symmetric and zero for identical colours', () => {
  const a = srgbToOklab(120, 30, 200);
  const b = srgbToOklab(20, 190, 90);
  expect(deltaE(a, a)).toBeCloseTo(0, 9);
  expect(deltaE(a, b)).toBeCloseTo(deltaE(b, a), 9);
  expect(deltaE(a, null)).toBe(0);
});
