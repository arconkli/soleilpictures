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
