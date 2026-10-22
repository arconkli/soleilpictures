// A shared cluster that opens in Files, on a phone or a touch tablet: the
// full Files page's phone layout without App around it, the sheet the screen
// under the link's bar, Grid | List in the menu, every control a finger's
// size. Same route-intercepted fixtures as the desktop spec.

import { expect, test } from '@playwright/test';
import { TOKEN, routeShareBundle, routeAnalytics, routeImageCdn } from '../helpers/share-fixture.js';

async function open(page) {
  await routeAnalytics(page, []);
  await routeImageCdn(page);
  await routeShareBundle(page, { listView: true });
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.list-wrap[data-look="sb"] .fp-titlebar')).toBeVisible();
}

test('the sheet is the screen under the link’s bar, and Grid | List are in the menu', async ({ page }) => {
  await open(page);
  const sheet = page.locator('.list-wrap');
  await expect(sheet).toHaveAttribute('data-shell', 'mobile');
  const box = await sheet.boundingBox();
  const bar = await page.locator('.public-topbar').boundingBox();
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(page.viewportSize().width);
  expect(Math.round(box.y)).toBe(Math.round(bar.y + bar.height));
  await expect(page.locator('.fp-seg')).toHaveCount(0);
  await expect(page.locator('.fp-shrink')).toHaveCount(0);
  const search = await page.locator('.fp-search').boundingBox();
  const menuBtn = await page.locator('.fp-tools .sbf-filter-btn').boundingBox();
  expect(search.width).toBeGreaterThan(box.width / 2);
  expect(menuBtn.height).toBeGreaterThanOrEqual(40);

  await page.locator('.fp-tools .sbf-filter-btn').tap();
  const list = page.getByRole('group', { name: 'Layout' }).getByRole('menuitemradio', { name: 'List' });
  expect((await list.boundingBox()).height).toBeGreaterThanOrEqual(40);
  await list.tap();
  await expect(page.locator('.ct-table.is-classic')).toBeVisible();
});

test('the sample pack keeps its line under the search', async ({ page }) => {
  await open(page);
  await page.locator('.fp-tools .sbf-filter-btn').tap();
  await page.getByRole('menu', { name: 'Show and sort' }).getByRole('menuitemradio', { name: /^Audio/ }).tap();
  const found = page.locator('.fp-found.is-pack');
  await expect(found).toBeVisible();
  await expect(found).toContainText('2 audio files');
});
