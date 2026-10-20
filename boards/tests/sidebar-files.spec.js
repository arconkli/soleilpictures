// The sidebar that holds every file, driven through its dev-only QA harness
// (?sidebarqa=1: the real ClusterSidebar over fixture clusters, the open one
// live and the rest served by a fake of 0419's RPCs). What a person sees and
// does: Home and Messages, a tree of cluster names, and below it (or beside it,
// wide) the files of the cluster they're in, or of Recent or Starred (tabs), one
// row each with a small thumbnail — Quick look, the search and its "All files ⌄"
// menu (what shows, the sort), paging a long shelf in place — plus the meter,
// on two floating cards with one edge 15px inside them, each sized from its
// own edges, its corner and the gap between them (SidebarHandles). The App.jsx wiring behind the hold is pinned by reading the source.
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
// A card where it is, rounded: x, y, w, h, right, bottom.
const card = (page, which) => page.locator(`.sbf-card.is-${which}`).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
});
// A handle (SidebarHandles' data-handle) dragged from its middle.
async function drag(page, id, dx, dy, { steps = 8, release = true } = {}) {
  const b = await page.locator(`[data-handle="${id}"]`).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
  if (release) await page.mouse.up();
}

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
    // Two cards, each a box of its own (the clusters, then the files), 8px off the window's edges and
    // 8px apart, radius 12.
    const cards = await page.locator('.sbf-card').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.bottom), getComputedStyle(el).borderTopLeftRadius];
    }));
    expect(cards.map((c) => [c[0], c[3]])).toEqual([[8, '12px'], [8, '12px']]);
    expect(cards[0][1]).toBe(8);
    expect(cards[1][1] - cards[0][2]).toBe(8);
    const left = (sel) => page.locator(sel).first().evaluate((el) =>
      Math.round(el.getBoundingClientRect().left - el.closest('.sidebar').getBoundingClientRect().left));
    for (const sel of ['.sb-ws-avatar', '.sb-boards-head-label',
      '.sbf-search svg', '.sbf-shelf-label', '.sbf-file-thumb', '.sbf-meter-track', '.sbf-meter-text']) {
      expect(await left(sel), sel).toBe(23);
    }
    // Who's here sits under the workspace's name; Home and Messages are words
    // in the cluster names' column (round 8, the owner's pick D).
    expect(await left('.sbf-who .sbf-who-faces')).toBe(51);
    expect(await left('.sbf-quickbtn .sbf-quick-label')).toBe(39);
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
    // A search shows everything it found, notes too, under plain headings.
    await f.locator('.sbf-search input').fill('wardrobe');
    await expect(f.locator('.sbf-file', { hasText: 'Wardrobe ideas' })).toBeVisible();
    await expect(f.locator('.sbf-shelf.is-closed')).toHaveCount(0);
    await expect(f.locator('button.sbf-shelf-toggle')).toHaveCount(0);
    // A shelf shut while browsing doesn't hide what a search finds in it.
    await f.locator('.sbf-search input').fill('');
    await toggle('Photos').click();
    await expect(photoRows(page)).toHaveCount(0);
    await f.locator('.sbf-search input').fill('still-00');
    await expect(f.locator('.sbf-file', { hasText: 'film-still-001.jpg' })).toBeVisible();
    await f.locator('.sbf-search input').fill('');
    await expect(photoRows(page)).toHaveCount(0);   // and browsing remembers it was shut
  });

  test('a heading keeps the keyboard when the list it opens or shuts grows long or short', async ({ page }) => {
    await open(page);
    const f = files(page);
    await row(page, 'Music video').click();
    await expect(shown(page)).toHaveText('Music video');
    await f.locator('.sbf-more-btn', { hasText: /Show \d+ more/ }).first().click();
    await expect(f.locator('.sbf-block.is-windowed')).toHaveCount(1);
    const photos = f.locator('.sbf-shelf-toggle', { hasText: 'Photos' });
    await photos.focus();
    await page.keyboard.press('Enter');                       // shut: the list is short again
    await expect(f.locator('.sbf-block.is-windowed')).toHaveCount(0);
    await expect(photos).toBeFocused();
    await page.keyboard.press('Enter');                       // open: long again
    await expect(f.locator('.sbf-block.is-windowed')).toHaveCount(1);
    await expect(photos).toBeFocused();
    await page.keyboard.press('ArrowDown');                   // and the arrows still walk the rows
    await expect(f.locator('[data-sb-item]').first()).toBeFocused();
  });

  test('the board runs on under the floating cards: the gaps show it and take presses, the cards keep theirs', async ({ page }) => {
    await open(page);
    const sidebar = page.locator('.sidebar');
    const wrap = page.locator('.canvas-wrap');
    // The sidebar paints nothing of its own, and the cards cast no soft shadow: clipped at the
    // sidebar's edge, it lifted nothing and only darkened the board in the gaps.
    expect(await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    for (const shadow of await page.locator('.sbf-card').evaluateAll((els) => els.map((el) => getComputedStyle(el).boxShadow))) {
      expect(shadow).toMatch(/^rgba\([^)]*\) 0px 1px 1px 0px$/);
    }
    // The canvas's box stays beside the sidebar — it measures, fits and frames by it — and only its
    // painting reaches under, the ground drawn on from the same pattern.
    const edge = await sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().right));
    expect(await wrap.evaluate((el) => Math.round(el.getBoundingClientRect().left))).toBe(edge);
    expect(await wrap.evaluate((el) => getComputedStyle(el).clipPath)).toContain('inset');
    expect(await wrap.evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      return [before.content, before.backgroundImage === getComputedStyle(el).backgroundImage];
    })).toEqual(['""', true]);
    // The grain over the ground runs on under the sidebar too, or the gaps read darker than the board.
    expect(await wrap.locator('.grain-canvas').evaluate((el) => el.getBoundingClientRect().left)).toBeLessThanOrEqual(0);
    // What a press lands on.
    const hit = (x, y) => page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el?.closest('.canvas-wrap') ? 'board' : el?.closest('.sidebar') ? 'sidebar' : String(el?.tagName);
    }, [x, y]);
    const vh = page.viewportSize().height;
    const divider = await page.locator('[data-handle="divider"]').boundingBox();
    expect(await hit(4, vh / 2), 'the left gutter').toBe('board');
    expect(await hit(160, 3), 'above the cards').toBe('board');
    expect(await hit(160, vh - 3), 'below them').toBe('board');
    expect(await hit(160, divider.y - 40), "the clusters' card").toBe('sidebar');
    expect(await hit(160, divider.y + divider.height + 60), "the files' card").toBe('sidebar');
    expect(await hit(160, divider.y + divider.height / 2), 'the divider between them').toBe('sidebar');
    await page.mouse.click(4, vh / 2);
    await expect(page.getByTestId('sbqa-log')).toContainText('canvas');
    // Side by side, the clusters' card is as tall as the clusters, and under it is board (once the
    // files have slid over).
    await page.evaluate(() => window.__sidebarQa.setWidth(640));
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    await expect.poll(() => hit(120, vh - 60), { message: "under the clusters' card" }).toBe('board');
    // With the ground drawn on a canvas (CanvasSurface's has-ground), the strip under the sidebar
    // paints nothing, and a press in a gap still lands on the board.
    await wrap.evaluate((el) => el.classList.add('has-ground'));
    expect(await wrap.evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      return [before.content, before.backgroundImage];
    })).toEqual(['""', 'none']);
    expect(await hit(4, vh / 2), 'the left gutter, over a canvas ground').toBe('board');
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

  test('each card sizes from its own edges: the clusters skinny and the files wide, side by side, both short at the top left', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the handles are a desktop control');
    await open(page);
    const full = page.viewportSize().height - 8;                            // a card down to the window's bottom margin
    await files(page).getByRole('button', { name: 'Show files beside the clusters' }).click();
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    await page.waitForTimeout(300);                                         // the files slide over
    // As wide as the sidebar was side by side, the files the whole height.
    expect(await page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(640);
    expect((await card(page, 'files')).bottom).toBe(full);
    // The gap gives the clusters' room to the files.
    await drag(page, 'split', -40, 0);
    let t = await card(page, 'tree');
    let f = await card(page, 'files');
    expect([t.w, f.x, f.w]).toEqual([200, 216, 424]);
    // The files' right edge widens them, and the sidebar with them.
    await drag(page, 'right', 160, 0);
    f = await card(page, 'files');
    expect(f.w).toBe(584);
    expect(await page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().right))).toBe(f.right);
    // Each bottom edge its own card's: the files short, the clusters a little taller than their list.
    await drag(page, 'bottom', 0, -300);
    const hug = (await card(page, 'tree')).bottom;
    await drag(page, 'treeBottom', 0, 40);
    t = await card(page, 'tree');
    f = await card(page, 'files');
    expect([t.bottom, f.bottom]).toEqual([hug + 40, full - 300]);
    // Under them is board, and it takes the press.
    const under = await page.evaluate((y) => (document.elementFromPoint(100, y)?.closest('.canvas-wrap') ? 'board' : 'not board'), full - 20);
    expect(under).toBe('board');
    // Remembered.
    const layout = await page.evaluate(() => window.__sidebarQa.layout());
    expect(layout.side).toEqual({ tw: 200, fw: 584, tBottom: hug + 40, fBottom: full - 300 });
    await page.reload();
    await page.waitForSelector('[data-sidebarqa-ready]');
    await expect.poll(async () => (await card(page, 'files')).w).toBe(584);
    expect(await page.evaluate(() => window.__sidebarQa.layout())).toEqual(layout);
  });

  test('pulled wider than the stacked sidebar gets, the files go beside the clusters; pulled narrow again, under them', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the handles are a desktop control');
    await open(page);
    // Stacked, each card has its own width.
    await drag(page, 'treeRight', -80, 0);
    await drag(page, 'filesRight', 60, 0);
    expect([(await card(page, 'tree')).w, (await card(page, 'files')).w]).toEqual([232, 372]);
    // Wider than 532 (a 540px sidebar): side by side, carrying on with the files' right edge.
    const b = await page.locator('[data-handle="filesRight"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 100);
    await page.mouse.down();
    await page.mouse.move(700, b.y + 100, { steps: 10 });
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    await expect(page.locator('[data-handle="right"]')).toHaveClass(/is-held/);
    await page.mouse.move(760, b.y + 100, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await card(page, 'files')).right).toBe(760);
    // Once the files have slid over (the handles are placed where they come to rest).
    await expect.poll(() => page.evaluate(() => document.querySelector('.sbf-card.is-files').getAnimations().length)).toBe(0);
    // Narrower than 500 side by side: stacked again, the clusters as wide as they were stacked.
    const r = await page.locator('[data-handle="right"]').boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + 100);
    await page.mouse.down();
    await page.mouse.move(460, r.y + 100, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.sbf-frame')).not.toHaveClass(/is-side/);
    await expect.poll(async () => (await card(page, 'files')).right).toBe(460);
    expect((await card(page, 'tree')).w).toBe(232);
    expect(await page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(460);
  });

  test('side by side from the button stays however narrow the sidebar is dragged; the button again stacks them as they were', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the handles are a desktop control');
    await open(page);
    // Stacked sizes to come back to.
    await drag(page, 'filesRight', 60, 0);
    const stackedW = (await card(page, 'files')).w;
    await files(page).getByRole('button', { name: 'Show files beside the clusters' }).click();
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    await page.waitForTimeout(300);                                         // the files slide over
    const kept = files(page).getByRole('button', { name: 'Show files under the clusters' });
    await expect(kept).toHaveClass(/is-kept/);                              // a choice in force: a gold hairline
    // The files' right edge dragged far left, past where a dragged-in sidebar would stack:
    // still side by side, the files at their least.
    const r = await page.locator('[data-handle="right"]').boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + 100);
    await page.mouse.down();
    await page.mouse.move(150, r.y + 100, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    expect((await card(page, 'files')).w).toBe(232);
    // The clusters at their least as well: the skinniest the two get side by side.
    await drag(page, 'split', -100, 0);
    await drag(page, 'right', -100, 0);
    expect([(await card(page, 'tree')).w, (await card(page, 'files')).w]).toEqual([196, 232]);
    expect(await page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(444);
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    // The button again: stacked, as wide as they were stacked, and nothing kept.
    await kept.click();
    await expect(page.locator('.sbf-frame')).not.toHaveClass(/is-side/);
    await expect.poll(async () => (await card(page, 'files')).w).toBe(stackedW);
    await expect(files(page).getByRole('button', { name: 'Show files beside the clusters' })).not.toHaveClass(/is-kept/);
  });

  test('in a window too narrow for a dragged side by side, the button\'s still shows, and the button goes from what shows', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the handles are a desktop control');
    await page.setViewportSize({ width: 900, height: 800 });
    await open(page);
    // Side by side a drag got to (not kept) needs 920px: here it shows stacked.
    await page.evaluate(() => window.__sidebarQa.setLayout({ arr: 'side', pinned: false }));
    await expect(page.locator('.sbf-frame')).not.toHaveClass(/is-side/);
    // The button keeps them side by side, and that fits.
    await files(page).getByRole('button', { name: 'Show files beside the clusters' }).click();
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    expect(await page.evaluate(() => window.__sidebarQa.layout().pinned)).toBe(true);
    // No wider than the window leaves it, the cards inside it.
    const aside = await page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().right));
    expect(aside).toBeLessThanOrEqual(900 - 420);
    await expect.poll(async () => (await card(page, 'files')).right).toBeLessThanOrEqual(aside);
    // And the button stacks them again.
    await files(page).getByRole('button', { name: 'Show files under the clusters' }).click();
    await expect(page.locator('.sbf-frame')).not.toHaveClass(/is-side/);
  });

  test('stacked, a right edge dragged to the other card\'s lines up with it, and a guide shows where', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the handles are a desktop control');
    await open(page);
    await drag(page, 'treeRight', -60, 0);                                   // the clusters 252 wide
    const t = await card(page, 'tree');
    expect(t.w).toBe(252);
    // The files' right edge dragged to within a few px of the clusters': held there, a guide down both.
    await drag(page, 'filesRight', -56, 0, { release: false });
    const guide = page.locator('.sbf-guide');
    await expect(guide).toHaveClass(/is-on/);
    await expect(guide).toHaveClass(/is-v/);
    const g = await guide.boundingBox();
    expect(Math.round(g.x)).toBe(t.right);
    expect(g.y).toBeLessThan(t.y);
    expect(g.y + g.height).toBeGreaterThan((await card(page, 'files')).bottom);
    await page.mouse.up();
    await expect(guide).not.toHaveClass(/is-on/);
    expect((await card(page, 'files')).right).toBe(t.right);
    // Pulled on past it, it lets go.
    await drag(page, 'filesRight', 40, 0);
    expect((await card(page, 'files')).w).toBe(292);
  });

  test('a bottom snaps to the other card\'s with a guide, and to the window\'s; double-click and the arrow keys', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the handles are a desktop control');
    await open(page);
    const full = page.viewportSize().height - 8;
    await page.evaluate(() => window.__sidebarQa.setWidth(640));
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    await page.waitForTimeout(300);                                         // the files slide over
    await drag(page, 'bottom', 0, -300);
    const fb = full - 300;
    const t0 = await card(page, 'tree');
    // The clusters' bottom dragged near the files': it meets it, and a guide shows where.
    await drag(page, 'treeBottom', 0, fb - t0.bottom - 6, { release: false });
    await expect(page.locator('.sbf-guide')).toHaveClass(/is-on/);
    await page.mouse.up();
    await expect(page.locator('.sbf-guide')).not.toHaveClass(/is-on/);
    expect((await card(page, 'tree')).bottom).toBe(fb);
    // Near the window's bottom, a bottom goes all the way down.
    await drag(page, 'bottom', 0, full - fb - 12);
    expect((await card(page, 'files')).bottom).toBe(full);
    // Double-click puts back what a handle sizes.
    await page.locator('[data-handle="treeBottom"]').dblclick();
    await expect.poll(async () => (await card(page, 'tree')).bottom).toBe(t0.bottom);
    // A focused edge moves 16px an arrow, 64 with Shift, and says how wide.
    const w0 = (await card(page, 'files')).w;
    await page.locator('[data-handle="right"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await card(page, 'files')).w).toBe(w0 + 16 - 64);
    await expect(page.locator('[data-handle="right"]')).toHaveAttribute('aria-valuenow', String(w0 + 16 - 64));
    await expect(page.locator('[data-handle="right"]')).toHaveAttribute('role', 'separator');
    // The corners only repeat two edges: not in the Tab order.
    await expect(page.locator('[data-handle="corner"]')).toHaveAttribute('tabindex', '-1');
  });

  test('the workspace menu drops past a short clusters\' card, over the files, and the handles step aside', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the handles are a desktop control');
    await open(page);
    // The clusters' card made short, so the menu runs on past its bottom, over the files.
    await page.evaluate(() => window.__sidebarQa.setLayout({ arr: 'stack', stack: { tw: 312, fw: 312, th: 160, bottom: 'full' } }));
    await page.locator('.sb-ws-trigger').click();
    const menu = page.locator('.ws-menu');
    await expect(menu).toBeVisible();
    const m = await menu.boundingBox();
    expect(m.y + m.height).toBeGreaterThan((await card(page, 'tree')).bottom + 40);
    // Its last row is what a press there lands on: not clipped by the card, not under the files.
    const last = page.locator('.ws-menu-row').last();
    const b = await last.boundingBox();
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.ws-menu-row')?.textContent,
      [b.x + b.width / 2, b.y + b.height / 2])).toBe('Workspace settings');
    await expect(page.locator('.sbf-handles')).toBeHidden();
    await last.click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.sbf-handles')).toBeVisible();
  });

  test('narrow, the files sit under the clusters; wide, beside them; the button switches', async ({ page }) => {
    await open(page);
    const n = await nav(page).boundingBox();
    const f = await files(page).boundingBox();
    expect(f.y).toBeGreaterThanOrEqual(n.y + n.height - 1);
    await files(page).getByRole('button', { name: 'Show files beside the clusters' }).click();
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    await expect.poll(async () => {
      const [n2, f2] = [await nav(page).boundingBox(), await files(page).boundingBox()];
      return f2.x >= n2.x + n2.width - 1 && f2.y < n2.y;
    }).toBe(true);
    await files(page).getByRole('button', { name: 'Show files under the clusters' }).click();
    await expect(page.locator('.sbf-frame')).not.toHaveClass(/is-side/);
    await expect.poll(async () => Math.round(await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width))).toBe(320);
  });

  test('stacked, the divider moves the line between the cards, and double-click gives the clusters their own height', async ({ page }) => {
    await open(page);
    const before = Math.round((await nav(page).boundingBox()).height);
    await drag(page, 'divider', 0, -120);
    await expect.poll(async () => Math.round((await nav(page).boundingBox()).height)).toBeLessThan(before - 80);
    // The files keep their bottom: they grow by what the clusters gave.
    expect((await card(page, 'files')).bottom).toBe(page.viewportSize().height - 8);
    await page.locator('[data-handle="divider"]').dblclick();
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
    expect(app).toMatch(/\) : \(\s*<div className=\{?[`"]topbar[$`"]/);   // the bar everyone else gets, intact
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
    await expect(page.getByTestId('sbqa-toast')).toContainText('Moved 2 photos to Moodboards');
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

// Hiding the files (owner, 2026-10-19: "it needs to be SUPER easy and SUPER
// obvious on how to get it back"): the files' card folds to its heading where
// it was, "Files … Show", and the clusters take the room.
test.describe('sidebar files: hiding them', () => {
  const sidebarW = (page) => page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const settled = (page) => expect.poll(() => page.evaluate(() => document.querySelector('.sbf-card.is-files').getAnimations().length)).toBe(0);

  test('Hide folds the files to their heading where they were; Show brings them back as they were', async ({ page }) => {
    await open(page);
    const before = await card(page, 'files');
    const heading = page.locator('.sbf-files-heading');
    await expect(heading.locator('.sbf-files-heading-label')).toHaveText('Files');
    const hide = heading.getByRole('button', { name: 'Hide files' });
    await expect(hide).toHaveText('Hide');
    await expect(nav(page)).not.toHaveCSS('max-height', 'none');            // the tree's list has its share
    await hide.click();
    const show = page.getByRole('button', { name: 'Show files' });
    await expect(show).toBeFocused();                                       // the way back is where focus lands
    await expect(show.locator('.sbf-files-heading-label')).toHaveText('Files');
    await expect(show.locator('.sbf-files-show')).toHaveText('Show');
    await expect(files(page)).toBeHidden();
    await expect(page.locator('.sbf-meter')).toBeHidden();
    await expect(page.locator('.sbf-card.is-files .sb-foot')).toBeVisible();   // help, settings, you stay
    // Folded where the card was: under the clusters, at their width.
    await settled(page);
    const tree = await card(page, 'tree');
    const f = await card(page, 'files');
    expect([f.x, f.w, f.y]).toEqual([tree.x, tree.w, tree.bottom + 8]);
    expect(f.h).toBeLessThan(110);
    await expect(nav(page)).toHaveCSS('max-height', 'none');                // the clusters take the room
    // Kept on this device.
    await page.goto('/?sidebarqa=1');
    await page.waitForSelector('[data-sidebarqa-ready]');
    await page.getByRole('button', { name: 'Show files' }).click();
    await expect(page.locator('.sbf-block').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide files' })).toBeFocused();
    await settled(page);
    expect(await card(page, 'files')).toEqual(before);
    // ⌘\ from inside the card keeps focus with it, either way.
    await page.keyboard.press('ControlOrMeta+Backslash');
    await expect(page.getByRole('button', { name: 'Show files' })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Backslash');
    await expect(page.getByRole('button', { name: 'Hide files' })).toBeFocused();
    // Folding closes what was open in the card: no menu left over the folded bar.
    await files(page).getByRole('button', { name: /All files/ }).click();
    await expect(page.locator('.sbf-menu')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Backslash');
    await expect(page.locator('.sbf-menu')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show files' })).toBeFocused();
  });

  test('⌘\\ hides and shows them; side by side they fold under the clusters and the board gets the room', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'the floating sidebar is a desktop one');
    await open(page);
    await files(page).getByRole('button', { name: 'Show files beside the clusters' }).click();
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    await settled(page);
    const wide = await sidebarW(page);
    const tree = await card(page, 'tree');
    await page.keyboard.press('ControlOrMeta+Backslash');
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-files-hidden/);
    await expect(page.locator('.sbf-frame')).not.toHaveClass(/is-side/);
    await settled(page);
    const f = await card(page, 'files');
    expect([f.x, f.w, f.y]).toEqual([tree.x, tree.w, (await card(page, 'tree')).bottom + 8]);
    expect(await card(page, 'tree')).toMatchObject({ x: tree.x, w: tree.w });
    await expect.poll(() => sidebarW(page)).toBe(8 + tree.w);
    // One handle while they're hidden: the clusters' width.
    await expect(page.locator('[data-handle]')).toHaveCount(1);
    await drag(page, 'treeRight', 30, 0);
    await expect.poll(async () => (await card(page, 'tree')).w).toBe(tree.w + 30);
    await page.keyboard.press('ControlOrMeta+Backslash');
    await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
    await expect(page.locator('.sbf-block').first()).toBeVisible();
    await expect.poll(() => sidebarW(page)).toBe(wide + 30);
  });
});

// ── Another cluster's files, and the rules for dragging them (round 11) ─────
// The owner: "easily navigate to other clusters so we can drag files from one
// cluster to another… figure out the rules". The cluster tab lists every
// cluster; dragging moves, the copy key copies, nothing goes into a cluster
// you can only view or out of the workspace, and a label at the pointer says
// which before you let go. Playwright's dragTo lets go at once, so a drag that
// has to be held (to read the label, or to spring a cluster open) is held in
// the page: dragstart on the file, then dragover on the target every 80ms, as
// a browser does, until letGo drops it.
async function holdDrag(page, from, to, { alt = false } = {}) {
  await page.evaluate(({ from, to, alt }) => {
    const src = document.querySelector(from);
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const held = { dt, dst: null, alt, timer: 0 };
    held.over = (sel, altKey) => {
      held.dst = document.querySelector(sel);
      held.alt = altKey;
      clearInterval(held.timer);
      const fire = () => {
        const r = held.dst.getBoundingClientRect();
        held.dst.dispatchEvent(new DragEvent('dragover', {
          bubbles: true, cancelable: true, dataTransfer: dt,
          clientX: r.left + 24, clientY: r.top + r.height / 2, altKey: held.alt,
        }));
      };
      fire();
      held.timer = setInterval(fire, 80);
    };
    held.over(to, alt);
    window.__heldDrag = held;
  }, { from, to, alt });
}
const holdOver = (page, to, { alt = false } = {}) => page.evaluate(({ to, alt }) => window.__heldDrag.over(to, alt), { to, alt });
async function letGo(page) {
  await page.evaluate(() => {
    const h = window.__heldDrag;
    clearInterval(h.timer);
    const r = h.dst.getBoundingClientRect();
    h.dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: h.dt, clientX: r.left + 24, clientY: r.top + r.height / 2, altKey: h.alt }));
    window.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: h.dt }));
  });
}
const label = (page) => page.locator('.sbf-draglabel');
const treeRowSel = (id) => `.sb-tree-row[data-board-id="${id}"]`;

