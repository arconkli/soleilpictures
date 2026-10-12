import { expect, test } from '@playwright/test';

// NOTES-06: the sketch pad's desktop close (X) threw the drawing away with no
// confirm, while Cancel, Escape and the compact X all asked first.

const PAD = '.sketchpad-surface';

async function openPad(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('d');
  await page.waitForTimeout(250);
  await page.locator('.tob-canvas-btn').first().click();
  await expect(page.locator(PAD)).toBeVisible();
  await page.waitForTimeout(200);
}

async function stroke(page) {
  await page.evaluate(async () => {
    const el = document.querySelector('.sketchpad-surface');
    const r = el.getBoundingClientRect();
    const ev = (t, x, extra = {}) => new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, pointerId: 5,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
      clientX: r.left + x, clientY: r.top + 60, ...extra,
    });
    el.dispatchEvent(ev('pointerdown', 40));
    for (let i = 1; i <= 12; i++) {
      window.dispatchEvent(ev('pointermove', 40 + 200 * i / 12));
      await new Promise(requestAnimationFrame);
    }
    window.dispatchEvent(ev('pointerup', 240, { buttons: 0 }));
    await new Promise(requestAnimationFrame);
  });
  await page.waitForTimeout(150);
}

test('the close X asks before discarding a drawing', async ({ page }) => {
  await openPad(page);
  await stroke(page);
  await expect(page.locator('.sketchpad-svg path')).toHaveCount(1);

  await page.locator('.sp-x').click();
  await expect(page.getByText('Discard sketch?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  await expect(page.getByText('Discard sketch?')).toHaveCount(0);
  await expect(page.locator(PAD)).toBeVisible();
  await expect(page.locator('.sketchpad-svg path')).toHaveCount(1);

  await page.locator('.sp-x').click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator(PAD)).toHaveCount(0);
});

test('the close X on an untouched pad closes straight away', async ({ page }) => {
  await openPad(page);
  await page.locator('.sp-x').click();
  await expect(page.locator(PAD)).toHaveCount(0);
});

// Draw, add to the canvas, and reopen that art canvas in the pad.
async function reopenArtCanvas(page) {
  await openPad(page);
  await stroke(page);
  await page.getByRole('button', { name: /^Add( to canvas)?$/ }).click();
  await expect(page.locator(PAD)).toHaveCount(0);
  const art = page.locator('.art-canvas-card').first();
  await expect(art).toBeVisible();
  await page.keyboard.press('v');
  await art.dblclick();
  await expect(page.locator(PAD)).toBeVisible();
  await expect(page.locator('.sketchpad-svg path')).toHaveCount(1);
  await page.waitForTimeout(200);
}

// NOTES-16: reopening an art canvas and closing it untouched warned that the
// drawing would be lost: the prompt counted the strokes the pad was seeded with.
test('closing a reopened art canvas with no changes does not ask', async ({ page }) => {
  await reopenArtCanvas(page);
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^Discard/)).toHaveCount(0);
  await expect(page.locator(PAD)).toHaveCount(0);
  await expect(page.locator('.art-canvas-card')).toHaveCount(1);
});

test('closing a reopened art canvas after drawing asks about the changes', async ({ page }) => {
  await reopenArtCanvas(page);
  await stroke(page);
  await page.locator('.sp-x').click();
  await expect(page.getByText('Discard changes?')).toBeVisible();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator(PAD)).toHaveCount(0);
});

// SKETCH-ESC: Escape belongs to the top layer. With the custom colour pad open
// over the sketch pad, Escape went to the sketch pad and closed it.
test('Escape closes the colour pad, not the sketch pad under it', async ({ page }) => {
  await openPad(page);
  await page.getByRole('button', { name: 'Custom colour' }).first().click();
  await expect(page.locator('.cp-pop')).toBeVisible();
  await page.locator('.cp-pop .cp-head').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cp-pop')).toHaveCount(0);
  await expect(page.locator(PAD)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(PAD)).toHaveCount(0);
});

test('Escape closes the layers panel before the sketch pad', async ({ page }) => {
  await openPad(page);
  const layersBtn = page.locator('.sp-action', { hasText: /Layers/ });
  await layersBtn.click();
  await expect(page.locator('.sp-layers-dock')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sp-layers-dock')).toHaveCount(0);
  await expect(page.locator(PAD)).toBeVisible();
});
