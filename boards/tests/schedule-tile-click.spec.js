import { expect, test } from '@playwright/test';

// In Tiles density a single click on a day tile selects it (and highlights it
// in the wall chart) for an editor too; a double-click opens the day. The
// drag grip used to treat any press that didn't move as "open" (CARDS-09).

test('an editor single-clicking a day tile selects it instead of opening it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForSelector('.canvas-wrap');
  const canvas = page.locator('.canvas-wrap');
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: rect.left + 520, clientY: rect.top + 200,
    }));
  });
  await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('button', { name: 'Schedule', exact: true }).click();
  const sched = page.locator('.schedc');
  await expect(sched.locator('.schedt')).toHaveCount(1);

  const empty = sched.locator('.schedt-tile.is-empty').first();
  await empty.hover();
  await empty.locator('.schedt-add').click();
  const day = sched.locator('.schedt-tile.is-day');
  await expect(day).toHaveCount(1);
  await expect(day).toHaveClass(/is-draggable/);

  await day.click();
  await expect(day).toHaveClass(/is-selected/);
  // Still on this cluster: the click did not navigate into the day.
  await page.waitForTimeout(400);
  await expect(sched).toBeVisible();
  await expect(sched.locator('.schedw-d.is-selected')).toHaveCount(1);
});