test.describe('sidebar files: another cluster, and the rules', () => {
  test('the cluster tab lists every cluster; picking one shows its files while the board stays, and Back returns', async ({ page }) => {
    await open(page);
    const f = files(page);
    await expect(shown(page)).toHaveText('Feature film');
    await tab(page, 'Feature film').click();
    const list = page.getByRole('menu', { name: 'Show the files of' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('menuitemradio', { name: /Feature film/ })).toHaveAttribute('aria-checked', 'true');
    await expect(list.getByRole('menuitemradio', { name: /Feature film/ })).toContainText('Open now');
    // Found by name; Enter takes the first.
    await list.getByRole('searchbox', { name: 'Find a cluster' }).fill('cast');
    await expect(list.getByRole('menuitemradio')).toHaveText(['Casting']);
    await page.keyboard.press('Enter');
    await expect(list).toHaveCount(0);
    await expect(shown(page)).toHaveText('Casting');
    await expect(photoRows(page, 'cast').first()).toBeVisible();
    // The board didn't move: the tree still marks Feature film.
    await expect(page.getByTestId('sbqa-active')).toHaveText('open: film');
    await expect(row(page, 'Feature film')).toHaveClass(/active/);
    await expect(f.getByRole('searchbox', { name: 'Search Casting' })).toBeVisible();

    await f.getByRole('button', { name: 'Back to Feature film' }).click();
    await expect(shown(page)).toHaveText('Feature film');
    await expect(f.locator('.sbf-away')).toHaveCount(0);

    // Open takes the board there, and Files simply follows it.
    await tab(page, 'Feature film').click();
    await list.getByRole('menuitemradio', { name: 'Casting' }).click();
    await f.getByRole('button', { name: 'Open Casting' }).click();
    await expect(page.getByTestId('sbqa-active')).toHaveText('open: cast');
    await expect(shown(page)).toHaveText('Casting');
    await expect(f.locator('.sbf-away')).toHaveCount(0);
  });

  test('the list opens from the keyboard and Escape closes it, back on the tab', async ({ page }) => {
    await open(page);
    await tab(page, 'Feature film').focus();
    await page.keyboard.press('ArrowDown');
    const list = page.getByRole('menu', { name: 'Show the files of' });
    await expect(list.getByRole('searchbox', { name: 'Find a cluster' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(list.getByRole('menuitemradio').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(tab(page, 'Feature film')).toBeFocused();
  });

  test('the label at the pointer says Move, says Copy while ⌥ is held, and Undo names where they went', async ({ page }) => {
    await open(page);
    const first = '[data-sb-item="film:film-img-0"]';
    await holdDrag(page, first, treeRowSel('loc'));
    await expect(label(page)).toContainText('Move film-still-001.jpg to Locations');
    await expect(label(page)).toContainText('Into its files, not onto its board');
    await expect(label(page)).toContainText('Hold Ctrl to copy instead');   // desktop-chrome is Windows here
    await holdOver(page, treeRowSel('loc'), { alt: true });
    await expect(label(page)).toContainText('Copy film-still-001.jpg to Locations');
    await expect(label(page)).toContainText('The original stays in Feature film');
    await holdOver(page, treeRowSel('loc'));
    await letGo(page);
    await expect(label(page)).toHaveCount(0);
    await expect.poll(async () => (await calls(page, 'moveFiles')).length).toBe(1);
    const [mv] = await calls(page, 'moveFiles');
    expect(mv.params).toMatchObject({ from: 'film', to: 'loc', mode: 'move', cardIds: ['film-img-0'] });
    await expect(page.getByTestId('sbqa-toast')).toContainText('Moved film-still-001.jpg to Locations');
  });

  test('over the cluster the file is in, and over a cluster from another workspace, the label says why not', async ({ page }) => {
    await page.goto('/?sidebarqa=1&shared=1');
    await page.waitForSelector('[data-sidebarqa-ready]');
    await page.locator('.sb-shared-head').click();
    await expect(page.locator('.sb-shared-row', { hasText: 'Grade' })).toBeVisible();
    await holdDrag(page, '[data-sb-item="film:film-img-0"]', treeRowSel('film'));
    await expect(label(page)).toContainText('Already in Feature film');
    await holdOver(page, '.sb-shared-row[data-drop-board="grade"]');
    await expect(label(page)).toContainText('Grade is in Gradehouse');
    await expect(label(page)).toContainText('Files can only move within Sidebar QA');
    await letGo(page);
    expect(await calls(page, 'moveFiles')).toHaveLength(0);
  });

  test('a cluster you can only view takes nothing, and its files can be copied out but not moved', async ({ page }) => {
    await page.goto('/?sidebarqa=1&viewonly=mood');
    await page.waitForSelector('[data-sidebarqa-ready]');
    await holdDrag(page, '[data-sb-item="film:film-img-0"]', treeRowSel('mood'));
    await expect(label(page)).toContainText('Moodboards is view only');
    await letGo(page);
    expect(await calls(page, 'moveFiles')).toHaveLength(0);

    await page.goto('/?sidebarqa=1&viewonly=film');
    await page.waitForSelector('[data-sidebarqa-ready]');
    await photoRows(page).first().click({ button: 'right' });
    const menu = page.locator('.ctx-menu').last();
    await expect(menu.getByText('Copy to…', { exact: true })).toBeVisible();
    await expect(menu.getByText('Move to…', { exact: true })).toHaveCount(0);
    await menu.getByText('Copy to…', { exact: true }).click();
    await expect.poll(async () => (await calls(page, 'moveFiles')).length).toBe(1);
    expect((await calls(page, 'moveFiles'))[0].params).toMatchObject({ from: 'film', to: 'mood', mode: 'copy' });
    // Dragged, they copy too: the label says why.
    await holdDrag(page, '[data-sb-item="film:film-img-1"]', treeRowSel('loc'));
    await expect(label(page)).toContainText('Copy film-still-002.jpg to Locations');
    await expect(label(page)).toContainText('Feature film is view only, so it’s copied');
    await letGo(page);
    await expect.poll(async () => (await calls(page, 'moveFiles')).length).toBe(2);
    expect((await calls(page, 'moveFiles'))[1].params).toMatchObject({ from: 'film', to: 'loc', mode: 'copy' });
  });

  test('a selection from two clusters drags whole: each goes from its own', async ({ page }) => {
    await open(page);
    // One from Feature film, then, through the cluster tab, one from Casting.
    await photoRows(page).first().click({ modifiers: ['ControlOrMeta'] });
    await tab(page, 'Feature film').click();
    await page.getByRole('menu', { name: 'Show the files of' }).getByRole('menuitemradio', { name: 'Casting' }).click();
    await expect(shown(page)).toHaveText('Casting');
    await photoRows(page, 'cast').first().click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('.sbf-bulk')).toContainText('2 selected');
    await holdDrag(page, '[data-sb-item="cast:cast-img-0"]', treeRowSel('mood'));
    await expect(label(page)).toContainText('Move 2 photos to Moodboards');
    await expect(label(page)).toContainText('Into its files, not onto its board');
    await letGo(page);
    await expect.poll(async () => (await calls(page, 'moveFiles')).length).toBe(2);
    const moves = (await calls(page, 'moveFiles')).map((c) => [c.params.from, c.params.cardIds.join()]).sort();
    expect(moves).toEqual([['cast', 'cast-img-0'], ['film', 'film-img-0']]);
  });

  test('over the board, the label says where the file goes: put there, or moved onto it from where it was', async ({ page }) => {
    await open(page);
    await holdDrag(page, '[data-sb-item="film:film-img-0"]', '.sbqa-canvas');
    await expect(label(page)).toContainText('Put film-still-001.jpg here');
    await expect(label(page)).toContainText('Onto the board, where you let go');
    await letGo(page);
    // Another cluster's file, shown from the tab, over this board.
    await tab(page, 'Feature film').click();
    await page.getByRole('menu', { name: 'Show the files of' }).getByRole('menuitemradio', { name: 'Casting' }).click();
    await expect(photoRows(page, 'cast').first()).toBeVisible();
    await holdDrag(page, '[data-sb-item="cast:cast-img-0"]', '.sbqa-canvas');
    await expect(label(page)).toContainText(/Move .+ to Feature film/);
    await expect(label(page)).toContainText('Onto the board · it leaves Casting');
    await holdOver(page, '.sbqa-canvas', { alt: true });
    await expect(label(page)).toContainText('Onto the board, where you let go');
    await expect(label(page)).toContainText('The original stays in Casting');
    await letGo(page);
  });

  test('the toast after a move offers Put on board, which asks for that cluster\'s board; a refusal says why', async ({ page }) => {
    await open(page);
    await holdDrag(page, '[data-sb-item="film:film-img-0"]', treeRowSel('loc'));
    await letGo(page);
    const t = page.getByTestId('sbqa-toast');
    await expect(t).toContainText('Moved film-still-001.jpg to Locations');
    await expect(t.getByRole('button')).toHaveText(['Put on board', 'Undo']);
    await t.getByRole('button', { name: 'Put on board' }).click();
    await expect.poll(async () => (await calls(page, 'putOnBoard')).length).toBe(1);
    expect((await calls(page, 'putOnBoard'))[0].params).toEqual({ boardId: 'loc', cardIds: ['film-img-0'] });
    // Refused, it says what App said.
    await page.evaluate(() => { window.__sidebarQa.putFails = 'Locations is view-only for you.'; });
    await holdDrag(page, '[data-sb-item="film:film-img-1"]', treeRowSel('loc'));
    await letGo(page);
    await expect(t).toContainText('Moved film-still-002.jpg to Locations');
    await t.getByRole('button', { name: 'Put on board' }).click();
    await expect(t).toContainText('Locations is view-only for you.');
  });

  test('zips dropped on a cluster row go to the bulk import; a loose file beside them goes in as a drop', async ({ page }) => {
    await open(page);
    await page.evaluate((sel) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['PK'], 'shoot-day-1.zip', { type: 'application/zip' }));
      dt.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const at = { clientX: r.left + 24, clientY: r.top + r.height / 2 };
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
    }, treeRowSel('loc'));
    await expect.poll(async () => (await calls(page, 'importTree')).length).toBe(1);
    expect((await calls(page, 'importTree'))[0].params).toEqual({ boardId: 'loc', files: ['shoot-day-1.zip', 'notes.txt'], entries: 0, source: 'sidebar' });
    await expect(page.getByTestId('sbqa-log')).toContainText('drop 1 on loc');
  });

  test('held over a folded cluster, a drag opens it', async ({ page }) => {
    await open(page);
    await row(page, 'Feature film').locator('.sb-tree-chev').click();
    await expect(row(page, 'Feature film')).toHaveAttribute('aria-expanded', 'false');
    await holdDrag(page, '[data-sb-item="film:film-img-0"]', treeRowSel('film'));
    await expect(row(page, 'Feature film')).toHaveAttribute('aria-expanded', 'true', { timeout: 2500 });
    await expect(row(page, 'Locations')).toBeVisible();
    await holdOver(page, treeRowSel('loc'));
    await letGo(page);
    await expect.poll(async () => (await calls(page, 'moveFiles')).length).toBe(1);
  });
});
