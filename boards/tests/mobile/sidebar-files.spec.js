// The files sidebar in the phone drawer, through the dev-only QA harness
// (?sidebarqa=1, which opens its drawer on a phone the way the menu button
// would). Same tree as the desktop, sized for a thumb: 44px rows, tap for
// Quick look, hold for a file's menu, no resize handle.
import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/?sidebarqa=1');
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.sbf-block').first()).toBeVisible();
}

test.describe('sidebar files on a phone', () => {
  test('the drawer holds the same tree, in touch-sized rows', async ({ page }) => {
    await open(page);
    await expect(page.locator('.sidebar.is-mobile-open')).toBeVisible();
    await expect(page.locator('.sbf-resizer')).toHaveCount(0);
    const h = (sel) => page.locator(sel).first().evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(await h('.sb-tree-row.is-files')).toBe(44);
    expect(await h('.sbf-block .sbf-file')).toBe(44);
    expect(await h('.sbf-block .sbf-mosaic')).toBe(58);
    // Tiles stay inside the drawer: none overflows its right edge.
    const drawerRight = await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right);
    const tileRights = await page.locator('.sbf-block .sbf-mosaic').first().locator('.sbf-tile')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
    for (const r of tileRights) expect(r).toBeLessThanOrEqual(drawerRight);
  });

  test('a tap opens Quick look', async ({ page }) => {
    await open(page);
    await page.locator('.sbf-block .sbf-tile').first().tap();
    await expect(page.getByText(/1 of 30/)).toBeVisible();
  });

  test('holding a file opens its menu, and the tap that ends the hold opens nothing else', async ({ page }) => {
    await open(page);
    const file = page.locator('.sbf-block .sbf-file', { hasText: 'film-take-1.mov' });
    const box = await file.boundingBox();
    const at = { clientX: box.x + 20, clientY: box.y + 10, pointerType: 'touch', isPrimary: true, bubbles: true, pointerId: 7 };
    await file.dispatchEvent('pointerdown', at);
    await page.waitForTimeout(650);
    await file.dispatchEvent('pointerup', at);
    await file.dispatchEvent('click', at);
    const menu = page.locator('.ctx-menu').last();
    await expect(menu.getByText('Quick look', { exact: true })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByText(/of 3$/)).toHaveCount(0);   // no Quick look under the menu
  });
});
