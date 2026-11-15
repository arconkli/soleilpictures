// Home in a narrow window: an iPad's Slide Over (320 wide) and a small phone
// (375). Home is the rows there, with Find a cluster and New cluster on one
// line. The search field kept its input's own width, so at 320 New cluster
// ran off the right edge. Under 400 the field gives way (clustersHome.css).
import { expect, test } from '@playwright/test';

const SIZES = [{ width: 320, height: 1024 }, { width: 375, height: 812 }];

for (const size of SIZES) {
  test(`${size.width}x${size.height}: Home's New cluster is inside the window and takes a tap`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?sidebarqa=1&surface=home&drawer=0');
    await page.locator('[data-sidebarqa-ready]').waitFor({ timeout: 60000 });
    const bar = page.locator('.ch-find-row, .ch-bar');
    await expect(bar).toBeVisible();
    const btn = bar.getByRole('button', { name: 'New cluster' });
    await expect(btn).toBeVisible();
    const box = (loc) => loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const b = await box(btn);
    const whole = await box(bar);
    expect(whole.left).toBeGreaterThanOrEqual(0);
    expect(whole.right).toBeLessThanOrEqual(size.width);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(size.width);
    // The search is still there to type in.
    const find = await box(bar.locator('.ch-find'));
    expect(find.right - find.left).toBeGreaterThanOrEqual(90);
    expect(find.right).toBeLessThanOrEqual(b.left);
    // No sideways scroll on the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    // The button is its own at its middle, and the tap starts a new cluster.
    const hit = await btn.evaluate((el, [x, y]) => {
      const at = document.elementFromPoint(x, y);
      return !!at && (at === el || el.contains(at));
    }, [(b.left + b.right) / 2, (b.top + b.bottom) / 2]);
    expect(hit).toBe(true);
    await page.touchscreen.tap(Math.round((b.left + b.right) / 2), Math.round((b.top + b.bottom) / 2));
    await expect(page.locator('.ch-naming')).toBeVisible();
  });
}
