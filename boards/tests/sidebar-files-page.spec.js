// The full Files page (the sidebar's ⤢) beside the files sidebar, driven
// through its dev-only QA harness (?sidebarqa=1&surface=files): the real
// FilesDockLayout → FilesPane → ListSurface in App's chain of elements, so a
// rule that walks the chain is tested against what it walks in the app.
import { expect, test } from '@playwright/test';

async function open(page, q = '') {
  await page.goto(`/?sidebarqa=1${q}`);
  await page.waitForSelector('[data-sidebarqa-ready]');
}
const surface = (page) => page.locator('[data-sidebarqa-surface]');
const filesPage = (page) => page.locator('.list-wrap');
const filesCount = (page) => page.locator('.list-section-files .list-section-count');
const tile = (page, id) => filesPage(page).locator(`.ct-tile[data-item-id="${id}"]`);

test.describe('the full Files page', () => {
  test('it is mounted where App mounts it: the main pane, a surface that is not a canvas, Files in full', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await open(page, '&surface=files');
    await expect(page.locator('.app.sb-files.is-floating-chrome > main.main > .split-wrap > .split-pane > .surface-wrap:not(.is-canvas):not(.is-split) > .surface-eb-root > .fdl.fdl-full > .fdl-files .list-wrap')).toBeVisible();
    await expect(filesPage(page).locator('.cb-pagehead-title')).toHaveText('Feature film');
    await expect(filesPage(page).getByRole('button', { name: 'Shrink back to the sidebar' })).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('⤢ opens it, a shelf’s ⤢ opens it narrowed to that shelf, and ⤡ goes back to the board', async ({ page }) => {
    await open(page, '&rich=1');
    await expect(surface(page)).toHaveAttribute('data-sidebarqa-surface', 'board');

    await page.getByRole('button', { name: 'Open in the full Files page' }).click();
    await expect(surface(page)).toHaveAttribute('data-sidebarqa-surface', 'files');
    await expect(filesPage(page).locator('.cb-pagehead-title')).toHaveText('Feature film');
    const all = (await filesCount(page).textContent()).trim();
    expect(all).toMatch(/^\d+$/);

    await page.getByRole('button', { name: 'Shrink back to the sidebar' }).click();
    await expect(surface(page)).toHaveAttribute('data-sidebarqa-surface', 'board');

    // The Video shelf: only its kinds, counted against everything.
    const shelf = page.locator('.sbf-shelf', { hasText: /^video/i });
    await shelf.hover();
    await shelf.getByRole('button', { name: /^Open video in Files$/i }).click();
    await expect(surface(page)).toHaveAttribute('data-sidebarqa-surface', 'files');
    await expect(filesCount(page)).toHaveText(new RegExp(`^\\d+ of ${all}$`));
    await expect(tile(page, 'film-wait-vid')).toBeVisible();
    await expect(tile(page, 'film-wait-0')).toHaveCount(0);

    // ⤡, then the header's ⤢ again: the whole cluster, no shelf left over.
    await page.getByRole('button', { name: 'Shrink back to the sidebar' }).click();
    await page.getByRole('button', { name: 'Open in the full Files page' }).click();
    await expect(filesCount(page)).toHaveText(all);
  });

  test('every kind of row draws: folders, a linked cluster, a grid family, an upload, files off the board, peers', async ({ page }) => {
    await open(page, '&surface=files');
    const p = filesPage(page);
    // Sub-clusters as folders, someone's face on the one they're in.
    const folders = p.locator('.ft-grid.is-full .ft:not(.is-linked)');
    await expect(folders.locator('.ft-name')).toHaveText(['Locations', 'Casting']);
    await expect(p.locator('.ft', { hasText: 'Casting' }).locator('.ft-peers .avatar, .ft-peers > *')).toHaveCount(1);
    // A linked cluster under its own heading.
    await expect(p.locator('.ft.is-linked .ft-name')).toHaveText('Music video');
    await expect(p.locator('.ft.is-linked .ft-link')).toBeVisible();
    // Three grids on one template fold into one tile with a count.
    const family = p.locator('.ct-group-tile');
    await expect(family).toHaveCount(1);
    await expect(family.locator('.ct-tile-name')).toHaveText('Shot grid');
    await expect(family.locator('.ct-group-badge')).toHaveText('3');
    // A file still uploading.
    await expect(tile(page, 'film-up-0')).toHaveClass(/is-pending/);
    await expect(tile(page, 'film-up-0').locator('.ct-tile-type')).toHaveText('Uploading…');
    // Files in the cluster but off its board carry the mark, a namesake on the board doesn't.
    for (const id of ['film-wait-0', 'film-wait-1', 'film-wait-vid']) {
      await expect(tile(page, id).locator('.ct-tile-flag.is-off')).toHaveCount(1);
    }
    const namesakes = p.locator('.ct-tile').filter({ has: page.locator('.ct-tile-name[title^="film-still-001"]') });
    await expect(namesakes).toHaveCount(2);
    await expect(namesakes.locator('.ct-tile-flag.is-off')).toHaveCount(1);
    // A peer's selection shows on the file; the page's facepile shows who's here.
    await expect(tile(page, 'film-img-2')).toHaveClass(/is-peer/);
    await expect(tile(page, 'film-img-2').locator('.ct-tile-peers')).toBeVisible();
    await expect(p.locator('.cbt-facepile')).toBeVisible();
  });

  test('a delete on the page leaves the sidebar too, and Undo brings it back to both', async ({ page }) => {
    await open(page, '&surface=files');
    const sidebarRow = page.locator('.sbf-files [data-sb-item="film:film-wait-0"]');
    await expect(sidebarRow).toHaveCount(1);
    await tile(page, 'film-wait-0').click();
    await page.locator('.list-selbar').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(tile(page, 'film-wait-0')).toHaveCount(0);
    await expect(sidebarRow).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).last().click();
    await expect(tile(page, 'film-wait-0')).toHaveCount(1);
    await expect(sidebarRow).toHaveCount(1);
  });

  test('in the split pane, the band the islands float in is painted as the Files floor below it', async ({ page }) => {
    await open(page, '&surface=files&pane=split');
    const wrap = page.locator('.split-pane .surface-wrap.is-split');
    const list = wrap.locator('.list-wrap');
    await expect(list).toBeVisible();
    const band = await wrap.evaluate((el) => getComputedStyle(el).backgroundColor);
    const floor = await list.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(band).toBe(floor);
    // The band is still there: the page starts below the islands.
    expect(await list.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(50);
  });

  test('Info’s drawer hangs 8px under the islands and stops 8px above the bottom', async ({ page }) => {
    await open(page);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('soleil-open-info', { detail: { boardId: 'film', cardIds: ['film-img-1'] } })));
    const drawer = page.locator('.cb-detail.is-drawer');
    await expect(drawer).toBeVisible();
    const islandBottom = await page.locator('.chrome-island').first().evaluate((el) => el.getBoundingClientRect().bottom);
    const box = await drawer.boundingBox();
    expect(Math.round(box.y - islandBottom)).toBe(8);
    expect(Math.round(page.viewportSize().height - (box.y + box.height))).toBeGreaterThanOrEqual(8);
  });

  test('a cluster with no files says so under its sub-clusters', async ({ page }) => {
    await open(page, '&surface=files&empty=1');
    await expect(filesPage(page).locator('.ft-grid.is-full .ft-name')).toHaveText(['Locations', 'Casting']);
    await expect(filesPage(page).locator('.list-empty-title')).toHaveText('No files in Feature film');
  });
});
