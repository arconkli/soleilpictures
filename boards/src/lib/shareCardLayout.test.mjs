// Pins the share card's layout (lib/shareCardLayout.js): the name wraps to at
// most three lines and shrinks before it is cut, at most four pictures are
// placed, each keeps its own aspect, and everything stays on the card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutShareCard, CARD_W, CARD_H, NAME_BOX, MAX_PICTURES } from './shareCardLayout.js';

// A fixed-pitch stand-in for the canvas: every letter is 0.55 em wide.
const measure = (text, fontPx) => text.length * fontPx * 0.55;

const bounds = (p) => {
  const t = (p.rot * Math.PI) / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const w = p.w * c + p.h * s, h = p.w * s + p.h * c, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
};

test('a short name is one line at the biggest size, centred on the card', () => {
  const L = layoutShareCard({ name: 'Lost Time', pictures: [], measure });
  assert.deepEqual(L.nameLines, ['Lost Time']);
  assert.equal(L.fontPx, 92);
  const mid = L.nameY + (L.lineH * L.nameLines.length) / 2;
  assert.ok(Math.abs(mid - NAME_BOX.cy) < 1);
  assert.deepEqual(L.pictures, []);
});

test('an empty or missing name reads as an untitled cluster', () => {
  for (const name of ['', '   ', null, undefined]) {
    const L = layoutShareCard({ name, pictures: [], measure });
    assert.equal(L.nameLines.join(' '), 'Untitled cluster');
  }
});

test('a long name wraps to at most three lines and every line fits the column', () => {
  const name = 'The long weekend we shot the desert pilot';
  const L = layoutShareCard({ name, pictures: [], measure });
  assert.ok(L.nameLines.length >= 2 && L.nameLines.length <= 3);
  assert.ok(L.fontPx < 92, 'shrinks before it cuts');
  for (const line of L.nameLines) assert.ok(measure(line, L.fontPx) <= NAME_BOX.w, line);
  assert.equal(L.nameLines.join(' '), name);
});

test('a name too long even at the smallest size ends in an ellipsis on the third line', () => {
  const name = 'word '.repeat(80).trim();
  const L = layoutShareCard({ name, pictures: [], measure });
  assert.equal(L.nameLines.length, 3);
  assert.ok(L.nameLines[2].endsWith('…'));
  for (const line of L.nameLines) assert.ok(measure(line, L.fontPx) <= NAME_BOX.w, line);
});

test('one unbroken word wider than the column is broken by letters, not run off the card', () => {
  const L = layoutShareCard({ name: 'Supercalifragilisticexpialidocious_Supercalifragilistic', pictures: [], measure });
  assert.ok(L.nameLines.length <= 3);
  for (const line of L.nameLines) assert.ok(measure(line, L.fontPx) <= NAME_BOX.w, line);
});

test('pictures: none to four are placed, a fifth and later are left out', () => {
  const pic = { w: 800, h: 600 };
  for (let n = 0; n <= 6; n++) {
    const L = layoutShareCard({ name: 'x', pictures: Array.from({ length: n }, () => pic), measure });
    assert.equal(L.pictures.length, Math.min(n, MAX_PICTURES), `n=${n}`);
  }
});

test('every picture keeps its own aspect, portrait or landscape', () => {
  const sizes = [{ w: 4000, h: 3000 }, { w: 1000, h: 1800 }, { w: 500, h: 500 }, { w: 3000, h: 900 }];
  for (let n = 1; n <= 4; n++) {
    const L = layoutShareCard({ name: 'x', pictures: sizes.slice(0, n), measure });
    L.pictures.forEach((p, i) => {
      assert.ok(Math.abs(p.w / p.h - sizes[i].w / sizes[i].h) < 0.02, `n=${n} #${i}`);
      assert.ok(p.w > 0 && p.h > 0);
    });
  }
});

test('the pile stays on the right half, inside the card, clear of the name', () => {
  const sizes = [{ w: 4000, h: 3000 }, { w: 1000, h: 1800 }, { w: 500, h: 500 }, { w: 3000, h: 900 }];
  for (let n = 1; n <= 4; n++) {
    const L = layoutShareCard({ name: 'x', pictures: sizes.slice(0, n), measure });
    for (const p of L.pictures) {
      const b = bounds(p);
      assert.ok(b.l >= NAME_BOX.x + NAME_BOX.w, `n=${n}: left edge ${b.l}`);
      assert.ok(b.r <= CARD_W && b.t >= 0 && b.b <= CARD_H, `n=${n}: ${JSON.stringify(b)}`);
    }
  }
});

test('a picture with no usable size is placed as a square rather than dropped', () => {
  const L = layoutShareCard({ name: 'x', pictures: [{ w: 0, h: 0 }, { w: NaN, h: 5 }], measure });
  assert.equal(L.pictures.length, 2);
  assert.ok(Math.abs(L.pictures[0].w - L.pictures[0].h) < 0.2);
});
