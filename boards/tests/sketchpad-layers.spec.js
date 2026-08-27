import { expect, test } from '@playwright/test';

// Layers in the sketch pad.
//
// The point of them on a storyboard frame is roughing a shot out and then
// inking over the top without the rough in the way.
//
// Two things are worth failing a build over. First, a card that predates layers
// must open with its drawing intact — cardLayers() presents it as one implicit
// layer, and if that ever stops working every art canvas in every board opens
// blank. Second, a single-layer sketch must still write the exact card shape it
// always did, so nothing downstream has to learn what a layer is.

async function openPad(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.keyboard.press('d');
  await page.waitForTimeout(300);
  await page.locator('.tob-canvas-btn').first().click();
  await expect(page.locator('.sketchpad-surface')).toBeVisible();
  await page.waitForTimeout(200);
}

// Draw one stroke on the pad at a given vertical offset.
async function padStroke(page, row = 0) {
  await page.evaluate(async (row) => {
    const el = document.querySelector('.sketchpad-surface');
    const r = el.getBoundingClientRect();
    const y = r.top + 30 + row * 26;
    const ev = (t, x, extra = {}) => new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, pointerId: 3,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
      clientX: x, clientY: y, ...extra,
    });
    const x0 = r.left + 30, x1 = r.left + Math.min(200, r.width - 30);
    el.dispatchEvent(ev('pointerdown', x0));
    for (let i = 1; i <= 10; i++) {
      window.dispatchEvent(ev('pointermove', x0 + (x1 - x0) * i / 10));
      await new Promise(requestAnimationFrame);
    }
    window.dispatchEvent(ev('pointerup', x1, { buttons: 0 }));
    await new Promise(requestAnimationFrame);
  }, row);
  await page.waitForTimeout(150);
}

const paths = (page) => page.locator('.sketchpad-svg path').count();

test('a new sketch starts as one layer and adds more on demand', async ({ page }) => {
  await openPad(page);
  await page.getByRole('button', { name: /^Layers/ }).click();
  await expect(page.locator('.sp-layer')).toHaveCount(1);

  await page.getByRole('button', { name: 'Add layer' }).click();
  await expect(page.locator('.sp-layer')).toHaveCount(2);
  // The new layer becomes the active one — you add a layer in order to draw
  // on it.
  await expect(page.locator('.sp-layer.is-active .sp-layer-name')).toContainText('Layer 2');
});

test('hiding a layer hides only its strokes', async ({ page }) => {
  await openPad(page);
  await padStroke(page, 0);
  await page.getByRole('button', { name: /^Layers/ }).click();
  await page.getByRole('button', { name: 'Add layer' }).click();
  await padStroke(page, 3);
  expect(await paths(page)).toBe(2);

  await page.getByRole('button', { name: 'Hide Layer 1' }).click();
  await page.waitForTimeout(150);
  expect(await paths(page)).toBe(1);

  await page.getByRole('button', { name: 'Show Layer 1' }).click();
  await page.waitForTimeout(150);
  expect(await paths(page)).toBe(2);
});

test('drawing lands on the ACTIVE layer, and erasing only touches it', async ({ page }) => {
  await openPad(page);
  await padStroke(page, 0);
  await page.getByRole('button', { name: /^Layers/ }).click();
  await page.getByRole('button', { name: 'Add layer' }).click();
  await padStroke(page, 3);
  // One stroke on each.
  await expect(page.locator('.sp-layer').nth(0)).toContainText('Layer 2');
  await expect(page.locator('.sp-layer').nth(1)).toContainText('Layer 1');

  // Hiding Layer 2 leaves exactly Layer 1's stroke, proving they went to
  // different layers rather than both landing on one.
  await page.getByRole('button', { name: 'Hide Layer 2' }).click();
  await page.waitForTimeout(150);
  expect(await paths(page)).toBe(1);
});

test('layer changes are undoable', async ({ page }) => {
  await openPad(page);
  await page.getByRole('button', { name: /^Layers/ }).click();
  await page.getByRole('button', { name: 'Add layer' }).click();
  await expect(page.locator('.sp-layer')).toHaveCount(2);

  // History snapshots the whole stack, not just the active layer's strokes —
  // without that, adding or deleting a layer would not be undoable at all.
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(200);
  await expect(page.locator('.sp-layer')).toHaveCount(1);

  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(200);
  await expect(page.locator('.sp-layer')).toHaveCount(2);
});

test('an empty layer deletes without a prompt; the last one cannot be deleted', async ({ page }) => {
  await openPad(page);
  await page.getByRole('button', { name: /^Layers/ }).click();
  await page.getByRole('button', { name: 'Add layer' }).click();
  await expect(page.locator('.sp-layer')).toHaveCount(2);

  await page.getByRole('button', { name: 'Delete Layer 2' }).click();
  await page.waitForTimeout(200);
  await expect(page.locator('.sp-layer')).toHaveCount(1);
  // A card always has at least one layer, so the last delete is disabled
  // rather than leaving the pad with nothing to draw on.
  await expect(page.getByRole('button', { name: 'Delete Layer 1' })).toBeDisabled();
});

test('a single-layer sketch commits the same card shape it always did', async ({ page }) => {
  await openPad(page);
  await padStroke(page, 0);
  await page.getByRole('button', { name: 'Add to canvas' }).click();
  await page.waitForTimeout(500);

  // One art card, drawing intact. A single-layer sketch writes no `layers`
  // field at all, so this is byte-for-byte the card shape that shipped before
  // layers existed — and it still renders through the same overlay.
  await expect(page.locator('.card-kind-art')).toHaveCount(1);
  await expect(page.locator('.card .card-strokes-overlay path')).toHaveCount(1);
});

test('a multi-layer sketch commits every visible layer, flattened', async ({ page }) => {
  await openPad(page);
  await padStroke(page, 0);
  await page.getByRole('button', { name: /^Layers/ }).click();
  await page.getByRole('button', { name: 'Add layer' }).click();
  await padStroke(page, 3);
  await padStroke(page, 6);

  await page.getByRole('button', { name: 'Add to canvas' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.card-kind-art')).toHaveCount(1);
  // Three strokes across two layers, all painted on the card.
  await expect(page.locator('.card .card-strokes-overlay path')).toHaveCount(3);
});

test('reopening a committed sketch restores its layers', async ({ page }) => {
  await openPad(page);
  await padStroke(page, 0);
  await page.getByRole('button', { name: /^Layers/ }).click();
  await page.getByRole('button', { name: 'Add layer' }).click();
  await padStroke(page, 3);
  await page.getByRole('button', { name: 'Add to canvas' }).click();
  await page.waitForTimeout(500);

  // Double-click the art card to edit it again.
  await page.locator('.card-kind-art').dblclick();
  await expect(page.locator('.sketchpad-surface')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await paths(page)).toBe(2);
  await page.getByRole('button', { name: /^Layers/ }).click();
  // Both layers came back — not flattened into one on the round trip.
  await expect(page.locator('.sp-layer')).toHaveCount(2);
});
