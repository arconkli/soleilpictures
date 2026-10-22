// A shared or published cluster its owner set to open in Files shows the
// full Files page a member sees signed in (direction A's look), without what
// changes it: the sheet on the board's ground, the name, the search and "All
// files ⌄", Grid | List, Info as a card, all of it dark whatever the
// visitor's theme, as the page around it is. Route-intercepted fixtures
// (tests/helpers/share-fixture.js): no PartyKit, no Supabase.

import { expect, test } from '@playwright/test';
import { TOKEN, routeShareBundle, routeAnalytics, routeImageCdn } from './helpers/share-fixture.js';

async function open(page) {
  await routeAnalytics(page, []);
  await routeImageCdn(page);
  await routeShareBundle(page, { listView: true });
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-canvas-host.is-files .list-wrap[data-look="sb"] .fp-titlebar')).toBeVisible();
}

test.describe('a shared cluster that opens in Files', () => {
  test('is the full Files page, read-only: the name, the search, All files, Grid | List', async ({ page }) => {
    await open(page);
    // The name alone: a visitor has no workspace to switch through.
    await expect(page.locator('.fp-title-text')).toHaveText('Marketing Root');
    await expect(page.locator('.fp-title-btn')).toHaveCount(0);
    await expect(page.locator('.fp-search input')).toHaveAttribute('placeholder', 'Search Marketing Root');
    await expect(page.locator('.fp-tools .sbf-filter-btn')).toBeVisible();
    await expect(page.locator('.fp-seg')).toBeVisible();
    await expect(page.locator('.fp-shelf[data-shelf="photos"]')).toBeVisible();
    // Nothing that adds to it, and no Shrink: there is no board beside it.
    await expect(page.locator('.fp-add')).toHaveCount(0);
    await expect(page.locator('.fp-shrink')).toHaveCount(0);
    // The sheet wears the sidebar's materials, on the board's ground, 8px
    // under the link's bar as from the window's sides.
    const look = await page.evaluate(() => {
      const sheet = getComputedStyle(document.querySelector('.list-wrap[data-look="sb"]'));
      const host = getComputedStyle(document.querySelector('.public-canvas-host'));
      return { outline: sheet.outlineColor, radius: sheet.borderTopLeftRadius, ground: host.backgroundImage.includes('radial-gradient') };
    });
    expect(look).toEqual({ outline: 'rgb(35, 35, 40)', radius: '12px', ground: true });
    const bar = await page.locator('.public-topbar').boundingBox();
    const sheet = await page.locator('.list-wrap').boundingBox();
    expect(Math.round(sheet.y - (bar.y + bar.height))).toBe(8);
    expect(Math.round(sheet.x)).toBe(8);
  });

  test('List is the classic table, and the menu is the page’s, dark on a light system too', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    await page.locator('.fp-tools .sbf-filter-btn').click();
    const menu = page.getByRole('menu', { name: 'Show and sort' });
    await expect(menu).toBeVisible();
    const m = await menu.evaluate((el) => ({ inPage: !!el.closest('.public-dark'), bg: getComputedStyle(el).backgroundColor }));
    expect(m).toEqual({ inPage: true, bg: 'rgb(28, 28, 32)' });
    await expect(menu.getByRole('menuitemradio', { name: /^Audio/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.list-wrap[data-look="sb"]')).toHaveCSS('outline-color', 'rgb(35, 35, 40)');
    await page.locator('.fp-seg').getByRole('radio', { name: 'List' }).click();
    await expect(page.locator('.ct-table.is-classic')).toBeVisible();
    await expect(page.locator('.ct-table.is-classic .ct-th').first()).toHaveCSS('color', 'rgb(116, 116, 124)');
  });

  test('a selection offers what a visitor can do, and Info is a card under the link’s bar', async ({ page }) => {
    await open(page);
    await page.locator('.list-wrap [data-item-id="card-img-1"]').click();
    const bar = page.locator('.fp-head > .list-selbar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.list-selbar-count')).toHaveText('1 selected');
    await expect(bar.getByRole('button', { name: 'Download' })).toBeVisible();
    for (const name of ['Delete', 'Move to…', 'Put on board', 'New cluster']) {
      await expect(bar.getByRole('button', { name })).toHaveCount(0);
    }
    await bar.getByRole('button', { name: 'Info' }).click();
    const card = page.locator('.list-wrap.has-info .cb-detail');
    await expect(card).toBeVisible();
    const top = await page.locator('.public-topbar').boundingBox();
    const box = await card.boundingBox();
    const sheet = await page.locator('.list-wrap').boundingBox();
    const vw = page.viewportSize().width;
    expect(Math.round(box.y)).toBe(Math.round(top.y + top.height + 8));
    expect(Math.round(vw - (box.x + box.width))).toBe(8);
    expect(Math.round(box.x - (sheet.x + sheet.width))).toBe(8);
  });

  test('a sub-cluster opens from its tile, on the link’s own trail', async ({ page }) => {
    await open(page);
    // A click picks it, as a file; opening is the second click, as Finder's.
    await page.locator('.fp-cls .ft').first().dblclick();
    await expect(page.locator('.public-crumbs')).toBeVisible();
    await expect(page.locator('.public-crumb.here')).toHaveText('Inside Board');
  });
});
