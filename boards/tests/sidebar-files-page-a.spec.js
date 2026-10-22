// The full Files page in direction A's look on the sidebar QA harness
// (?sidebarqa=1&surface=files; the harness gives the page A's look unless
// &look=today). Run: npx playwright test tests/sidebar-files-page-a.spec.js --project=desktop-chrome
import { test, expect } from '@playwright/test';

const page_ = (extra = '') => `/?sidebarqa=1&surface=files${extra}`;
async function open(page, extra = '') {
  await page.goto(page_(extra));
  await page.locator('[data-sidebarqa-ready]').waitFor();
  await page.locator('.list-wrap').first().waitFor();
}
async function drag(page, id, dx, dy, { steps = 8 } = {}) {
  const b = await page.locator(`[data-handle="${id}"]`).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
  await page.mouse.up();
}

test.describe('one Files at a time', () => {
  test('the sidebar card folds to its bar while the page is open, its meter kept', async ({ page }) => {
    await open(page);
    const card = page.locator('.sbf-card.is-files');
    await expect(card).toHaveClass(/is-page-fold/);
    const bar = page.locator('.sbf-files-bar.is-page');
    await expect(bar).toContainText('Files');
    await expect(bar).toContainText('full screen');
    await expect(bar).toContainText('Shrink');
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeHidden();
    await expect(page.locator('.sbf-meter')).toBeVisible();
    await expect(page.locator('.list-wrap')).toHaveAttribute('data-look', 'sb');
    await expect(page.locator('.app')).toHaveClass(/is-files-page/);
  });

  test('Shrink in the bar goes back to the board, the card open', async ({ page }) => {
    await open(page);
    await page.locator('.sbf-files-bar.is-page').click();
    await expect(page.locator('[data-sidebarqa-surface="board"]')).toBeVisible();
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeVisible();
    await expect(page.locator('.app')).not.toHaveClass(/is-files-page/);
  });

  test('Shrink opens the card even when it was hidden before', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('soleil.ui.sidebarLayout', JSON.stringify({ filesHidden: true })));
    await open(page);
    await page.locator('.sbf-files-bar.is-page').click();
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeVisible();
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('soleil.ui.sidebarLayout') || '{}'));
    expect(kept.filesHidden).toBe(false);
  });

  test('a handle dragged while the page is open never keeps the fold', async ({ page }) => {
    await open(page);
    await drag(page, 'treeRight', 30, 0);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('soleil.ui.sidebarLayout') || '{}'));
    expect(kept.filesHidden).not.toBe(true);
  });

  test('⌘\\ (Ctrl here) shrinks the page back into the sidebar', async ({ page }) => {
    await open(page);
    await page.locator('.list-wrap').click({ position: { x: 600, y: 600 } });
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('[data-sidebarqa-surface="board"]')).toBeVisible();
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeVisible();
  });

  test('&look=today keeps the page and the card as production has them', async ({ page }) => {
    await open(page, '&look=today');
    await expect(page.locator('.sbf-card.is-files')).not.toHaveClass(/is-folded/);
    await expect(page.locator('.list-wrap')).not.toHaveAttribute('data-look', /.+/);
    await expect(page.locator('.app')).not.toHaveClass(/is-files-page/);
  });
});

const sheet = (page) => page.locator('.list-wrap');

