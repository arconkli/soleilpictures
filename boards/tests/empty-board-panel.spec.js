// Empty-board panel refinement + add-menu stacking fix (CSS-only).
//  - The "+" add menu must paint ABOVE the rail tooltips (z-index 70 > 60).
//  - The empty-board capability tiles must lay out as a balanced grid (no
//    5-in-row-1 + 1-orphan), i.e. 2 rows of 3.
//  - The redundant breadth subline is hidden for a minimal, simple panel.
import { expect, test } from '@playwright/test';

test.describe('empty-board panel + add-menu', () => {
  test('the + add menu stacks above the rail tooltips (z-index 70)', async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    await expect(page.locator('.cnv-tools')).toBeVisible();
    await page.locator('.cnv-add-wrap').getByRole('button', { name: 'Add menu', exact: true }).click();
    const menu = page.locator('.cnv-add-menu');
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((el) => getComputedStyle(el).zIndex)).toBe('70');
  });

  test('the capability tiles form a balanced 2×3 grid (no orphan row)', async ({ page }) => {
    await page.goto('/?local=1&reset=1&blank=1');
    await expect(page.locator('.cnv-empty-tiles')).toBeVisible();
    const rows = await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.cnv-empty-tile:not(.cnv-empty-tile-hero)'));
      const tops = tiles.map((t) => Math.round(t.getBoundingClientRect().top));
      // bucket tops that are within 4px of each other into the same row
      const buckets = [];
      for (const top of tops) {
        const b = buckets.find((x) => Math.abs(x.top - top) <= 4);
        if (b) b.n += 1; else buckets.push({ top, n: 1 });
      }
      return buckets.sort((a, b) => a.top - b.top).map((b) => b.n);
    });
    expect(rows).toEqual([3, 3]); // two tidy rows of three — no 5+1 orphan
  });

  test('the redundant breadth subline is hidden for a minimal panel', async ({ page }) => {
    await page.goto('/?local=1&reset=1&blank=1');
    await expect(page.locator('.cnv-empty-tiles')).toBeVisible();
    const display = await page
      .locator('.cnv-empty-tiles-breadth')
      .evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('none');
  });
});
