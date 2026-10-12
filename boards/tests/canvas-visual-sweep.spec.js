// Canvas fixes from the runtime visual sweep (VS-CANVAS-*). Each test plants
// cards into the saved local session (?local=1, no backend) and measures the
// rendered geometry the sweep measured, so a regression reads as numbers.

import { expect, test } from '@playwright/test';

const KEY = 'soleil.boards.local.session.v1';

async function plant(page, cards) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), KEY)).toBe(true);
  await page.evaluate(({ k, cards }) => {
    const s = JSON.parse(localStorage.getItem(k));
    const id = s.stack[s.stack.length - 1];
    const st = s.localState.boardState[id] || { cards: [], arrows: [], strokes: [] };
    st.cards = [...(st.cards || []), ...cards];
    s.localState.boardState[id] = st;
    localStorage.setItem(k, JSON.stringify(s));
  }, { k: KEY, cards });
  await page.goto('/?local=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
}

const rect = (page, sel) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height };
});

const SHAPES = [
  { id: 'sh1', kind: 'shape', shape: 'rect', x: 120, y: 120, w: 160, h: 90, label: 'Act one opens' },
  { id: 'sh2', kind: 'shape', shape: 'ellipse', x: 340, y: 120, w: 180, h: 110, stroke: '#3b82f6', label: 'A longer label that should wrap inside the ellipse' },
  { id: 'sh3', kind: 'shape', shape: 'diamond', x: 580, y: 120, w: 150, h: 130, stroke: '#f59e0b', label: 'Decide' },
];

test.describe('VS-CANVAS-01 shape labels', () => {
  test('a label is centred inside its shape, not shifted up and left', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await plant(page, SHAPES);
    for (const s of SHAPES) {
      const card = await rect(page, `[data-card-id="${s.id}"]`);
      const label = await rect(page, `[data-card-id="${s.id}"] .shape-label`);
      // Inside the card…
      expect(label.x).toBeGreaterThanOrEqual(card.x - 0.5);
      expect(label.y).toBeGreaterThanOrEqual(card.y - 0.5);
      expect(label.r).toBeLessThanOrEqual(card.r + 0.5);
      expect(label.b).toBeLessThanOrEqual(card.b + 0.5);
      // …and centred on it.
      expect(Math.abs((label.x + label.r) / 2 - (card.x + card.r) / 2)).toBeLessThan(2);
      expect(Math.abs((label.y + label.b) / 2 - (card.y + card.b) / 2)).toBeLessThan(2);
    }
    await page.screenshot({ path: test.info().outputPath('shapes-dark.png') });
  });
});
