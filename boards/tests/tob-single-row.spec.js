// The bottom tool-options bar never folds onto a second row. It used to have
// `max-width: calc(100% - 360px)` + `flex-wrap: wrap`, so a full note bar
// wrapped whenever the canvas was under ~1100px (sidebar open, docked doc).
import { expect, test } from '@playwright/test';

for (const width of [1440, 1000, 820]) {
  test(`note bar stays one row at a ${width}px window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?local=1&reset=1&blank=1');
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    const cb = await page.locator('.canvas-wrap').boundingBox();
    await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
    await page.keyboard.type('hello world');
    const bar = page.locator('.tob').first();
    await expect(bar).toBeVisible();
    await page.waitForTimeout(300); // let late buttons (comment) mount
    const r = await bar.evaluate((el) => {
      const kids = [...el.children].filter(k => k.getBoundingClientRect().height > 0);
      const tops = new Set(kids.map(k => Math.round(k.getBoundingClientRect().top + k.getBoundingClientRect().height / 2)));
      return { rows: Math.max(...tops) - Math.min(...tops), h: el.getBoundingClientRect().height };
    });
    // Every child is vertically centred on one line (allow a few px of slop).
    expect(r.rows).toBeLessThan(6);
    expect(r.h).toBeLessThan(60);
  });
}
