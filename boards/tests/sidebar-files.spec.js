// The sidebar that holds every file, driven through its dev-only QA harness
// (?sidebarqa=1: the real ClusterSidebar over fixture clusters, the open one
// live and the rest served by a fake of 0419's RPCs). What a person sees and
// does: a tree of clusters with covers and counts, and below it (or beside it,
// wide) the files of the cluster they're in — Quick look, the search, the
// chips, sorting, paging a long shelf in place, Recent and Starred — plus the
// meter, the resize handle and the divider. The App.jsx wiring behind the
// hold is pinned by reading the source.
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
const files = (page) => page.locator('.sbf-files');
const nav = (page) => page.locator('.sbf-nav');

test.describe('sidebar files', () => {
  test('the tree is clusters only; the files of the cluster you are in fill the section below it', async ({ page }) => {
    await open(page);
    await expect(row(page, 'Feature film')).toHaveClass(/is-files/);
    await expect(row(page, 'Feature film').locator('.sbf-thumb')).toBeVisible();
    // 48 of its own, 43 in Locations, 17 in Casting.
    await expect(row(page, 'Feature film').locator('.sbf-count')).toHaveText('108');
    await expect(row(page, 'Studio').locator('.sbf-count')).toHaveText('295');
    await expect(nav(page).locator('.sbf-file, .sbf-tile')).toHaveCount(0);

    const f = files(page);
    await expect(f.locator('.sbf-files-name')).toHaveText('Feature film');
    await expect(f.locator('.sbf-files-sub')).toHaveText('48 files · 2 clusters · in Studio');
    await expect(f.locator('.sbf-sub-name')).toHaveText(['Casting', 'Locations']);
    expect(await f.locator('.sbf-shelf-label').allTextContents())
      .toEqual(['Photos', 'Video', 'Audio', 'Files', 'Writing', 'Links', 'More']);
    await expect(f.locator('.sbf-mosaic')).toHaveCount(2);
    await expect(f.locator('.sbf-more-btn').first()).toHaveText(/^Show \d+ more$/);
    // A file stored off the board says so.
    await expect(f.locator('.sbf-file', { hasText: 'film-selects.zip' }).locator('.sbf-stored-dot')).toBeVisible();
  });

  test('opening another cluster shows its files; Recent and Starred show theirs, and the cluster comes back', async ({ page }) => {
    await open(page);
    const f = files(page);
    await row(page, 'Locations').click();
    await expect(f.locator('.sbf-files-name')).toHaveText('Locations');
    await expect(f.locator('.sbf-files-sub')).toHaveText('43 files · in Feature film');

    await page.locator('.sbf-quickbtn', { hasText: 'Recent' }).click();
    await expect(f.locator('.sbf-files-name')).toHaveText('Recent');
    await expect(f.locator('[data-sb-item]').first()).toBeVisible();

    await page.locator('.sbf-quickbtn', { hasText: 'Starred' }).click();
    await expect(f.locator('.sbf-files-name')).toHaveText('Starred');
    await expect(f.locator('.sbf-sub', { hasText: 'Moodboards' })).toBeVisible();      // a starred cluster
    await expect(f.locator('[data-sb-item="loc:loc-img-0"]')).toBeVisible();          // a starred file

    await f.getByRole('button', { name: 'Back to the cluster’s files' }).click();
    await expect(f.locator('.sbf-files-name')).toHaveText('Locations');
  });

  test('Home, Messages, Schedule, Recent and Starred sit in one row of words', async ({ page }) => {
    await open(page);
    const btns = page.locator('.sbf-quick .sbf-quickbtn');
    await expect(btns).toHaveText(['Home', /^Messages2?$/, 'Schedule', 'Recent', 'Starred']);
    await expect(page.locator('.sbf-quick svg')).toHaveCount(0);                 // words, no icons
    const tops = () => btns.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(await tops()).size).toBe(1);
    await expect(btns.nth(1).locator('.sbf-quick-badge')).toHaveText('2');
    // Too narrow for five: three over two, never one word alone, none cut.
    await page.evaluate(() => window.__sidebarQa.setWidth(240));
    await expect.poll(async () => new Set(await tops()).size).toBe(2);
    const [a, b, c, d, e] = await tops();
    expect([a === b && b === c, d === e, d > a]).toEqual([true, true, true]);
    const cut = await btns.evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
    expect(cut).toBe(0);
    await page.evaluate(() => window.__sidebarQa.setWidth(320));
    await expect.poll(async () => new Set(await tops()).size).toBe(1);
    await btns.nth(0).click();
    await expect(page.getByTestId('sbqa-log')).toContainText('home');
    await btns.nth(3).click();
    await expect(btns.nth(3)).toHaveAttribute('aria-pressed', 'true');
    await expect(files(page).locator('.sbf-files-name')).toHaveText('Recent');
  });

  test('a long shelf expands in place, and a cluster read from the server pages', async ({ page }) => {
    await open(page);
    const f = files(page);
    const perLine = await f.locator('.sbf-mosaic').first().locator('.sbf-tile').count();
    await f.locator('.sbf-more-btn').first().click();
    await expect(f.locator('.sbf-mosaic')).toHaveCount(Math.ceil(30 / perLine));
    await f.locator('.sbf-more-btn', { hasText: 'Show less' }).click();
    await expect(f.locator('.sbf-mosaic')).toHaveCount(2);

    // A cluster whose doc isn't open is read from the server: a peek, then pages.
    await page.evaluate(() => { window.__sidebarQa.setLive(false); window.__sidebarQa.setActive('mv'); });
    await expect(f.locator('.sbf-files-name')).toHaveText('Music video');
    await expect.poll(async () => (await calls(page, 'sidebar_cluster_items'))
      .some((c) => c.params.p_board_id === 'mv' && c.params.p_shelf === null)).toBe(true);
    await expect(f.locator('.sbf-more-btn').first()).toHaveText(`Show ${120 - 2 * perLine} more`);
    await f.locator('.sbf-more-btn').first().click();         // expand the peek in place
    await f.locator('.sbf-more-btn').first().click();         // then fetch the next page
    await expect.poll(async () => (await calls(page, 'sidebar_cluster_items'))
      .some((c) => c.params.p_board_id === 'mv' && c.params.p_shelf === 'photos' && c.params.p_offset === 12)).toBe(true);
  });

  test('clicking a file opens Quick look, which steps through the whole shelf', async ({ page }) => {
    await open(page);
    await files(page).locator('.sbf-tile').nth(2).click();
    await expect(page.getByText(/3 of 30/)).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText(/4 of 30/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(/of 30/)).toHaveCount(0);
  });

  test('double-clicking a file goes to it: on its board, or in Files when it is stored off the board', async ({ page }) => {
    await open(page);
    await files(page).locator('.sbf-file', { hasText: 'film-take-1.mov' }).dblclick();
    await expect(page.getByTestId('sbqa-log')).toContainText('show film/film-vid-0');
    await files(page).locator('.sbf-file', { hasText: 'film-selects.zip' }).dblclick();
    await expect(page.getByTestId('sbqa-log')).toContainText('show film/film-file-0 stored');
  });

  test('the search narrows the files to what matches; Enter on nothing searches everywhere', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__sidebarQa.setActive('loc'));
    const f = files(page);
    await f.locator('.sbf-search input').fill('permit');
    await expect(f.locator('.sbf-file', { hasText: 'loc-permit-1.pdf' })).toBeVisible();
    await expect(f.locator('.sbf-tile')).toHaveCount(0);
    await f.locator('.sbf-search input').fill('zzz nothing');
    await expect(f.locator('.sbf-files-empty')).toContainText('Nothing in Locations matches');
    await f.locator('.sbf-search input').press('Enter');
    await expect(page.getByTestId('sbqa-log')).toContainText('palette "zzz nothing"');
  });

  test('a chip narrows the files to one kind; what does not fit its line is behind More', async ({ page }) => {
    await open(page);
    const f = files(page);
    await f.locator('.sbf-chip', { hasText: 'Photos' }).click();
    await expect(f.locator('.sbf-shelf-label')).toHaveText(['Photos']);
    await f.locator('.sbf-chip', { hasText: 'Photos' }).click();
    // Feature film holds every kind: still one line of chips.
    expect(await f.locator('.sbf-chips').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(26);
    await f.locator('.sbf-chipmore .sbf-chip').click();
    await f.getByRole('menuitemradio', { name: /Audio/ }).click();
    await expect(f.locator('.sbf-shelf-label')).toHaveText(['Audio']);
    await expect(f.locator('.sbf-chipmore .sbf-chip')).toHaveClass(/is-on/);
  });

  test('sorting asks the server for that order and remembers it', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__sidebarQa.setLive(false); window.__sidebarQa.setActive('loc'); });
    await files(page).locator('.sbf-sort-btn').click();
    await page.getByRole('menuitemradio', { name: 'Name' }).click();
    await expect.poll(async () => (await calls(page, 'sidebar_cluster_items'))
      .some((c) => c.params.p_board_id === 'loc' && c.params.p_sort === 'name')).toBe(true);
    await page.reload();
    await page.waitForSelector('[data-sidebarqa-ready]');
    await files(page).locator('.sbf-sort-btn').click();
    await expect(page.getByRole('menuitemradio', { name: 'Name' })).toHaveAttribute('aria-checked', 'true');
  });

  test('the free plan shows cards and storage, and Upload is right there', async ({ page }) => {
    await open(page);
    await expect(page.locator('.sbf-meter-row')).toHaveCount(2);
    await expect(page.locator('.sbf-meter')).toContainText('38 of 50');
    await expect(page.locator('.sbf-meter')).toContainText('1.2 GB of 5.0 GB');
    await expect(page.locator('.sbf-upload')).toBeVisible();
  });

  test('the sidebar resizes between 240 and 760, and double-click puts it back', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the handle is a desktop control');
    await open(page);
    const width = () => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.round(await width())).toBe(320);
    const h = page.locator('.sbf-resizer');
    const box = await h.boundingBox();
    await page.mouse.move(box.x + 3, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 3 + 600, box.y + 200, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => Math.round(await width())).toBe(760);
    await expect(page.locator('.sidebar')).toHaveClass(/is-wide/);
    await h.dblclick();
    await expect.poll(async () => Math.round(await width())).toBe(320);   // the reset eases back
  });

  test('narrow, the files sit under the clusters; wide, beside them; the button switches', async ({ page }) => {
    await open(page);
    const n = await nav(page).boundingBox();
    const f = await files(page).boundingBox();
    expect(f.y).toBeGreaterThanOrEqual(n.y + n.height - 1);
    await files(page).getByRole('button', { name: 'Show files beside the clusters' }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/is-wide/);
    await expect.poll(async () => {
      const [n2, f2] = [await nav(page).boundingBox(), await files(page).boundingBox()];
      return f2.x >= n2.x + n2.width - 1 && f2.y < n2.y;
    }).toBe(true);
    await files(page).getByRole('button', { name: 'Show files under the clusters' }).click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/is-wide/);
    await expect.poll(async () => Math.round(await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width))).toBe(320);
  });

  test('the divider shares the height between clusters and files', async ({ page }) => {
    await open(page);
    const before = Math.round((await nav(page).boundingBox()).height);
    const d = await page.locator('.sbf-divider').boundingBox();
    await page.mouse.move(d.x + d.width / 2, d.y + 4);
    await page.mouse.down();
    await page.mouse.move(d.x + d.width / 2, d.y - 120, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await nav(page).boundingBox()).height)).toBeLessThan(before - 80);
    await page.locator('.sbf-divider').dblclick();
    await expect.poll(async () => Math.round((await nav(page).boundingBox()).height)).toBe(before);
  });

  test('↑/↓ walk the rows of whichever part has focus', async ({ page }) => {
    await open(page);
    await files(page).locator('.sbf-file', { hasText: 'film-take-1.mov' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(files(page).locator('.sbf-file', { hasText: 'film-take-2.mov' })).toBeFocused();
    await row(page, 'Moodboards').focus();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'Music video')).toBeFocused();
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

  test('the floating islands are held with it, and never replace a phone\'s bar', () => {
    const app = read('src/App.jsx');
    expect(app).toContain('const floatingChrome = filesSidebar && !mobileShell;');
    expect(app).toMatch(/\{floatingChrome \? \(\s*<FloatingChrome/);
    expect(app).toMatch(/\) : \(\s*<div className="topbar">/);   // the bar everyone else gets, intact
    expect(app).toContain("${floatingChrome ? ' is-floating-chrome' : ''}");
    // Full Files shrinks back into the sidebar with one icon, in either pane.
    expect(app).toContain("const shrinkToSidebar = { shrinkLabel: 'Shrink back to the sidebar'");
    expect(app).toMatch(/onShrink: filesSidebar \? \(\) => applyFilesEvent\('board', 'shrink_button'\)/);
    expect(read('src/components/ListSurface.jsx')).toContain("aria-label={dockControls.shrinkLabel || 'Beside board'}");
    // Admins keep the Admin pill in view, in the right island.
    const right = app.slice(app.indexOf('right={('), app.indexOf('menuItems={['));
    expect(right).toMatch(/myTier\.tier === 'admin' && \(\s*<button className="tb-admin-btn"/);
  });
});

test.describe('the top bar as floating islands', () => {
  const rect = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

  test('no bar: the canvas starts at the top, and the islands stay clear of its own controls', async ({ page }) => {
    await open(page);
    await expect(page.locator('.topbar')).toHaveCount(0);
    const left = await rect(page.locator('.chrome-left'));
    const right = await rect(page.locator('.chrome-right'));
    const main = await rect(page.locator('main.main'));
    const canvas = await rect(page.locator('.sbqa-canvas'));
    expect(canvas.t).toBe(main.t);
    expect(left.t - main.t).toBe(8);
    for (const sel of ['.cnv-comments-eye', '.board-tags-strip', '.canvas-presence-roster', '.cnv-hint']) {
      const box = await rect(page.locator(sel));
      expect(overlaps(box, left), `${sel} vs the left island`).toBe(false);
      expect(overlaps(box, right), `${sel} vs the right island`).toBe(false);
    }
    expect(overlaps(left, right)).toBe(false);
  });

  test('⋯ holds what is used now and then; Escape closes it and gives focus back', async ({ page }) => {
    await open(page);
    const more = page.locator('.chrome-more-btn');
    await more.click();
    await expect(page.locator('.chrome-menu-item')).toHaveText(
      ['Version history', 'Deleted clusters', 'Pin a cluster alongside…', 'Help & feedback']);
    await page.keyboard.press('Escape');
    await expect(page.locator('.chrome-menu')).toHaveCount(0);
    await expect(more).toBeFocused();
    // From the keyboard the menu takes focus, and the arrows walk it.
    await page.keyboard.press('Enter');
    await expect(page.locator('.chrome-menu-item').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.chrome-menu-item').nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sbqa-log')).toContainText('trash');
    await expect(page.locator('.chrome-menu')).toHaveCount(0);
  });

  test('with the sidebar hidden, the left island offers it back', async ({ page }) => {
    await open(page);
    await expect(page.locator('.chrome-left').getByRole('button', { name: 'Open sidebar' })).toHaveCount(0);
    await page.evaluate(() => window.__sidebarQa.setCollapsed(true));
    const reopen = page.locator('.chrome-left').getByRole('button', { name: 'Open sidebar' });
    await expect(reopen).toBeVisible();
    await reopen.click();
    await expect(page.locator('.app')).not.toHaveClass(/sb-collapsed/);
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
    await page.evaluate(() => { window.__sidebarQa.setLive(false); window.__sidebarQa.setActive('loc'); });
    await expect(files(page).locator('.sbf-files-name')).toHaveText('Locations');
    await files(page).locator('.sbf-tile').first().click({ modifiers: ['ControlOrMeta'] });
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
    // Marked on its row, and listed under Starred.
    await expect(file.locator('.sbf-star-mark')).toBeVisible();
    await page.locator('.sbf-quickbtn', { hasText: 'Starred' }).click();
    await expect(files(page).locator('.sbf-file', { hasText: 'film-take-2.mov' })).toBeVisible();
  });

  test('a file’s menu shares that one file, and a selection’s menu doesn’t offer it', async ({ page }) => {
    await open(page);
    const file = page.locator('.sbf-file', { hasText: 'film-take-2.mov' }).first();
    await file.click({ button: 'right' });
    await page.locator('.ctx-menu').last().getByText('Share file…', { exact: true }).click();
    await expect.poll(async () => (await calls(page, 'openFileShare')).map((c) => {
      const p = c.params;
      return [p.boardId, p.cardId, p.boardName, p.surface, p.card?.src];
    })).toEqual([['film', 'film-vid-1', 'Feature film', 'sidebar', 'r2:qa']]);
    // Two videos selected, each shareable alone: the menu acts on both, and
    // sharing is one file at a time.
    await files(page).locator('.sbf-file', { hasText: 'film-take-1.mov' }).first().click({ modifiers: ['ControlOrMeta'] });
    await file.click({ modifiers: ['ControlOrMeta'] });
    await file.click({ button: 'right' });
    const menu = page.locator('.ctx-menu').last();
    await expect(menu.getByText('Download 2', { exact: true })).toBeVisible();
    await expect(menu.getByText('Share file…', { exact: true })).toHaveCount(0);
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
