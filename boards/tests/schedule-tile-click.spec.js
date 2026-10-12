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

// On a touch screen there is no hover and the canvas sets touch-action:none,
// so the double-click that opens a tile has to arrive from taps. A tap on the
// tile that is already selected opens it — the same "second press opens"
// gesture, without depending on the browser synthesising dblclick from a
// double-tap (iPad Safari does not reliably).
test('on touch, tapping the selected day tile opens the day', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  try {
    await page.goto('/?local=1&reset=1&blank=1');
    await page.waitForSelector('.canvas-wrap');
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    await page.locator('.canvas-wrap').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: rect.left + 420, clientY: rect.top + 200,
      }));
    });
    await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).tap();
    await page.locator('.ctx-submenu').getByRole('button', { name: 'Schedule', exact: true }).tap();
    const sched = page.locator('.schedc');
    await expect(sched.locator('.schedt')).toHaveCount(1);

    await sched.locator('.schedt-tile.is-empty .schedt-add').first().dispatchEvent('click');
    const day = sched.locator('.schedt-tile.is-day');
    await expect(day).toHaveCount(1);

    await day.tap();
    await expect(day).toHaveClass(/is-selected/);
    await page.waitForTimeout(400);
    await expect(sched).toBeVisible();

    await day.tap();
    await expect(sched).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
