// Canvas camera / keyboard / paste regressions from the 2026-10 platform audit.
// Runs on the ?local=1&reset=1&blank=1 harness (zoom 1, no auto-frame), with
// LOW-on-canvas coordinates so the blank board's "Start your cluster" tiles
// never intercept a click (see undo-toast.spec.js).
import { expect, test } from '@playwright/test';

async function goBlank(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
}

async function createNote(page, text, at = { x: 350, y: 540 }) {
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: at });
  await page.locator('.note-body[contenteditable="true"]').last().click();
  await page.keyboard.type(text);
  await page.locator('.canvas-wrap').click({ position: { x: 60, y: 640 } });
  await expect(page.locator('.card', { hasText: text })).toBeVisible();
}

const readCamera = (page) => page.evaluate(() => {
  const el = document.querySelector('.canvas');
  const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform || '');
  const p = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
  return { zoom: p[0], x: p[4], y: p[5] };
});

// OVERLAY-REGISTRY-CANVAS / ACCOUNT-01 / CARDS-11: a full-screen viewer that
// never registered with modalGuard let Backspace delete the selection behind it.
test('Backspace does not delete the selection behind a full-screen viewer', async ({ page }) => {
  await goBlank(page);
  await createNote(page, 'behind-viewer');
  await page.locator('.card', { hasText: 'behind-viewer' }).first().click({ position: { x: 6, y: 6 } });

  for (const cls of ['pdfv', 'lightbox', 'settings-bg', 'iem']) {
    await page.evaluate((c) => {
      const d = document.createElement('div');
      d.className = c; d.id = 'fake-overlay';
      document.body.appendChild(d);
    }, cls);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await expect(page.locator('.card', { hasText: 'behind-viewer' })).toHaveCount(1);
    await page.evaluate(() => document.getElementById('fake-overlay')?.remove());
  }

  // A corner banner (role="dialog", not modal) must NOT freeze the shortcuts.
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'fv-banner'; d.setAttribute('role', 'dialog');
    document.body.appendChild(d);
  });
  await page.keyboard.press('Backspace');
  await expect(page.locator('.card', { hasText: 'behind-viewer' })).toHaveCount(0);
});

// SHARE-8: an open comment thread consumes Delete (preventDefault) to delete
// itself; the canvas must not ALSO delete the selected cards.
test('a Delete already consumed by another listener leaves the selection alone', async ({ page }) => {
  await goBlank(page);
  await createNote(page, 'keep-me');
  await page.locator('.card', { hasText: 'keep-me' }).first().click({ position: { x: 6, y: 6 } });
  await page.evaluate(() => {
    window.__consume = (e) => { if (e.key === 'Delete' || e.key === 'Backspace') e.preventDefault(); };
    document.addEventListener('keydown', window.__consume);
  });
  await page.keyboard.press('Backspace');
  await expect(page.locator('.card', { hasText: 'keep-me' })).toHaveCount(1);
  await page.evaluate(() => document.removeEventListener('keydown', window.__consume));
  await page.keyboard.press('Backspace');
  await expect(page.locator('.card', { hasText: 'keep-me' })).toHaveCount(0);
});

// CANVAS-A-01: use-gesture's pinch-on-wheel ran alongside the custom wheel
// handler and won, so one ctrl+scroll-down notch at 100% dropped to 10%.
test('one ctrl+wheel notch steps the zoom by about x0.78, not to the floor', async ({ page }) => {
  await goBlank(page);
  await page.waitForTimeout(500);
  const a = await readCamera(page);
  await page.mouse.move(600, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const b = await readCamera(page);
  const ratio = b.zoom / a.zoom;
  expect(ratio).toBeGreaterThan(0.7);
  expect(ratio).toBeLessThan(0.86);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const c = await readCamera(page);
  expect(c.zoom).toBeCloseTo(a.zoom, 2);
});

// CARDS-01: the PDF viewer renders inside .canvas-wrap, whose native wheel
// listener preventDefaulted every wheel over its pages and panned the board.
test('a wheel over the PDF viewer scrolls its pages, not the board', async ({ page }) => {
  await goBlank(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    const v = document.createElement('div');
    v.className = 'pdfv'; v.id = 'fake-pdfv';
    v.style.cssText = 'position:fixed;inset:80px;z-index:9999;background:#222';
    const sc = document.createElement('div');
    sc.className = 'pdfv-scroll';
    sc.style.cssText = 'position:absolute;inset:0;overflow:auto';
    const tall = document.createElement('div');
    tall.style.cssText = 'height:5000px;min-height:5000px;flex:none';   // .pdfv-scroll is a flex column
    sc.appendChild(tall); v.appendChild(sc); wrap.appendChild(v);
  });
  const a = await readCamera(page);
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(400);
  const b = await readCamera(page);
  expect(b).toEqual(a);
  expect(await page.evaluate(() => document.querySelector('#fake-pdfv .pdfv-scroll').scrollTop)).toBeGreaterThan(0);
});
