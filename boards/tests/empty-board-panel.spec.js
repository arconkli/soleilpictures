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

  // The FIRST-board variant (?firstboard= is the DEV harness seam; the real
  // gate is App.jsx-only — no cards anywhere, plus first source / picked intent).
  test('a first board offers the hero plus writing tiles only, and asks for material from elsewhere', async ({ page }) => {
    await page.goto('/?local=1&reset=1&blank=1&firstboard=1');
    const panel = page.locator('.cnv-empty-tiles');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/is-first/);
    await expect(panel.locator('.cnv-empty-tile-hero-hint')).toContainText(/paste or drag/i);
    const labels = await panel.locator('.cnv-empty-tile:not(.cnv-empty-tile-hero) .cnv-empty-tile-lbl').allTextContents();
    expect(labels).toEqual(['Note', 'Doc']);
  });

  test('a first board names the job when the source says what it is', async ({ page }) => {
    await page.goto('/?local=1&reset=1&blank=1&firstboard=references');
    const panel = page.locator('.cnv-empty-tiles');
    await expect(panel.locator('.cnv-empty-tiles-head')).toHaveText('Start your reference wall');
    await expect(panel.locator('.cnv-empty-tile-hero .cnv-empty-tile-lbl')).toHaveText('Drop your references here');
  });
});
