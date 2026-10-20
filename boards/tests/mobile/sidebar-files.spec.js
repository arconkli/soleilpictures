// The files sidebar in the phone drawer, through the dev-only QA harness
// (?sidebarqa=1, which opens its drawer on a phone the way the menu button
// would). The same two parts as the desktop — clusters, then the files of the
// one you're in (or Recent, or Starred: tabs) — sized for a thumb and scrolling
// as one: 44px rows and tabs, tap for Quick look, hold for a file's menu, and
// no handles to size anything.
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
    // A panel, not cards: nothing to size them by.
    await expect(page.locator('.sbf-handle')).toHaveCount(0);
    expect(await page.locator('.sbf-card').evaluateAll((els) => els.map((el) => getComputedStyle(el).display))).toEqual(['contents', 'contents']);
    const h = (sel) => page.locator(sel).first().evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(await h('.sb-tree-row.is-files')).toBe(44);
    expect(await h('.sbf-files .sbf-file')).toBe(44);
    expect(await h('.sbf-quickbtn')).toBe(44);
    expect(await h('.sbf-tab')).toBe(44);
    // Photos are rows like every other file: no grid of tiles.
    const photo = page.locator('.sbf-files [data-sb-item^="film:film-img-"]').first();
    expect(await photo.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(44);
    // Nothing that only shows on hover: a shelf's ⤢ isn't drawn for a finger.
    await expect(page.locator('.sbf-shelf-open').first()).toBeHidden();
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

  test('the tabs switch what the files show', async ({ page }) => {
    await open(page);
    const files = page.locator('.sbf-files');
    await files.getByRole('tab', { name: 'Starred', exact: true }).tap();
    await expect(files.getByRole('tab', { selected: true })).toHaveText('Starred');
    await expect(files.locator('.sbf-cluster-link', { hasText: 'Moodboards' })).toBeVisible();
    await files.getByRole('tab', { name: 'Feature film', exact: true }).tap();
    await expect(files.locator('[data-sb-item^="film:film-img-"]').first()).toBeVisible();
  });

  test('the cluster tab, tapped again, lists every cluster to show the files of, inside the screen', async ({ page }) => {
    await open(page);
    const files = page.locator('.sbf-files');
    await files.getByRole('tab', { name: 'Feature film', exact: true }).tap();
    const list = page.getByRole('menu', { name: 'Show the files of' });
    await expect(list).toBeVisible();
    const vw = page.viewportSize().width;
    const box = await list.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
    await list.getByRole('menuitemradio', { name: 'Casting' }).tap();
    await expect(list).toHaveCount(0);
    await expect(files.getByRole('tab', { selected: true })).toHaveText('Casting');
    await expect(files.locator('[data-sb-item^="cast:cast-img-"]').first()).toBeVisible();
    await files.getByRole('button', { name: 'Back to Feature film' }).tap();
    await expect(files.getByRole('tab', { selected: true })).toHaveText('Feature film');
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
    // The drop rules' two ways to send it on, as on a desktop.
    await expect(menu.getByText('Move to…', { exact: true })).toBeVisible();
    await expect(menu.getByText('Copy to…', { exact: true })).toBeVisible();
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
