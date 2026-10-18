// The sidebar that holds every file, driven through its dev-only QA harness
// (?sidebarqa=1: the real ClusterSidebar over fixture clusters, the open one
// live and the rest served by a fake of 0419's RPCs). What a person sees and
// does: covers and counts, shelves under the cluster they're in, Quick look,
// the finder, the chips, sorting, paging a long shelf in place, Recent and
// Starred, the meter, and the resize handle. The App.jsx wiring behind the
// hold is pinned by reading the source at the end.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');

async function open(page) {
  await page.goto('/?sidebarqa=1');
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.sbf-block').first()).toBeVisible();
}
const calls = (page, fn) => page.evaluate((f) => window.__sidebarQa.calls.filter((c) => c.fn === f), fn);
const row = (page, name) => page.locator('.sb-tree-row', { hasText: name }).first();

test.describe('sidebar files', () => {
  test('clusters show a cover and everything inside them; the one you are in unfolds into shelves', async ({ page }) => {
    await open(page);
    await expect(row(page, 'Feature film')).toHaveClass(/is-files/);
    await expect(row(page, 'Feature film').locator('.sbf-thumb')).toBeVisible();
    // 48 of its own, 43 in Locations, 17 in Casting.
    await expect(row(page, 'Feature film').locator('.sbf-count')).toHaveText('108');
    await expect(row(page, 'Studio').locator('.sbf-count')).toHaveText('295');

    const block = page.locator('.sbf-block').first();
    const shelves = await block.locator('.sbf-shelf-label').allTextContents();
    expect(shelves.map((s) => s.toLowerCase())).toEqual(['photos', 'video', 'audio', 'files', 'writing']);
    await expect(block.locator('.sbf-mosaic')).toHaveCount(2, { timeout: 5000 });
    await expect(block.locator('.sbf-more').first()).toHaveText('+20 more');
    await expect(block.locator('.sbf-fold')).toContainText('Links 4');
    await expect(block.locator('.sbf-fold')).toContainText('More 2');
    // A file stored off the board says so.
    await expect(block.locator('.sbf-file', { hasText: 'film-selects.zip' }).locator('.sbf-stored-dot')).toBeVisible();
  });

  test('a long shelf expands in place, and a closed cluster pages from the server', async ({ page }) => {
    await open(page);
    const block = page.locator('.sbf-block').first();
    await block.locator('.sbf-more').first().click();
    await expect(block.locator('.sbf-mosaic')).toHaveCount(6);   // 30 photos, 5 a line

    await row(page, 'Music video').locator('.sb-tree-chev').click();
    const mv = page.locator('.sbf-block').filter({ has: page.locator('[data-sb-item^="mv:"]') });
    await expect(mv.locator('.sbf-shelf-label').first()).toHaveText(/photos/i);
    const peek = await calls(page, 'sidebar_cluster_items');
    expect(peek.some((c) => c.params.p_board_id === 'mv' && c.params.p_shelf === null)).toBe(true);
    await expect(mv.locator('.sbf-more').first()).toHaveText('+110 more');
    await mv.locator('.sbf-more').first().click();             // expand the peek in place
    await mv.locator('.sbf-more').first().click();             // then fetch the next page
    await expect.poll(async () => (await calls(page, 'sidebar_cluster_items'))
      .some((c) => c.params.p_board_id === 'mv' && c.params.p_shelf === 'photos' && c.params.p_offset === 12)).toBe(true);
  });

  test('clicking a file opens Quick look, which steps through the whole shelf', async ({ page }) => {
    await open(page);
    await page.locator('.sbf-block .sbf-tile').nth(2).click();
    await expect(page.getByText(/3 of 30/)).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText(/4 of 30/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(/of 30/)).toHaveCount(0);
  });

  test('double-clicking a file goes to it: on its board, or in Files when it is stored off the board', async ({ page }) => {
    await open(page);
    await page.locator('.sbf-file', { hasText: 'film-take-1.mov' }).dblclick();
    await expect(page.getByTestId('sbqa-log')).toContainText('show film/film-vid-0');
    await page.locator('.sbf-file', { hasText: 'film-selects.zip' }).dblclick();
    await expect(page.getByTestId('sbqa-log')).toContainText('show film/film-file-0 stored');
  });

  test('the finder narrows the tree to what matches; Enter on nothing hands the words to the palette', async ({ page }) => {
    await open(page);
    await page.fill('.sbf-search input', 'permit');
    await expect(row(page, 'Locations')).toBeVisible();
    await expect(row(page, 'Music video')).toHaveCount(0);
    await expect(page.locator('.sbf-file', { hasText: 'loc-permit-1.pdf' })).toBeVisible();
    await expect(page.locator('.sbf-file', { hasText: 'film-permit-1.pdf' })).toBeVisible();
    await expect(page.locator('.sbf-section-head', { hasText: 'Recent' })).toHaveCount(0);

    await page.fill('.sbf-search input', 'zzz nothing');
    await expect.poll(async () => (await calls(page, 'search')).some((c) => c.params.query === 'zzz nothing')).toBe(true);
    await page.locator('.sbf-search input').press('Enter');
    await expect(page.getByTestId('sbqa-log')).toContainText('palette "zzz nothing"');
  });

  test('a chip shows one kind of thing, and hides clusters with none of it', async ({ page }) => {
    await open(page);
    await page.locator('.sbf-chip', { hasText: 'Audio' }).click();
    await expect(page.locator('.sbf-chip', { hasText: 'Audio' })).toHaveAttribute('aria-pressed', 'true');
    const labels = await page.locator('.sbf-block').first().locator('.sbf-shelf-label').allTextContents();
    expect(labels.map((s) => s.toLowerCase())).toEqual(['audio']);
    await expect(row(page, 'Moodboards')).toHaveCount(0);        // photos only, no audio
    await expect(row(page, 'Music video')).toBeVisible();        // 18 loops
    await page.locator('.sbf-chip', { hasText: 'Audio' }).click();
    await expect(row(page, 'Moodboards')).toBeVisible();
  });

  test('sorting asks the server for that order and remembers it', async ({ page }) => {
    await open(page);
    await row(page, 'Locations').locator('.sb-tree-chev').click();
    await page.locator('.sbf-sort-btn').click();
    await page.getByRole('menuitemradio', { name: 'Name' }).click();
    await expect.poll(async () => (await calls(page, 'sidebar_cluster_items'))
      .some((c) => c.params.p_board_id === 'loc' && c.params.p_sort === 'name')).toBe(true);
    await page.reload();
    await page.waitForSelector('[data-sidebarqa-ready]');
    await page.locator('.sbf-sort-btn').click();
    await expect(page.getByRole('menuitemradio', { name: 'Name' })).toHaveAttribute('aria-checked', 'true');
  });

  test('Starred and Recent sit above the clusters, Recent as one strip', async ({ page }) => {
    await open(page);
    await expect(page.locator('.sbf-star-cluster', { hasText: 'Moodboards' })).toBeVisible();
    await expect(page.locator('.sbf-file', { hasText: 'loc-still-001.jpg' })).toBeVisible();
    await expect(page.locator('.sbf-recent .sbf-tile').first()).toBeVisible();
    expect(await page.locator('.sbf-recent').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(60);
  });

  test('the free plan shows cards and storage, and Upload is right there', async ({ page }) => {
    await open(page);
    await expect(page.locator('.sbf-meter-row')).toHaveCount(2);
    await expect(page.locator('.sbf-meter')).toContainText('38 of 50');
    await expect(page.locator('.sbf-meter')).toContainText('1.2 GB of 5.0 GB');
    await expect(page.locator('.sbf-upload')).toBeVisible();
  });

  test('the sidebar resizes between 240 and 480, and double-click puts it back', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the handle is a desktop control');
    await open(page);
    const width = () => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.round(await width())).toBe(300);
    const h = page.locator('.sbf-resizer');
    const box = await h.boundingBox();
    await page.mouse.move(box.x + 3, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 3 + 400, box.y + 200, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => Math.round(await width())).toBe(480);
    await h.dblclick();
    await expect.poll(async () => Math.round(await width())).toBe(300);   // the reset eases back
  });

  test('↑/↓ walk clusters and files alike', async ({ page }) => {
    await open(page);
    await row(page, 'Casting').focus();
    await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-sb-item'));
    expect(focused).toMatch(/^film:film-img-/);
  });
});

