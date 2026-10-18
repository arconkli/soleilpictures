// The files sidebar in the phone drawer, through the dev-only QA harness
// (?sidebarqa=1, which opens its drawer on a phone the way the menu button
// would). The same two parts as the desktop — clusters, then the files of the
// one you're in — sized for a thumb and scrolling as one: 44px rows, tap for
// Quick look, hold for a file's menu, no resize handle and no divider.
import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/?sidebarqa=1');
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.sbf-block').first()).toBeVisible();
}

test.describe('sidebar files on a phone', () => {
  test('the drawer holds the clusters and then the files, in touch-sized rows, scrolling as one', async ({ page }) => {
    await open(page);
    await expect(page.locator('.sidebar.is-mobile-open')).toBeVisible();
    await expect(page.locator('.sbf-resizer')).toHaveCount(0);
    await expect(page.locator('.sbf-divider')).toBeHidden();
    const h = (sel) => page.locator(sel).first().evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(await h('.sb-tree-row.is-files')).toBe(44);
    expect(await h('.sbf-files .sbf-file')).toBe(48);
    // Photos are rows like every other file: no grid of tiles.
    const photo = page.locator('.sbf-files [data-sb-item^="film:film-img-"]').first();
    expect(await photo.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(48);
    await expect(page.locator('.sbf-files .sbf-tile, .sbf-files .sbf-mosaic')).toHaveCount(0);
    // The files come after the clusters, in the same scroll.
    const navBottom = await page.locator('.sbf-nav').evaluate((el) => el.getBoundingClientRect().bottom);
    const filesTop = await page.locator('.sbf-files').evaluate((el) => el.getBoundingClientRect().top);
    expect(filesTop).toBeGreaterThanOrEqual(navBottom - 1);
    // Rows stay inside the files: none overflows their right edge.
    const right = await page.locator('.sbf-files').evaluate((el) => el.getBoundingClientRect().right);
    const rowRights = await page.locator('.sbf-files .sbf-file')
      .evaluateAll((els) => els.slice(0, 8).map((el) => el.getBoundingClientRect().right));
    for (const r of rowRights) expect(r).toBeLessThanOrEqual(right);
  });

  test('a tap opens Quick look', async ({ page }) => {
    await open(page);
    await page.locator('.sbf-files [data-sb-item^="film:film-img-"]').first().tap();
    await expect(page.getByText(/1 of 30/)).toBeVisible();
  });

  test('holding a file opens its menu, and the tap that ends the hold opens nothing else', async ({ page }) => {
    await open(page);
    const file = page.locator('.sbf-files .sbf-file', { hasText: 'film-take-1.mov' });
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
    const file = page.locator('.sbf-files .sbf-file', { hasText: 'film-take-1.mov' });
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