test.describe('the head', () => {
  test('the title is the cluster, and pressing it opens the cluster switch', async ({ page }) => {
    await open(page);
    const title = page.locator('.fp-title-btn');
    await expect(title).toContainText('Feature film');
    await expect(page.locator('.fp-meta')).toContainText('files');
    await title.click();
    const sw = page.locator('.sbf-switch');
    await expect(sw).toBeVisible();
    await sw.getByText('Locations', { exact: true }).click();
    await expect(page.locator('.fp-title-btn')).toContainText('Locations');
  });

  test('Shrink is a word at the right and goes back to the board', async ({ page }) => {
    await open(page);
    const shrink = sheet(page).getByRole('button', { name: 'Shrink back to the sidebar' });
    await expect(shrink).toContainText('Shrink');
    await shrink.click();
    await expect(page.locator('[data-sidebarqa-surface="board"]')).toBeVisible();
  });

  test('the card controls: search, All files with Show/Sort/Size, Grid | List, Add files', async ({ page }) => {
    await open(page);
    const search = page.locator('.fp-search input');
    await expect(search).toHaveAttribute('placeholder', 'Search Feature film');
    await search.fill('still-01');
    await expect(page.locator('.fp-found')).toContainText(/of \d+/);
    await search.fill('');
    await page.locator('.fp-tools .sbf-filter-btn').click();
    const menu = page.getByRole('menu', { name: 'Show and sort' });
    await expect(menu.locator('.sbf-menu-label')).toHaveText(['Show', 'Sort']);
    await expect(menu.getByRole('menuitemradio', { name: 'Large' })).toBeVisible();
    await menu.getByRole('menuitemradio', { name: /^Photos/ }).click();
    await expect(page.locator('.fp-tools .sbf-filter-btn')).toContainText('Photos');
    await expect(page.locator('.fp-tools .sbf-filter-btn')).toHaveClass(/is-on/);
    await page.locator('.fp-tools').getByRole('radio', { name: 'List' }).click();
    await expect(sheet(page).locator('.ct-table')).toBeVisible();
    await expect(page.locator('.fp-add')).toContainText('Add files');
  });

  test('a sample pack is read beside the search, and narrowing re-reads it', async ({ page }) => {
    await open(page);
    await page.locator('.fp-tools .sbf-filter-btn').click();
    await page.getByRole('menu', { name: 'Show and sort' }).getByRole('menuitemradio', { name: /^Audio/ }).click();
    // Showing only Audio narrows the page, and the line reads the pack rather
    // than counting what's left.
    const found = page.locator('.fp-found');
    await expect(found).toHaveClass(/is-pack/);
    await expect(found).toContainText('2 audio files · 90–91 BPM');
    await page.locator('.fp-search input').fill('loop-2');
    await expect(found).toContainText('1 audio file · 91 BPM');
  });

  test('a selection turns the controls into what to do with it, Delete with an undo', async ({ page }) => {
    await open(page);
    await sheet(page).locator('[data-item-id="film-img-3"]').click();
    await sheet(page).locator('[data-item-id="film-img-5"]').click({ modifiers: ['ControlOrMeta'] });
    const bar = page.locator('.fp-head > .list-selbar');
    await expect(bar).toBeVisible();
    await expect(page.locator('.fp-tools')).toHaveCount(0);
    await expect(bar.locator('.list-selbar-count')).toHaveText('2 selected');
    const del = bar.getByRole('button', { name: 'Delete' });
    await expect(del).toHaveClass(/is-danger/);
    await del.click();
    // Production's own confirm, then its undo toast.
    await page.getByRole('dialog', { name: 'Delete selection' }).getByRole('button', { name: 'Delete' }).click();
    await expect(sheet(page).locator('[data-item-id="film-img-3"]')).toHaveCount(0);
    await page.locator('.toast', { hasText: '2 cards deleted' }).getByRole('button', { name: 'Undo' }).click();
    await expect(sheet(page).locator('[data-item-id="film-img-3"]')).toHaveCount(1);
  });

  test('files dragged over the page: the line says what a drop does', async ({ page }) => {
    await open(page);
    const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['x'], 'a.jpg', { type: 'image/jpeg' })); return d; });
    await sheet(page).dispatchEvent('dragenter', { dataTransfer: dt });
    await sheet(page).dispatchEvent('dragover', { dataTransfer: dt });
    await expect(page.locator('.fp-drop')).toContainText('Drop to add to Feature film');
    await expect(sheet(page)).toHaveClass(/is-drop-target/);
  });
});

