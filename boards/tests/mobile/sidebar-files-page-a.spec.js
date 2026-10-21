// The full Files page in direction A (the files sidebar's card grown) on a
// phone, through the dev-only QA harness (?sidebarqa=1&surface=files, whose
// drawer starts closed there). The sheet is the screen between App's bars;
// the title ⌄ and Shrink as an icon on one line, the search and "All files ⌄"
// on the next; Grid | List move into that menu, the bottom bar's + adds
// files, and the pictures lie three or four across, as Photos shows them.
import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/?sidebarqa=1&surface=files');
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.list-wrap[data-look="sb"] .fp-titlebar')).toBeVisible();
}

test.describe('the full Files page on a phone', () => {
  test('the sheet is the screen; the title, the search and All files; Grid | List in the menu', async ({ page }) => {
    await open(page);
    const sheet = await page.locator('.list-wrap').boundingBox();
    expect(Math.round(sheet.x)).toBe(0);
    expect(Math.round(sheet.width)).toBe(page.viewportSize().width);
    await expect(page.locator('.fp-title-btn')).toBeVisible();
    // No line of counts, no Download all, no Grid | List and no Add files:
    // the bottom bar's + adds files on the page.
    await expect(page.locator('.fp-meta')).toHaveCount(0);
    await expect(page.locator('.fp-dl')).toHaveCount(0);
    await expect(page.locator('.fp-seg')).toHaveCount(0);
    await expect(page.locator('.fp-tools .fp-add')).toHaveCount(0);
    // Shrink is its icon alone, a finger's size.
    await expect(page.locator('.fp-shrink .fp-word-label')).toBeHidden();
    const shrink = await page.locator('.fp-shrink').boundingBox();
    expect(Math.min(shrink.width, shrink.height)).toBeGreaterThanOrEqual(40);
    // The search takes the line's room; All files follows it.
    const search = await page.locator('.fp-search').boundingBox();
    const menuBtn = await page.locator('.fp-tools .sbf-filter-btn').boundingBox();
    expect(search.width).toBeGreaterThan(sheet.width / 2);
    expect(menuBtn.x).toBeGreaterThan(search.x + search.width - 1);
    expect(menuBtn.x + menuBtn.width).toBeLessThanOrEqual(sheet.width);

    await page.locator('.fp-tools .sbf-filter-btn').tap();
    const layout = page.getByRole('group', { name: 'Layout' });
    await expect(layout.getByRole('menuitemradio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
    const list = layout.getByRole('menuitemradio', { name: 'List' });
    expect((await list.boundingBox()).height).toBeGreaterThanOrEqual(40);
    await list.tap();
    await expect(page.locator('.ct-table.is-classic')).toBeVisible();
    await expect(list).toHaveAttribute('aria-checked', 'true');
    // Size is Grid's: gone with it.
    await expect(page.getByRole('group', { name: 'Tile size' })).toHaveCount(0);
  });

  test('the clusters scroll sideways, the pictures lie three or four across, and carry no downloads', async ({ page }) => {
    test.skip(page.viewportSize().width > 640, 'a phone’s width');
    await open(page);
    const cls = await page.locator('.fp-cls').evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX, scrolls: el.scrollWidth > el.clientWidth,
      rows: new Set([...el.querySelectorAll('.ft')].map((t) => Math.round(t.getBoundingClientRect().top))).size,
    }));
    expect(cls).toEqual({ overflowX: 'auto', scrolls: true, rows: 1 });
    // The first row of photos.
    const row = await page.locator('.fp-shelf[data-shelf="photos"] + .ct-jg').evaluate((grid) => {
      const tiles = [...grid.querySelectorAll('.ct-tile')].map((t) => t.getBoundingClientRect());
      const top = Math.min(...tiles.map((r) => Math.round(r.top)));
      const first = tiles.filter((r) => Math.round(r.top) === top);
      return { n: first.length, h: Math.round(first[0].height) };
    });
    expect(row.n).toBeGreaterThanOrEqual(3);
    expect(row.n).toBeLessThanOrEqual(5);
    expect(row.h).toBeLessThanOrEqual(100);
    // Every picture would carry it: the selection's actions, Quick look and
    // Info download instead.
    const dl = await page.locator('.list-wrap .ct-tile-dl').evaluateAll((els) => ({
      n: els.length, shown: els.filter((el) => getComputedStyle(el).display !== 'none').length,
    }));
    expect(dl.n).toBeGreaterThan(0);
    expect(dl.shown).toBe(0);
  });
});
