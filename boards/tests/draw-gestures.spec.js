import { expect, test } from '@playwright/test';

// Gesture lifecycle for drawing: aborting, tearing down, and routing a stroke
// onto a card. These are the cases where a half-finished gesture can leak
// window listeners, commit something the user cancelled, or write to a place
// nothing reads.

const PAD = '.sketchpad-surface';
const paths = (page) => page.locator('.strokes-layer path').count();
const cardPaths = (page) => page.locator('.card .card-strokes-overlay path').count();

async function board(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.keyboard.press('d');
  await page.waitForTimeout(250);
}
async function openPad(page) {
  await board(page);
  await page.locator('.tob-canvas-btn').first().click();
  await expect(page.locator(PAD)).toBeVisible();
  await page.waitForTimeout(200);
}
// A stroke dispatched as real PointerEvents, relative to `sel`'s box.
async function strokeOn(page, sel, { y = 60, x0 = 40, x1 = 240, id = 4 } = {}) {
  await page.evaluate(async ({ sel, y, x0, x1, id }) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const ev = (t, x, extra = {}) => new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, pointerId: id,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
      clientX: r.left + x, clientY: r.top + y, ...extra,
    });
    el.dispatchEvent(ev('pointerdown', x0));
    for (let i = 1; i <= 12; i++) {
      window.dispatchEvent(ev('pointermove', x0 + (x1 - x0) * i / 12));
      await new Promise(requestAnimationFrame);
    }
    window.dispatchEvent(ev('pointerup', x1, { buttons: 0 }));
    await new Promise(requestAnimationFrame);
  }, { sel, y, x0, x1, id });
  await page.waitForTimeout(150);
}

test('Escape mid-stroke discards it, and a later pointerup cannot resurrect it', async ({ page }) => {
  await board(page);
  await page.evaluate(() => {
    const el = document.querySelector('.canvas-wrap');
    const r = el.getBoundingClientRect();
    const ev = (t, x, extra = {}) => new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, pointerId: 11,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
      clientX: r.left + x, clientY: r.top + 300, ...extra,
    });
    el.dispatchEvent(ev('pointerdown', 340));
    window.dispatchEvent(ev('pointermove', 400));
    window.dispatchEvent(ev('pointermove', 460));
  });
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await paths(page)).toBe(0);

  // Escape used to null the in-flight stroke and leave trackStroke's window
  // listeners attached, so the eventual pointerup still ran the commit.
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 11, pointerType: 'mouse', clientX: 500, clientY: 300, buttons: 0,
  })));
  await page.waitForTimeout(200);
  expect(await paths(page)).toBe(0);
});

test('closing the sketch pad mid-stroke commits nothing and leaks nothing', async ({ page }) => {
  await openPad(page);
  await page.evaluate(() => {
    const el = document.querySelector('.sketchpad-surface');
    const r = el.getBoundingClientRect();
    const ev = (t, x, extra = {}) => new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, pointerId: 12,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
      clientX: r.left + x, clientY: r.top + 50, ...extra,
    });
    el.dispatchEvent(ev('pointerdown', 40));
    window.dispatchEvent(ev('pointermove', 90));
    window.dispatchEvent(ev('pointermove', 140));
  });
  await page.waitForTimeout(120);
  await page.locator('.sp-x').click();
  await page.waitForTimeout(400);
  await expect(page.locator(PAD)).toHaveCount(0);

  // The pad renders null rather than unmounting, so an unmount-only cleanup
  // would never have run and these listeners would still be live.
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 12, pointerType: 'mouse', clientX: 300, clientY: 300, buttons: 0,
  })));
  await page.waitForTimeout(200);
  expect(await paths(page)).toBe(0);
});

