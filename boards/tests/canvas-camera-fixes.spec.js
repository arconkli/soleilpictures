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

// CANVAS-A-05: a wheel pan moves the camera without a mousemove, so copied
// cards pasted at the last mousemove's canvas point landed out of view.
test('copied cards paste under the cursor after a wheel pan, not where it last moved', async ({ page }) => {
  await goBlank(page);
  await createNote(page, 'copy-src');
  await page.locator('.card', { hasText: 'copy-src' }).first().click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('ControlOrMeta+c');
  // Park the cursor mid-canvas, then pan far with the wheel only.
  await page.mouse.move(640, 420);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
  await page.waitForTimeout(400);
  // The OS clipboard is empty here, so this exercises the internal fallback.
  await page.evaluate(() => {
    const ev = new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
  });
  // Off-screen cards are culled from the DOM, so look for the copy by where it
  // is: its top-left under the cursor.
  await expect.poll(() => page.locator('.card', { hasText: 'copy-src' }).evaluateAll((els) => els.some((el) => {
    const r = el.getBoundingClientRect();
    return Math.abs(r.x - 640) < 40 && Math.abs(r.y - 420) < 40;
  }))).toBe(true);
});

// CANVAS-A-06: the zoom widget's −/+ and 100% (and ⌘0) scaled around the
// board origin, so whatever you were looking at slid off-screen.
test('zoom widget buttons and ⌘0 keep the view centre in place', async ({ page }) => {
  await goBlank(page);
  await page.waitForTimeout(500);
  const centreWorld = async () => {
    const cam = await readCamera(page);
    const r = await page.evaluate(() => {
      const b = document.querySelector('.canvas-wrap').getBoundingClientRect();
      return { w: b.width, h: b.height };
    });
    return { x: (r.w / 2 - cam.x) / cam.zoom, y: (r.h / 2 - cam.y) / cam.zoom, zoom: cam.zoom };
  };
  // Pan far from the origin with the wheel.
  await page.mouse.move(640, 420);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(500, 500);
  await page.waitForTimeout(400);
  const a = await centreWorld();
  // dispatchEvent: at the harness viewport the settings gear overlaps the
  // widget's corner, and the click under test is the handler, not the layout.
  // By name: the toolbar look draws − and + as icons.
  const zoomBtn = (name) => page.locator('.cnv-zoom').getByRole('button', { name, exact: true });
  for (const step of [
    () => zoomBtn('Zoom in').dispatchEvent('click'),
    () => zoomBtn('Zoom out').dispatchEvent('click'),
    () => zoomBtn('Zoom out').dispatchEvent('click'),
    () => page.locator('.cnv-zoom-val').dispatchEvent('click'),
    () => page.keyboard.press('ControlOrMeta+0'),
  ]) {
    await step();
    await page.waitForTimeout(450);
    const b = await centreWorld();
    expect(Math.abs(b.x - a.x)).toBeLessThan(3);
    expect(Math.abs(b.y - a.y)).toBeLessThan(3);
  }
  expect((await readCamera(page)).zoom).toBeCloseTo(1, 2);
});

// CANVAS-A-10: pasted text and links were clamped to x,y >= 8, so a paste made
// while looking at negative board space landed at the origin, out of view.
test('pasted text lands in view over negative board space', async ({ page }) => {
  await goBlank(page);
  await page.mouse.move(640, 420);
  // Wheel up/left pans toward negative board coordinates.
  for (let i = 0; i < 5; i++) await page.mouse.wheel(-600, -600);
  await page.waitForTimeout(400);
  const cam = await readCamera(page);
  expect(cam.x).toBeGreaterThan(1000);   // the origin is far off to the right
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'negative-space-paste');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const note = page.locator('.card', { hasText: 'negative-space-paste' });
  await expect(note).toBeVisible();
  const box = await note.boundingBox();
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(wrap.x);
  expect(box.x + box.width).toBeLessThanOrEqual(wrap.x + wrap.width);
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(40);
});

// CANVAS-A-11 / CANVAS-B-09: the drag divided screen deltas by the render-time
// zoom, so a wheel pan while holding a card left it riding with the canvas,
// off the cursor.
test('a card held through a wheel pan stays under the cursor', async ({ page }) => {
  await goBlank(page);
  await createNote(page, 'hold-me');
  const card = page.locator('.card', { hasText: 'hold-me' }).first();
  // Select it first (the corner, as the other specs do) so the press drags
  // the card rather than landing in the note's text.
  await card.click({ position: { x: 6, y: 6 } });
  // Focusing a note low in the harness viewport can leave an ANCESTOR of the
  // canvas scrolled, which then moves under the wheel too. Undo that so the
  // only thing the wheel moves is the camera.
  await page.evaluate(() => {
    for (let el = document.querySelector('.canvas-wrap'); el; el = el.parentElement) {
      if (el.scrollTop) el.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(100);
  const b0 = await card.boundingBox();
  const grab = { x: b0.x + 6, y: b0.y + 6 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 30, grab.y + 10, { steps: 8 });
  // The drag is live: the card has followed the pointer.
  await expect.poll(async () => Math.round((await card.boundingBox()).x - b0.x)).toBeGreaterThan(20);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  await page.mouse.move(grab.x + 40, grab.y + 12, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const b1 = await card.boundingBox();
  // The grab point is where the cursor let go.
  expect(Math.abs(b1.x + 6 - (grab.x + 40))).toBeLessThan(12);
  expect(Math.abs(b1.y + 6 - (grab.y + 12))).toBeLessThan(12);
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
