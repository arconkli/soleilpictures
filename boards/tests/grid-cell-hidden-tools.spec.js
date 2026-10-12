import { expect, test } from '@playwright/test';

// A grid cell's tools (Clear, the split / Replace pill) are opacity:0 until the
// cell is hovered. An invisible control used to still take a tap, and a touch
// screen has no hover to reveal it first: tapping a filled cell's corner to
// select the grid cleared the cell (CARDS-03). On a hover:none screen the
// hidden tools are click-through until they're shown on the focused cell of a
// selected grid. Desktop keeps hover-to-reveal.

test.describe('hidden grid cell tools', () => {
  test('on touch, Clear and the pill take no taps until their cell is focused in a selected grid', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    try {
      await page.goto('/?local=1&reset=1');
      expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
      await page.locator('[data-card-id="home-grid"] .gridc-cell-image .gc-img').first().waitFor({ state: 'attached' });
      const cell = page.locator('[data-card-id="home-grid"] .gridc-cell-image').first();
      const clear = cell.locator('.gridc-cell-x');
      const pill = cell.locator('.gridc-celltools > .gridc-pill, .gridc-pill-mini').first();
      await expect(clear).toHaveCount(1);

      const pe = (loc) => loc.evaluate((el) => getComputedStyle(el).pointerEvents);
      expect(await pe(clear)).toBe('none');
      expect(await pe(pill)).toBe('none');

      // A tap in the middle of the cell selects the grid and focuses the
      // cell — and clears nothing. Now the tools show there, and are live.
      await cell.tap();
      await expect(page.locator('[data-card-id="home-grid"]')).toHaveClass(/is-selected/);
      await expect(cell).toHaveClass(/is-focused/);
      await expect(cell.locator('.gc-img')).toHaveCount(1);
      expect(await pe(clear)).toBe('auto');
      expect(await pe(pill)).toBe('auto');
      expect(await clear.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    } finally {
      await ctx.close();
    }
  });

  test('on desktop, the tools stay live under the pointer', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?local=1&reset=1');
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(false);
    const cell = page.locator('[data-card-id="home-grid"] .gridc-cell-image').first();
    await cell.locator('.gc-img').waitFor({ state: 'visible' });
    expect(await cell.locator('.gridc-cell-x').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
  });
});
