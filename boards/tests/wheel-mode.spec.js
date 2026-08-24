// The scroll-wheel preference, in a real browser.
//
// wheelMode.test.mjs covers the modifier matrix as pure logic; this covers the
// part that logic cannot: that the handler actually reads the preference, that
// the synchronous soleil.ui read beats the profile fetch (the mode is set in
// an init script, exactly as a cold load would find it), and — the one worth
// the browser — that ctrl+wheel still zooms in zoom mode. That is trackpad
// pinch. Breaking it would silently cost every laptop user pinch-to-zoom, and
// nothing else in the suite would notice.
import { test, expect } from '@playwright/test';

const read = (page) => page.evaluate(() => {
  const el = document.querySelector('.canvas');
  const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform || '');
  const p = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
  return { zoom: p[0], x: p[4], y: p[5] };
});

async function boot(page, mode) {
  await page.addInitScript((m) => {
    localStorage.setItem('soleil.ui', JSON.stringify({ wheelMode: m }));
  }, mode);
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForSelector('.canvas', { timeout: 30000 });
  await page.waitForTimeout(800);
}

test('pan mode: plain wheel pans, cmd-wheel zooms', async ({ page }) => {
  await boot(page, 'pan');
  const a = await read(page);
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  const b = await read(page);
  expect(Math.abs(b.y - a.y)).toBeGreaterThan(50);
  expect(b.zoom).toBeCloseTo(a.zoom, 3);

  await page.keyboard.down('Meta');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Meta');
  await page.waitForTimeout(400);
  const c = await read(page);
  expect(c.zoom).toBeGreaterThan(b.zoom);
});

test('zoom mode: plain wheel zooms at the pointer, alt-wheel pans', async ({ page }) => {
  await boot(page, 'zoom');
  const a = await read(page);
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(400);
  const b = await read(page);
  expect(b.zoom).toBeGreaterThan(a.zoom);

  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, 300);
  await page.keyboard.up('Alt');
  await page.waitForTimeout(400);
  const c = await read(page);
  expect(c.zoom).toBeCloseTo(b.zoom, 3);
  expect(Math.abs(c.y - b.y)).toBeGreaterThan(50);
});

test('zoom mode: ctrl-wheel (trackpad pinch) still zooms', async ({ page }) => {
  await boot(page, 'zoom');
  const a = await read(page);
  await page.mouse.move(600, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const b = await read(page);
  expect(b.zoom).toBeGreaterThan(a.zoom);
});