test.describe('Grid: the shelves', () => {
  test('clusters first, then the shelves in the card order; minor shelves closed until opened', async ({ page }) => {
    await open(page);
    const heads = sheet(page).locator('.fp-shelf');
    await expect(heads.first()).toContainText('Clusters');
    await expect(sheet(page).locator('.fp-cls .ft')).toHaveCount(3);
    const order = await heads.evaluateAll((els) => els.map((e) => e.getAttribute('data-shelf')));
    expect(order).toEqual(['clusters', 'photos', 'video', 'audio', 'files', 'writing', 'links', 'more']);
    await expect(sheet(page).locator('.fp-shelf[data-shelf="writing"]')).toHaveClass(/is-closed/);
    await expect(sheet(page).locator('[data-item-id="film-note-0"]')).toHaveCount(0);
    await sheet(page).locator('.fp-shelf[data-shelf="writing"] .sbf-shelf-toggle').click();
    await expect(sheet(page).locator('[data-item-id="film-note-0"]')).toHaveCount(1);
  });

  test('photos and video are captionless justified tiles; the rest are rows', async ({ page }) => {
    await open(page);
    await expect(sheet(page).locator('[data-item-id="film-img-3"]')).toHaveClass(/is-captionless/);
    await expect(sheet(page).locator('[data-item-id="film-img-3"] .ct-tile-meta')).toHaveCount(0);
    await expect(sheet(page).locator('[data-item-id="film-aud-0"]')).toHaveClass(/ct-row/);
  });

  test('the arrows walk from the last photo into the video shelf', async ({ page }) => {
    await open(page);
    const ids = await sheet(page).locator('.fp-shelf[data-shelf="photos"] + .ct-jg [data-item-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')));
    await sheet(page).locator(`[data-item-id="${ids[ids.length - 1]}"]`).click();
    await page.keyboard.press('ArrowRight');
    const active = await sheet(page).locator('.ct-tile.is-active, .ct-row.is-active').first().getAttribute('data-item-id');
    const video = await sheet(page).locator('.fp-shelf[data-shelf="video"] + .ct-jg [data-item-id]').first().getAttribute('data-item-id');
    expect(active).toBe(video);
  });

  test('a search shows every shelf with a hit, minor ones open', async ({ page }) => {
    await open(page);
    await page.locator('.fp-search input').fill('Call sheet');
    await expect(sheet(page).locator('[data-item-id="film-note-0"]')).toHaveCount(1);
    await expect(sheet(page).locator('.fp-shelf[data-shelf="writing"]')).not.toHaveClass(/is-closed/);
  });
});

test.describe('List: the classic table', () => {
  test('clusters first, then every file, newest first, sortable heads', async ({ page }) => {
    await open(page);
    await page.locator('.fp-tools').getByRole('radio', { name: 'List' }).click();
    const table = sheet(page).locator('.ct-table.is-classic');
    await expect(table.locator('.ct-head button.ct-th')).toHaveText([/Name/, /Kind/, /Size/, /Added/]);
    const rows = table.locator('.ct-row');
    await expect(rows.nth(0)).toHaveClass(/ct-folder-row/);
    await expect(rows.nth(0)).toContainText('Locations');
    await expect(rows.nth(0)).toContainText('Cluster');
    await expect(rows.nth(2)).toContainText('Linked cluster');
    await expect(rows.nth(3)).not.toHaveClass(/ct-folder-row/);
    await expect(table.locator('.ct-row.is-zebra').first()).toBeVisible();
    await expect(table.locator('[data-item-id="film-img-2"]')).toContainText('has it selected');
    await expect(table.locator('[data-item-id="film-wait-0"]')).toContainText('Not on board');
    await expect(table.locator('[data-item-id="film-img-2"]')).toContainText('Image · JPG');
    await table.locator('.ct-head button.ct-th', { hasText: 'Name' }).click();
    await expect(page.locator('.fp-tools .sbf-filter-btn')).toHaveAttribute('title', /sorted by name/);
  });

  test('a cluster row opens it; a file row selects', async ({ page }) => {
    await open(page);
    await page.locator('.fp-tools').getByRole('radio', { name: 'List' }).click();
    const table = sheet(page).locator('.ct-table.is-classic');
    await table.locator('[data-item-id="film-img-3"]').click();
    await expect(table.locator('[data-item-id="film-img-3"]')).toHaveClass(/is-selected/);
    await table.locator('.ct-folder-row', { hasText: 'Locations' }).dblclick();
    await expect(page.locator('.fp-title-btn')).toContainText('Locations');
  });
});

