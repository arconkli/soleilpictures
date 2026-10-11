import { expect, test } from '@playwright/test';

// A grid cell's tools (Clear, the split / Replace pill) are opacity:0 until the
// cell is hovered. An invisible control used to still take a tap, and a touch
// screen has no hover to reveal it first: tapping a filled cell's corner to
// select the grid cleared the cell. Hidden tools must be click-through.

test.describe('hidden grid cell tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?local=1&reset=1');
    await page.locator('[data-card-id="home-grid"] .gridc-cell-image .gc-img').first().waitFor({ state: 'visible' });
  });

  test('Clear and the pill take no pointer events until the cell is hovered', async ({ page }) => {
    const cell = page.locator('[data-card-id="home-grid"] .gridc-cell-image').first();
    const clear = cell.locator('.gridc-cell-x');
    const pill = cell.locator('.gridc-celltools > .gridc-pill, .gridc-pill-mini').first();
    await expect(clear).toHaveCount(1);

    await page.mouse.move(2, 2);
    expect(await clear.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    expect(await pill.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    // What a tap on that corner actually hits is the cell, not the hidden button.
    const hit = await clear.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!t && !t.closest('.gridc-cell-x');
    });
    expect(hit).toBe(true);

    await cell.hover();
    await expect.poll(() => clear.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
    await expect.poll(() => pill.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
  });
});