test.describe('sidebar files wiring (App.jsx)', () => {
  test('the files sidebar is held, and the old sidebar is what everyone else gets', () => {
    const app = read('src/App.jsx');
    const host = read('src/lib/appHost.js');
    expect(app).toContain('const filesSidebar = sidebarFilesAllowed();');
    expect(app).toMatch(/\{filesSidebar \? \(\s*<ClusterSidebar/);
    expect(app).toContain('<div className="sb-list" ref={sidebarScrollRef}>');   // the held-off branch, intact
    expect(host).toMatch(/export function sidebarFilesAllowed\(\) \{\s*if \(onPreviewHost\(\)\) return true;\s*if \(!import\.meta\.env\.DEV\) return false;/);
  });
});

test.describe('sidebar files: keys and folding', () => {
  test('renaming a cluster keeps its keys: an arrow moves the caret, not the focus', async ({ page }) => {
    await open(page);
    await row(page, 'Moodboards').focus();
    await page.keyboard.press('F2');
    const input = page.locator('.sb-tree-rename-input');
    await expect(input).toBeFocused();
    await page.keyboard.type(' v2');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(/v2$/);
  });

  test('folding the cluster you are in stays folded when any cluster changes', async ({ page }) => {
    await open(page);
    const film = row(page, 'Feature film');
    await expect(film).toHaveAttribute('aria-expanded', 'true');
    await film.locator('.sb-tree-chev').click();
    await expect(film).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => window.__sidebarQa.bumpBoards());
    await page.waitForTimeout(150);
    await expect(film).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('sidebar files: organizing', () => {
  test('⌘-click builds a selection; the bar moves it, with Undo', async ({ page }) => {
    await open(page);
    const tiles = page.locator('.sbf-block').first().locator('.sbf-tile');
    await tiles.nth(0).click({ modifiers: ['ControlOrMeta'] });
    await tiles.nth(1).click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('.sbf-bulk')).toContainText('2 selected');
    await expect(tiles.nth(0)).toHaveClass(/is-selected/);
    await page.locator('.sbf-bulk-btn', { hasText: 'Move…' }).click();
    await expect.poll(async () => (await calls(page, 'moveFiles')).length).toBe(1);
    const [mv] = await calls(page, 'moveFiles');
    expect(mv.params).toMatchObject({ from: 'film', to: 'mood', mode: 'move' });
    expect(mv.params.cardIds).toHaveLength(2);
    await expect(page.getByTestId('sbqa-toast')).toContainText('Moved 2 files to Moodboards');
    await page.getByTestId('sbqa-toast').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await calls(page, 'moveFiles')).length).toBe(2);
    const undo = (await calls(page, 'moveFiles'))[1];
    expect(undo.params).toMatchObject({ from: 'mood', to: 'film', mode: 'move' });
    expect(undo.params.restore).toHaveLength(2);
    await expect(page.locator('.sbf-bulk')).toHaveCount(0);
  });

  test('⇧-click selects a run along the shelf; Escape lets go', async ({ page }) => {
    await open(page);
    const tiles = page.locator('.sbf-block').first().locator('.sbf-tile');
    await tiles.nth(1).click({ modifiers: ['ControlOrMeta'] });
    await tiles.nth(4).click({ modifiers: ['Shift'] });
    await expect(page.locator('.sbf-bulk')).toContainText('4 selected');
    await tiles.nth(4).press('Escape');
    await expect(page.locator('.sbf-bulk')).toHaveCount(0);
  });

  test('dragging a file onto another cluster moves it there; ⌥ would copy', async ({ page }) => {
    await open(page);
    // Both ends on screen: a drag that has to scroll the list loses its target.
    const tile = page.locator('.sbf-block').first().locator('.sbf-tile').first();
    await tile.dragTo(row(page, 'Moodboards'));
    await expect.poll(async () => (await calls(page, 'moveFiles')).length).toBe(1);
    const [mv] = await calls(page, 'moveFiles');
    expect(mv.params).toMatchObject({ from: 'film', to: 'mood', mode: 'move', cardIds: ['film-img-0'] });
  });

  test('deleting a selection from a closed cluster removes it through the route, and Undo puts it back', async ({ page }) => {
    await open(page);
    await row(page, 'Locations').locator('.sb-tree-chev').click();
    const loc = page.locator('.sbf-block').filter({ has: page.locator('[data-sb-item^="loc:"]') });
    await loc.locator('.sbf-tile').first().click({ modifiers: ['ControlOrMeta'] });
    await page.locator('.sbf-bulk-btn', { hasText: 'Delete' }).click();
    await expect.poll(async () => (await calls(page, 'removeCards')).length).toBe(1);
    await expect(page.getByTestId('sbqa-toast')).toContainText('Deleted 1 file from Locations');
    await page.getByTestId('sbqa-toast').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await calls(page, 'appendCards')).length).toBe(1);
  });

  test('a cluster taking an upload says so where its count was', async ({ page }) => {
    await open(page);
    await expect(row(page, 'Casting').locator('.sbf-status')).toHaveText('↑ 3');
  });
});

test.describe('sidebar files: menus', () => {
  test('a file’s menu stars it, and Star shows up on its row', async ({ page }) => {
    await open(page);
    const file = page.locator('.sbf-file', { hasText: 'film-take-2.mov' });
    await file.first().click({ button: 'right' });
    const menu = page.locator('.ctx-menu').last();
    for (const label of ['Quick look', 'Show on board', 'Star', 'Download', 'Move to…', 'Delete']) {
      await expect(menu.getByText(label, { exact: true })).toBeVisible();
    }
    await menu.getByText('Star', { exact: true }).click();
    await expect.poll(async () => (await calls(page, 'toggleStar'))
      .some((c) => c.params.boardId === 'film' && c.params.cardId === 'film-vid-1' && c.params.on)).toBe(true);
    // Now in Starred as well as on its shelf, marked in both places.
    await expect(file).toHaveCount(2);
    await expect(page.locator('.sbf-block .sbf-file', { hasText: 'film-take-2.mov' }).locator('.sbf-star-mark')).toBeVisible();
  });

  test('a cluster’s menu stars it, and sets how it opens for everyone', async ({ page }) => {
    await open(page);
    await row(page, 'Casting').click({ button: 'right' });
    const menu = page.locator('.ctx-menu').last();
    await expect(menu.getByText('Star', { exact: true })).toBeVisible();
    await menu.getByText('Always open in Files', { exact: true }).click();
    await expect(page.getByTestId('sbqa-log')).toContainText('opens-as cast list');
  });
});
