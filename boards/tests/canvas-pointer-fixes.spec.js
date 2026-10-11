import { expect, test } from '@playwright/test';

// Canvas pointer gestures and menus: small regressions, one test each.
// Harness: ?local=1&reset=1&blank=1.

async function blank(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(800);
}

test('reordering a palette swatch and missing never drops a stray note', async ({ page }) => {
  await blank(page);
  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Palette', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 460, y: 360 } });
  await expect(page.locator('.pc').last()).toBeVisible();
  const cards = await page.locator('.card').count();

  // Release the swatch on bare canvas, well away from the palette. Dispatched
  // by hand with one shared DataTransfer, which is what a real drag carries
  // from dragstart through to drop.
  const accepted = await page.evaluate(() => {
    const dt = new DataTransfer();
    const cell = document.querySelector('.pc-cell');
    cell.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    const at = { clientX: r.left + 700, clientY: r.top + 600 };
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
    wrap.dispatchEvent(over);
    wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
    cell.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return over.defaultPrevented;
  });
  await page.waitForTimeout(400);
  // The canvas doesn't even offer itself as a drop target for a swatch.
  expect(accepted).toBe(false);
  await expect(page.locator('.card')).toHaveCount(cards);
});
