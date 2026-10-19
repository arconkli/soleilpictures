// The sidebar that holds every file, driven through its dev-only QA harness
// (?sidebarqa=1: the real ClusterSidebar over fixture clusters, the open one
// live and the rest served by a fake of 0419's RPCs). What a person sees and
// does: Home and Messages, a tree of cluster names, and below it (or beside it,
// wide) the files of the cluster they're in, or of Recent or Starred (tabs), one
// row each with a small thumbnail — Quick look, the search and its "All files ⌄"
// menu (what shows, the sort), paging a long shelf in place — plus the meter,
// the resize handle and the divider, on two floating cards with one edge 15px
// inside them. The App.jsx wiring behind the hold is pinned by reading the source.
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
// A cluster's photos, as rows (data-sb-item is boardId:cardId).
const photoRows = (page, b = 'film') => files(page).locator(`[data-sb-item^="${b}:${b}-img-"]`);
// The files' tabs: the cluster, Recent, Starred — and the one that's shown.
const tab = (page, name) => files(page).getByRole('tab', { name, exact: true });
const shown = (page) => files(page).getByRole('tab', { selected: true });

test.describe('sidebar files', () => {
  test('the tree is cluster names; the files of the cluster you are in fill the section below it', async ({ page }) => {
    await open(page);
    await expect(row(page, 'Feature film')).toHaveClass(/is-files/);
    // A cluster row is its name: no cover, no count. Quiet label, no number.
    await expect(row(page, 'Feature film').locator('.sb-row-label')).toHaveText('Feature film');
    await expect(nav(page).locator('.sb-tree-row img, .sb-tree-row .sb-row-count, .sb-tree-row .sb-dot')).toHaveCount(0);
    await expect(page.locator('.sb-boards-head-label')).toHaveText('Clusters');
    await expect(page.locator('.sb-boards-count')).toBeHidden();
    await expect(nav(page).locator('.sbf-file')).toHaveCount(0);

    const f = files(page);
    await expect(shown(page)).toHaveText('Feature film');
    // No picture or subtitle in the header, and no sub-cluster cards: the tree lists those.
    await expect(f.locator('.sbf-files-head img, .sbf-files-sub, .sbf-sub, .sbf-chip')).toHaveCount(0);
    // Files first; notes, links and the rest summed up under them, a closed heading each.
    expect(await f.locator('.sbf-shelf-label').allTextContents())
      .toEqual(['Photos', 'Video', 'Audio', 'Files', 'Notes', 'Links', 'Other']);
    expect(await f.locator('.sbf-shelf-toggle').evaluateAll((els) => els.map((el) => el.getAttribute('aria-expanded'))))
      .toEqual(['true', 'true', 'true', 'true', 'false', 'false', 'false']);
    // Photos are rows with a small thumbnail, like everything else: no grid.
    await expect(photoRows(page)).toHaveCount(5);
    await expect(photoRows(page).first()).toHaveClass(/sbf-file/);
    await expect(photoRows(page).first().locator('.sbf-file-thumb')).toBeVisible();
    await expect(f.locator('.sbf-tile, .sbf-mosaic')).toHaveCount(0);
    await expect(f.locator('.sbf-more-btn').first()).toHaveText('Show 25 more');
    // A file stored off the board says so.
    await expect(f.locator('.sbf-file', { hasText: 'film-selects.zip' }).locator('.sbf-stored-dot')).toBeVisible();
  });

  test('opening another cluster shows its files; the Recent and Starred tabs show theirs, and the cluster\'s tab brings it back', async ({ page }) => {
    await open(page);
    const f = files(page);
    await row(page, 'Locations').click();
    await expect(shown(page)).toHaveText('Locations');
    await expect(f.getByRole('tab')).toHaveText(['Locations', 'Recent', 'Starred']);

    await tab(page, 'Recent').click();
    await expect(shown(page)).toHaveText('Recent');
    await expect(f.locator('[data-sb-item]').first()).toBeVisible();

    await tab(page, 'Starred').click();
    await expect(shown(page)).toHaveText('Starred');
    await expect(f.locator('.sbf-cluster-link', { hasText: 'Moodboards' })).toBeVisible();   // a starred cluster, by name
    await expect(f.locator('[data-sb-item="loc:loc-img-0"]')).toBeVisible();                 // a starred file

    // The cluster's tab is the way back: no ✕ for it any more.
    await expect(f.getByRole('button', { name: 'Back to the cluster’s files' })).toHaveCount(0);
    await tab(page, 'Locations').click();
    await expect(shown(page)).toHaveText('Locations');
    // A starred cluster's name opens it.
    await tab(page, 'Starred').click();
    await f.locator('.sbf-cluster-link', { hasText: 'Moodboards' }).click();
    await expect(shown(page)).toHaveText('Moodboards');
  });

  test('←/→ move along the tabs and show what they reach; only the shown tab takes Tab', async ({ page }) => {
    await open(page);
    await shown(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect(shown(page)).toHaveText('Recent');
    await expect(tab(page, 'Recent')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(shown(page)).toHaveText('Starred');
    await page.keyboard.press('ArrowRight');                       // round to the start
    await expect(shown(page)).toHaveText('Feature film');
    await page.keyboard.press('ArrowLeft');
    await expect(shown(page)).toHaveText('Starred');
    expect(await files(page).getByRole('tab').evaluateAll((els) => els.map((el) => el.tabIndex))).toEqual([-1, -1, 0]);
    await expect(files(page).getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await shown(page).getAttribute('id'));
  });

  test('the files header is the tabs and its two icons, quiet until you reach for it', async ({ page }) => {
    await open(page);
    const head = files(page).locator('.sbf-files-head');
    const split = head.getByRole('button', { name: 'Show files beside the clusters' });
    const opacity = () => split.evaluate((el) => getComputedStyle(el).opacity);
    await page.mouse.move(900, 450);
    await expect.poll(opacity).toBe('0.5');
    await head.hover();
    await expect.poll(opacity).toBe('1');
    await expect(head.getByRole('button', { name: 'Open in the full Files page' })).toBeVisible();
  });

  test('Home and Messages are rows of words at the top; Recent and Starred are tabs on the files', async ({ page }) => {
    await open(page);
    const btns = page.locator('.sbf-quick .sbf-quickbtn');
    await expect(btns).toHaveText(['Home', /^Messages2$/]);                      // no Schedule: retired
    await expect(page.locator('.sbf-quick svg')).toHaveCount(0);                 // words, no icons
    await expect(btns.nth(1).locator('.sbf-quick-count')).toHaveText('2');       // unread, a plain number
    // Rows, one over the other, the card's width less its 7px insets.
    const [h, m] = await btns.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    expect(m.top).toBeGreaterThanOrEqual(h.bottom - 1);
    const card = await page.locator('.sbf-quick').evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.round(h.width)).toBe(Math.round(card) - 14);
    await btns.nth(0).click();
    await expect(page.getByTestId('sbqa-log')).toContainText('home');
    await expect(files(page).getByRole('tab')).toHaveText(['Feature film', 'Recent', 'Starred']);
    // Narrow, the three tabs still fit, Recent and Starred whole; the icons make room.
    await page.evaluate(() => window.__sidebarQa.setWidth(240));
    await expect.poll(() => files(page).getByRole('tab').evaluateAll((els) => els.every((el) =>
      el.getBoundingClientRect().right <= el.closest('.sbf-files').getBoundingClientRect().right))).toBe(true);
    for (const name of ['Recent', 'Starred']) {
      expect(await tab(page, name).locator('.sbf-tab-label').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await expect(files(page).getByRole('button', { name: 'Open in the full Files page' })).toBeHidden();
  });

  test('search everywhere is an icon by the workspace: the sidebar keeps one search box, the files\'', async ({ page }) => {
    await open(page);
    await expect(page.locator('.sb-search')).toHaveCount(0);
    await expect(page.locator('.sbf-search input')).toHaveCount(1);
    await page.locator('.sb-mid-search').click();
    await expect(page.getByTestId('sbqa-log')).toContainText('palette ""');
  });

  test('two floating cards, one edge inside them: the top, the headings and the files all start 15px in', async ({ page }) => {
    await open(page);
    // The cards are .sb-mid's ::before (the clusters) and ::after (the files), 8px off the window's edge.
    const card = (which) => page.locator('.sb-mid').evaluate((el, w) => {
      const cs = getComputedStyle(el, w);
      return [cs.content, cs.borderTopLeftRadius];
    }, which);
    expect(await card('::before')).toEqual(['""', '12px']);
    expect(await card('::after')).toEqual(['""', '12px']);
    const left = (sel) => page.locator(sel).first().evaluate((el) =>
      Math.round(el.getBoundingClientRect().left - el.closest('.sidebar').getBoundingClientRect().left));
    for (const sel of ['.sb-ws-avatar', '.sbf-quickbtn .sbf-quick-label', '.sb-boards-head-label',
      '.sbf-search svg', '.sbf-shelf-label', '.sbf-file-thumb', '.sbf-meter-track', '.sbf-meter-text']) {
      expect(await left(sel), sel).toBe(23);
    }
    expect(await left('.sbf-tabs')).toBe(15);        // the segmented control's track, its chips inside
    // The tree's chevrons sit on that edge: names 16px a level. A file's name follows its thumbnail.
    expect(await left('.sb-tree-row[aria-level="1"] .sb-tree-chev')).toBe(23);
    expect(await left('.sb-tree-row[aria-level="1"] .sb-row-label')).toBe(39);
    expect(await left('.sb-tree-row[aria-level="2"] .sb-row-label')).toBe(55);
    expect(await left('.sbf-file .sbf-file-name')).toBe(57);
    expect(await left('.sbf-more-btn')).toBe(57);
    // The cluster you're in: a chip with a gold bar inside its left end, not bold.
    const active = row(page, 'Feature film');
    expect(await active.evaluate((el) => getComputedStyle(el, '::before').display)).toBe('block');
    expect(await active.evaluate((el) => getComputedStyle(el, '::before').backgroundColor)).toBe('rgb(255, 165, 0)');
    expect(await active.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500');
    // One row height; the shown source a 26px chip in a 30px track.
    for (const sel of ['.sbf-quickbtn', '.sb-tree-row', '.sbf-file', '.sbf-tabs']) {
      expect(Math.round(await page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().height)), sel).toBe(30);
    }
    expect(Math.round(await shown(page).evaluate((el) => el.getBoundingClientRect().height))).toBe(26);
    // The cluster's name gets the room it needs beside Recent and Starred and the two buttons.
    expect(await shown(page).locator('.sbf-tab-label').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test('the files tab is files: a doc sits with them, the rest is summed up, and nothing is called "Item"', async ({ page }) => {
    await open(page);
    const f = files(page);
    const shelf = (name) => f.locator('.sbf-shelf', { hasText: name });
    const toggle = (name) => shelf(name).locator('.sbf-shelf-toggle');
    // A doc is a file people write: it's listed with the PDFs and uploads.
    await expect(f.locator('.sbf-file', { hasText: 'Shot list' })).toBeVisible();
    // Notes are a heading with a count until opened.
    await expect(shelf('Notes')).toHaveClass(/is-closed/);
    await expect(shelf('Notes').locator('.sbf-shelf-count')).toHaveText('3');
    await expect(f.locator('.sbf-file', { hasText: 'Call sheet notes' })).toHaveCount(0);
    // Opened, Other shows what it holds, each by a name that says what it is.
    await toggle('Other').click();
    await expect(toggle('Other')).toHaveAttribute('aria-expanded', 'true');
    const other = f.locator('[data-sb-item^="film:film-grid-"], [data-sb-item^="film:film-shape-"], [data-sb-item^="film:film-pal-"]');
    await expect(other.locator('.sbf-file-name')).toHaveText(['Grid', 'Grid', 'Arrow', 'Rectangle', 'Night palette']);
    await expect(f.locator('.sbf-file-name', { hasText: /^Item$/ })).toHaveCount(0);
    await toggle('Other').click();
    await expect(other).toHaveCount(0);
    // A files heading closes and opens the same way.
    await toggle('Photos').click();
    await expect(photoRows(page)).toHaveCount(0);
    await expect(shelf('Photos').locator('.sbf-shelf-count')).toHaveText('30');
    await toggle('Photos').click();
    await expect(photoRows(page)).toHaveCount(5);
    // A search shows everything it found, notes too.
    await f.locator('.sbf-search input').fill('wardrobe');
    await expect(f.locator('.sbf-file', { hasText: 'Wardrobe ideas' })).toBeVisible();
    await expect(f.locator('.sbf-shelf.is-closed')).toHaveCount(0);
  });

  test('the board runs on under the floating cards: the gaps show it and take presses, the cards keep theirs', async ({ page }) => {
    await open(page);
    const sidebar = page.locator('.sidebar');
    const wrap = page.locator('.canvas-wrap');
    // The sidebar paints nothing of its own.
    expect(await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    // The canvas's box stays beside the sidebar — it measures, fits and frames by it — and only its
    // painting reaches under, the ground drawn on from the same pattern.
    const edge = await sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().right));
    expect(await wrap.evaluate((el) => Math.round(el.getBoundingClientRect().left))).toBe(edge);
    expect(await wrap.evaluate((el) => getComputedStyle(el).clipPath)).toContain('inset');
    expect(await wrap.evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      return [before.content, before.backgroundImage === getComputedStyle(el).backgroundImage];
    })).toEqual(['""', true]);
    // What a press lands on.
    const hit = (x, y) => page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el?.closest('.canvas-wrap') ? 'board' : el?.closest('.sidebar') ? 'sidebar' : String(el?.tagName);
    }, [x, y]);
    const vh = page.viewportSize().height;
    const divider = await page.locator('.sbf-divider').boundingBox();
    expect(await hit(4, vh / 2), 'the left gutter').toBe('board');
    expect(await hit(160, 3), 'above the cards').toBe('board');
    expect(await hit(160, vh - 3), 'below them').toBe('board');
    expect(await hit(160, divider.y - 40), "the clusters' card").toBe('sidebar');
    expect(await hit(160, divider.y + divider.height + 60), "the files' card").toBe('sidebar');
    expect(await hit(160, divider.y + divider.height / 2), 'the divider between them').toBe('sidebar');
    await page.mouse.click(4, vh / 2);
    await expect(page.getByTestId('sbqa-log')).toContainText('canvas');
    // Wide, the clusters' card is as tall as the clusters, and under it is board.
    await page.evaluate(() => window.__sidebarQa.setWidth(640));
    await expect(sidebar).toHaveClass(/is-wide/);
    expect(await hit(120, vh - 60), "under the clusters' card").toBe('board');
  });

  test('a long shelf expands in place, and a cluster read from the server pages', async ({ page }) => {
    await open(page);
    const f = files(page);
    await expect(photoRows(page)).toHaveCount(5);
    await f.locator('.sbf-more-btn').first().click();
    await expect(photoRows(page)).toHaveCount(30);
    await f.locator('.sbf-more-btn', { hasText: 'Show less' }).click();
    await expect(photoRows(page)).toHaveCount(5);

    // A cluster whose doc isn't open is read from the server: a peek, then pages.
    await page.evaluate(() => { window.__sidebarQa.setLive(false); window.__sidebarQa.setActive('mv'); });
    await expect(shown(page)).toHaveText('Music video');
    await expect.poll(async () => (await calls(page, 'sidebar_cluster_items'))
      .some((c) => c.params.p_board_id === 'mv' && c.params.p_shelf === null)).toBe(true);
    await expect(f.locator('.sbf-more-btn').first()).toHaveText(`Show ${120 - 5} more`);
    await f.locator('.sbf-more-btn').first().click();         // expand the peek in place
    await f.locator('.sbf-more-btn').first().click();         // then fetch the next page
    await expect.poll(async () => (await calls(page, 'sidebar_cluster_items'))
      .some((c) => c.params.p_board_id === 'mv' && c.params.p_shelf === 'photos' && c.params.p_offset === 12)).toBe(true);
  });

  test('clicking a file opens Quick look, which steps through the whole shelf', async ({ page }) => {
    await open(page);
    await photoRows(page).nth(2).click();
    await expect(page.getByText(/3 of 30/)).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText(/4 of 30/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(/of 30/)).toHaveCount(0);
  });

  // Quick look opened from the sidebar asks the file's own cluster whether
  // you can edit it; it never got told before, so Share never showed.
  test('Quick look from the sidebar offers Share for a file you can edit', async ({ page }) => {
    await open(page);
    await files(page).locator('.sbf-file', { hasText: 'film-take-1.mov' }).click();
    await expect(page.getByRole('dialog', { name: /Quick look: film-take-1\.mov/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share file' })).toBeVisible();
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
    await expect(photoRows(page, 'loc')).toHaveCount(0);
    await f.locator('.sbf-search input').fill('zzz nothing');
    await expect(f.locator('.sbf-files-empty')).toContainText('Nothing in Locations matches');
    await f.locator('.sbf-search input').press('Enter');
    await expect(page.getByTestId('sbqa-log')).toContainText('palette "zzz nothing"');
  });

  test('"All files ⌄" narrows the files to one kind, says which, and closes on Escape', async ({ page }) => {
    await open(page);
    const f = files(page);
    const btn = f.locator('.sbf-filter-btn');
    await expect(btn).toHaveText('All files');
    await btn.click();
    const menu = page.locator('.sbf-menu');   // portaled: nothing in the sidebar can clip it
    // Each kind Feature film holds, with its count; then the sort and the grouping.
    await expect(menu.getByRole('menuitemradio', { name: /^Photos/ })).toContainText('30');
    await expect(menu.locator('.sbf-menu-label')).toHaveText(['Show', 'Sort', 'Group by']);
    await menu.getByRole('menuitemradio', { name: /^Audio/ }).click();
    await expect(f.locator('.sbf-shelf-label')).toHaveText(['Audio']);
    await expect(btn).toHaveText('Audio');
    await expect(btn).toHaveClass(/is-on/);
    // Not on board: only what's stored off the board.
    await btn.click();
    await menu.getByRole('menuitemradio', { name: /^Not on board/ }).click();
    await expect(f.locator('.sbf-file .sbf-file-name')).toHaveText(['film-selects.zip']);
    // Escape closes the menu and gives the button its focus back.
    await btn.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(btn).toBeFocused();
    await btn.click();
    await menu.getByRole('menuitemradio', { name: /^All files/ }).click();
    await expect(f.locator('.sbf-shelf-label')).toHaveCount(7);
    await expect(btn).not.toHaveClass(/is-on/);
  });

  test('the "All files" menu always shows inside the window — whole when it fits — and takes the keys', async ({ page }) => {
    // Room neither under nor over its button: it slides up the window and shows whole.
    await page.setViewportSize({ width: 1280, height: 620 });
    await open(page);
    const btn = files(page).locator('.sbf-filter-btn');
    await btn.click();
    const menu = page.locator('.sbf-menu');
    await expect(menu).toBeVisible();
    const m = await menu.boundingBox();
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.y + m.height).toBeLessThanOrEqual(620);
    expect(await menu.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    // Focus goes in, on the item in force; ↓ walks the items; Escape gives it back.
    await expect(menu.getByRole('menuitemradio', { name: /All files/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: /Photos/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(btn).toBeFocused();
    // A window shorter than the menu: it scrolls, still inside the window.
    await page.setViewportSize({ width: 1280, height: 440 });
    await btn.click();
    await expect(menu).toBeVisible();
    const m2 = await menu.boundingBox();
    expect(m2.y).toBeGreaterThanOrEqual(0);
    expect(m2.y + m2.height).toBeLessThanOrEqual(440);
    expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });

  test('sorting asks the server for that order and remembers it', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__sidebarQa.setLive(false); window.__sidebarQa.setActive('loc'); });
    await files(page).locator('.sbf-filter-btn').click();
    await page.getByRole('menuitemradio', { name: 'Name' }).click();
    await expect.poll(async () => (await calls(page, 'sidebar_cluster_items'))
      .some((c) => c.params.p_board_id === 'loc' && c.params.p_sort === 'name')).toBe(true);
    await page.reload();
    await page.waitForSelector('[data-sidebarqa-ready]');
    await files(page).locator('.sbf-filter-btn').click();
    await expect(page.getByRole('menuitemradio', { name: 'Name' })).toHaveAttribute('aria-checked', 'true');
  });

  test('the meter is a 4px bar over one line, Upload beside it, filled as far as the nearer limit', async ({ page }) => {
    await open(page);
    const m = page.locator('.sbf-meter');
    await expect(m.locator('.sbf-meter-text')).toHaveText('38 of 50 cards · 1.2 of 5.0 GB');
    await expect(m.locator('.sbf-meter-track')).toHaveCount(1);
    const [tb, xb] = [await m.locator('.sbf-meter-track').boundingBox(), await m.locator('.sbf-meter-text').boundingBox()];
    expect(Math.round(tb.height)).toBe(4);
    expect(tb.y + tb.height).toBeLessThanOrEqual(xb.y);              // the bar over the line
    // The bar follows the fuller of the two: 38 of 50 cards (76%), not 1.2 of 5 GB.
    expect(parseFloat(await m.locator('.sbf-meter-fill').evaluate((el) => el.style.width))).toBeCloseTo(76, 0);
    await expect(m.locator('.sbf-upload')).toHaveText('Upload');
    const mid = (l) => l.evaluate((el) => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
    expect(Math.abs(await mid(m.locator('.sbf-meter-text')) - await mid(m.locator('.sbf-upload')))).toBeLessThanOrEqual(2);
    await m.locator('.sbf-meter-text').click();
    await expect(page.getByTestId('sbqa-log')).toContainText('plan');
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

  test('with the files sidebar, search everywhere is an icon, and Schedule is gone', () => {
    const app = read('src/App.jsx');
    expect(app).toMatch(/\{filesSidebar && \(\s*<button className="sb-mid-search"/);
    expect(app).toMatch(/\{!filesSidebar && \(\s*<button className="sb-search"/);
    const quick = app.slice(app.indexOf('quickNav={{'), app.indexOf('listRef={sidebarScrollRef}'));
    expect(quick).toContain('messages:');
    expect(quick).not.toContain('schedule:');
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
    const photos = photoRows(page);
    await photos.nth(0).click({ modifiers: ['ControlOrMeta'] });
    await photos.nth(1).click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('.sbf-bulk')).toContainText('2 selected');
    await expect(photos.nth(0)).toHaveClass(/is-selected/);
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
    const photos = photoRows(page);
    await photos.nth(1).click({ modifiers: ['ControlOrMeta'] });
    await photos.nth(4).click({ modifiers: ['Shift'] });
    await expect(page.locator('.sbf-bulk')).toContainText('4 selected');
    await photos.nth(4).press('Escape');
    await expect(page.locator('.sbf-bulk')).toHaveCount(0);
  });

  test('dragging a file onto another cluster moves it there; ⌥ would copy', async ({ page }) => {
    await open(page);
    // Both ends on screen: a drag that has to scroll the list loses its target.
    await photoRows(page).first().dragTo(row(page, 'Moodboards'));
    await expect.poll(async () => (await calls(page, 'moveFiles')).length).toBe(1);
    const [mv] = await calls(page, 'moveFiles');
    expect(mv.params).toMatchObject({ from: 'film', to: 'mood', mode: 'move', cardIds: ['film-img-0'] });
  });

  test('deleting a selection from a closed cluster removes it through the route, and Undo puts it back', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__sidebarQa.setLive(false); window.__sidebarQa.setActive('loc'); });
    await expect(shown(page)).toHaveText('Locations');
    await photoRows(page, 'loc').first().click({ modifiers: ['ControlOrMeta'] });
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
    await tab(page, 'Starred').click();
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
