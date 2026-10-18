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
    expect(await h('.sbf-own')).toBe(44);
    // Tiles stay inside their panel: none overflows its right edge.
    const panel = page.locator('.sbf-panel').filter({ has: page.locator('.sbf-mosaic') }).first();
    const panelRight = await panel.evaluate((el) => el.getBoundingClientRect().right);
    const tileRights = await panel.locator('.sbf-mosaic').first().locator('.sbf-tile')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
    for (const r of tileRights) expect(r).toBeLessThanOrEqual(panelRight);
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
    // Held until the menu shows, as a finger would be: lifting at a fixed time
    // raced the hold's own timer on a loaded WebKit.
    const menu = page.locator('.ctx-menu').last();
    await expect(menu.getByText('Quick look', { exact: true })).toBeVisible();
    await file.dispatchEvent('pointerup', at);
    await file.dispatchEvent('click', at);
    await page.waitForTimeout(400);
    await expect(page.getByText(/of 3$/)).toHaveCount(0);   // no Quick look under the menu
  });

  test('a hold that ends without a click (Android) does not eat the next tap', async ({ page }) => {
    await open(page);
    const file = page.locator('.sbf-block .sbf-file', { hasText: 'film-take-1.mov' });
    const box = await file.boundingBox();
    const at = { clientX: box.x + 20, clientY: box.y + 10, pointerType: 'touch', isPrimary: true, bubbles: true, pointerId: 9 };
    await file.dispatchEvent('pointerdown', at);
    await expect(page.locator('.ctx-menu').last().getByText('Quick look', { exact: true })).toBeVisible();
    await file.dispatchEvent('pointerup', at);          // …and no click, as Android ends a long press
    await page.keyboard.press('Escape');
    await expect(page.locator('.ctx-menu')).toHaveCount(0);
    await file.tap();
    await expect(page.getByText(/of 3$/)).toBeVisible();
  });
});