test.describe('Grid: the tiles', () => {
  test('marks on the picture: not on board, a video length, an upload, a peer', async ({ page }) => {
    await open(page);
    await expect(sheet(page).locator('[data-item-id="film-wait-0"] .ct-tile-off')).toHaveAttribute('aria-label', 'Not on board');
    await expect(sheet(page).locator('[data-item-id="film-img-3"] .ct-tile-off')).toHaveCount(0);
    await expect(sheet(page).locator('[data-item-id="film-vid-0"] .ct-tile-dur')).toHaveText('0:42');
    await expect(sheet(page).locator('[data-item-id="film-up-0"] .ct-tile-pend')).toHaveText('Uploading…');
    await expect(sheet(page).locator('[data-item-id="film-img-2"]')).toHaveClass(/is-peer/);
    await expect(sheet(page).locator('[data-item-id="film-img-3"]')).toHaveAttribute('title', /film-still-004/);
  });

  test('a selected tile: a gold ring outside the picture and a white check', async ({ page }) => {
    await open(page);
    const tile = sheet(page).locator('[data-item-id="film-img-3"]');
    await tile.click();
    await expect(tile).toHaveClass(/is-selected/);
    const ring = await tile.locator('.ct-tile-preview').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(ring).toBe('solid');
    // The check eases into white (production's transition): read it settled.
    await expect.poll(() => tile.locator('.ct-tile-check').evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(255, 255, 255)');
  });

  test('F2 renames in place over the picture', async ({ page }) => {
    await open(page);
    const tile = sheet(page).locator('[data-item-id="film-img-3"]');
    await tile.click();
    await page.keyboard.press('F2');
    await expect(tile).toHaveClass(/is-renaming/);
    await expect(tile.locator('.ct-tile-rename')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tile).not.toHaveClass(/is-renaming/);
  });
});

test.describe('Info and the states', () => {
  test('Info is a card beside the sheet, which makes room for it', async ({ page }) => {
    await open(page);
    const before = await sheet(page).boundingBox();
    await sheet(page).locator('[data-item-id="film-img-3"]').click();
    await page.keyboard.press('ControlOrMeta+i');
    const card = sheet(page).locator('.cb-detail');
    await expect(card).toBeVisible();
    await expect(card.locator('.cbd-title')).toContainText('film-still-004');
    const after = await sheet(page).boundingBox();
    const box = await card.boundingBox();
    const vw = page.viewportSize().width;
    expect(Math.round(vw - (box.x + box.width))).toBe(8);
    expect(Math.round(box.width)).toBe(340);
    expect(Math.round(box.x - (after.x + after.width))).toBe(8);
    expect(Math.round(box.y)).toBe(Math.round(after.y));
    expect(after.width).toBeLessThan(before.width);
    await sheet(page).evaluate((el) => el.scrollBy(0, 600));
    const moved = await card.boundingBox();
    expect(Math.round(moved.y)).toBe(Math.round(box.y));
  });

  test('a cluster with no files: its clusters, then what to do, in the middle of the sheet', async ({ page }) => {
    await open(page, '&empty=1');
    await expect(page.locator('.fp-tools')).toHaveCount(0);
    await expect(page.locator('.fp-meta')).toHaveText('No files · 2 clusters');
    await expect(page.locator('.fp-empty-title')).toHaveText('No files in Feature film');
    await expect(page.locator('.fp-empty .fp-add')).toContainText('Add files');
    await expect(sheet(page).locator('.fp-cls .ft')).toHaveCount(2);
    await expect(page.locator('.list-empty')).toHaveCount(0);
    // The block takes the rest of the sheet, so it sits in the middle of it.
    const s = await sheet(page).boundingBox();
    const e = await page.locator('.fp-empty').boundingBox();
    expect(e.y + e.height).toBeGreaterThan(s.y + s.height - 60);
    expect(await sheet(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  });

  test('a search with no hits says so and clears', async ({ page }) => {
    await open(page);
    await page.locator('.fp-search input').fill('zzzz-nothing');
    await expect(page.locator('.fp-nomatch')).toContainText('No files match.');
    await page.locator('.fp-nomatch').getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('.fp-search input')).toHaveValue('');
    await expect(sheet(page).locator('[data-item-id="film-img-3"]')).toHaveCount(1);
  });
});

test.describe('Quick look', () => {
  test('Space opens it over a blurred page; the title and the actions are islands', async ({ page }) => {
    await open(page);
    await sheet(page).locator('[data-item-id="film-img-4"]').click();
    await page.keyboard.press('Space');
    const ql = page.locator('.ql[data-look="sb"]');
    await expect(ql).toBeVisible();
    await expect(ql.locator('.ql-title .ql-name')).toContainText('film-still-005');
    const acts = ql.locator('.ql-acts');
    await expect(acts.locator('.ql-btn')).toContainText(['Show on board', 'Download', 'Info']);
    await expect(acts.locator('.ql-x')).toBeVisible();
    const blur = await ql.evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(blur).toContain('blur');
    await page.keyboard.press('ArrowRight');
    await expect(ql.locator('.ql-name')).not.toContainText('film-still-005');
    await page.keyboard.press('Escape');
    await expect(ql).toHaveCount(0);
  });
});