test('undo unwinds draw, draw, erase in the order they happened', async ({ page }) => {
  await board(page);
  await strokeOn(page, '.canvas-wrap', { y: 300, x0: 350, x1: 700 });
  expect(await paths(page)).toBe(2);
  await strokeOn(page, '.canvas-wrap', { y: 400, x0: 350, x1: 700 });
  expect(await paths(page)).toBe(4);

  await page.getByRole('button', { name: 'Eraser' }).click();
  await page.waitForTimeout(150);
  await page.evaluate(async () => {
    const el = document.querySelector('.canvas-wrap');
    const r = el.getBoundingClientRect();
    const ev = (t, y, extra = {}) => new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, pointerId: 8,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
      clientX: r.left + 520, clientY: r.top + y, ...extra,
    });
    el.dispatchEvent(ev('pointerdown', 270));
    for (let i = 1; i <= 10; i++) { window.dispatchEvent(ev('pointermove', 270 + i * 6)); await new Promise(requestAnimationFrame); }
    window.dispatchEvent(ev('pointerup', 330, { buttons: 0 }));
  });
  await page.waitForTimeout(400);
  expect(await paths(page)).toBe(6); // the first stroke was cut in two

  for (const expected of [4, 2, 0]) {
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);
    expect(await paths(page)).toBe(expected);
  }
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(300);
  expect(await paths(page)).toBe(2);
});

test('drawing from the board onto a LAYERED art card actually lands', async ({ page }) => {
  // The trap: `layers` takes precedence over `strokes`, so appending to
  // card.strokes here writes somewhere nothing reads and the stroke vanishes.
  await openPad(page);
  await page.getByRole('button', { name: /^Layers/ }).click();
  await page.getByRole('button', { name: 'Add layer' }).click();
  await strokeOn(page, PAD, { y: 50 });
  await strokeOn(page, PAD, { y: 90 });
  await page.getByRole('button', { name: 'Add to canvas' }).click();
  await page.waitForTimeout(600);
  await expect(page.locator('.card-kind-art')).toHaveCount(1);
  const before = await cardPaths(page);
  expect(before).toBe(2);

  await page.keyboard.press('d');
  await page.waitForTimeout(200);
  const box = await page.locator('.card-kind-art').boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 20 + (box.width - 40) * i / 10, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(await cardPaths(page)).toBe(before + 1);
});

test('erasing from the board on a LAYERED art card cuts the stroke', async ({ page }) => {
  await openPad(page);
  await page.getByRole('button', { name: /^Layers/ }).click();
  await page.getByRole('button', { name: 'Add layer' }).click();
  await strokeOn(page, PAD, { y: 60, x0: 30, x1: 300 });
  await page.getByRole('button', { name: 'Add to canvas' }).click();
  await page.waitForTimeout(600);
  expect(await cardPaths(page)).toBe(1);

  await page.keyboard.press('d');
  await page.getByRole('button', { name: 'Eraser' }).click();
  await page.waitForTimeout(200);
  const box = await page.locator('.card-kind-art').boundingBox();
  // The pad surface renders far larger than the 480x270 logical card, so a
  // stroke drawn at pad-x 30..300 maps into the card's LEFT portion.
  const cx = box.x + box.width * 0.12;
  await page.mouse.move(cx, box.y + 5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx, box.y + 5 + (box.height - 10) * i / 10);
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(await cardPaths(page)).toBe(2);
});

test('the pad bucket fill is undoable and leaves strokes alone', async ({ page }) => {
  await openPad(page);
  await strokeOn(page, PAD, { y: 50 });
  await page.getByRole('button', { name: 'Paint bucket' }).click();
  await page.waitForTimeout(150);
  await page.locator(PAD).click({ position: { x: 300, y: 200 } });
  await page.waitForTimeout(250);
  const filled = await page.locator(PAD).evaluate(el => el.style.background || el.style.backgroundColor);
  expect(await page.locator('.sketchpad-svg path').count()).toBe(1);

  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(250);
  const restored = await page.locator(PAD).evaluate(el => el.style.background || el.style.backgroundColor);
  expect(restored).not.toBe(filled);
  expect(await page.locator('.sketchpad-svg path').count()).toBe(1);
});
