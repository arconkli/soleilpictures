// A card dragged into a grid cell goes where it is let go. While a card is
// dragged, what's under the pointer (a cell, a cluster card) is checked at
// most every 50ms, and the release used the last check: a quick drop was
// decided by where the pointer had been a moment before, and the card landed
// beside the cell instead of in it.
import { expect, test } from '@playwright/test';

async function placeGridAt(page, sx, sy) {
  await page.locator('.canvas-wrap').evaluate((node, p) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + p.x, clientY: rect.top + p.y }));
  }, { x: sx, y: sy });
  await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Grid', exact: true }).click();
}

const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

test('a grid let go over a cell moments after reaching it is grafted into the cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForSelector('.canvas-wrap');
  await placeGridAt(page, 320, 300);
  await placeGridAt(page, 760, 300);
  const grids = page.locator('.card-kind-grid');
  await expect(grids).toHaveCount(2);
  // Both have landed (a new card pops in), so their boxes are where they stay.
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.card')]
    .flatMap((el) => el.getAnimations()).map((a) => a.finished)));
  const boxes = (await grids.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON())))
    .sort((a, b) => a.x - b.x);
  const [a, b] = boxes;
  // Grab the right grid, move it a little (what's under the pointer is
  // checked here: nothing), then onto the left grid's last cell and let go
  // within the same 50ms.
  await page.mouse.move(b.x + 40, b.y + 24);
  await page.mouse.down();
  await page.mouse.move(b.x + 64, b.y + 44);
  await nextFrame(page);
  await page.mouse.move(a.x + a.width - 60, a.y + a.height - 60);
  await nextFrame(page);
  await page.mouse.up();
  await expect(grids).toHaveCount(1);
  await expect(page.locator('.card-kind-grid .gridc-cell')).toHaveCount(5);
});
