// How the Files panel looks and fits — the things that read as broken when
// they regress: rings that clip, a header that spills at the panel's minimum
// width, a View menu that can't show what's on, toasts over the panel.
// Driven through the ?local=1 harness.
import { expect, test } from '@playwright/test';
import { openFullFiles } from './files-helpers.js';

async function go(page, { width = 1440, height = 900 } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => {
    try { localStorage.removeItem('soleil.files.dock'); localStorage.setItem('soleil.files.dockHint', '1'); } catch (_) {}
    window.history.replaceState(null, '', '/?local=1');
  });
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  await expect(panel(page)).toBeVisible();
}

const panel = (page) => page.locator('.list-wrap.is-panel');
const tiles = (page) => panel(page).locator('.ct-jg [data-item-id]');

async function narrow(page) {
  const b = await page.locator('.fdl-divider').boundingBox();
  await page.mouse.move(b.x + b.width / 2, 450);
  await page.mouse.down();
  await page.mouse.move(1440 - 300, 450, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await page.locator('.fdl-files').boundingBox()).width).toBeLessThan(330);
}

test('grid tiles draw their whole selection ring — nothing paint-contains them', async ({ page }) => {
  await go(page);
  await tiles(page).nth(1).click();
  const t = tiles(page).nth(1);
  await expect(t).toHaveClass(/is-selected/);
  expect(await t.evaluate((el) => getComputedStyle(el).contentVisibility)).toBe('visible');
});

test('at its minimum width the panel fits: no sideways scroll, ⤢ × + and the selection bar stay inside', async ({ page }) => {
  await go(page);
  await narrow(page);
  const p = panel(page);
  expect(await p.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const box = await page.locator('.fdl-files').boundingBox();
  for (const name of ['Close Files', 'Expand Files to full screen', 'Add files']) {
    const b = await p.getByRole('button', { name }).boundingBox();
    expect(b.x + b.width, name).toBeLessThanOrEqual(box.x + box.width);
  }
  await tiles(page).nth(1).click();
  await tiles(page).nth(3).click({ modifiers: ['Shift'] });
  const clear = await p.getByRole('button', { name: 'Clear selection' }).boundingBox();
  expect(clear.x + clear.width).toBeLessThanOrEqual(box.x + box.width);
});

test('the View menu shows which layout and sort are on', async ({ page }) => {
  await go(page);
  await panel(page).getByRole('button', { name: /^View/ }).click();
  const menu = page.locator('.cbt-menu');
  await expect(menu.locator('.ctx-item.is-active', { hasText: /^Grid$/ }).locator('.cbt-check')).toHaveCount(1);
  await expect(menu.locator('.ctx-item', { hasText: /^List$/ }).locator('.cbt-check')).toHaveCount(0);
  await expect(menu.locator('.ctx-item.is-active', { hasText: 'Board order' }).locator('.cbt-check')).toHaveCount(1);
});

test('toasts move clear of the docked panel', async ({ page }) => {
  await go(page);
  await tiles(page).first().click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item', { hasText: /^Delete/ }).click();
  // The confirm can open a beat after the menu closes: wait for it briefly.
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Delete' });
  if (await confirm.waitFor({ timeout: 2000 }).then(() => true, () => false)) await confirm.click();
  const toast = page.locator('.toast-stack .toast').first();
  await expect(toast).toBeVisible();
  const t = await toast.boundingBox();
  const f = await page.locator('.fdl-files').boundingBox();
  expect(t.x + t.width).toBeLessThanOrEqual(f.x + 1);
});

test('the title row navigates: ▾ on the current cluster lists the clusters inside it', async ({ page }) => {
  await go(page);
  const here = panel(page).locator('.pb-step.is-here button.pb-here');
  await expect(here).toHaveAttribute('aria-haspopup', 'menu');
  await here.click();
  const menu = page.locator('.pb-menu');
  // The seed's home has sub-clusters only (no linked ones), so the menu lists
  // exactly what CLUSTERS counts.
  const n = Number(await panel(page).locator('.list-section-count').first().textContent());
  expect(n).toBeGreaterThan(0);
  await expect(menu.locator('.pb-menu-item:not(.pb-menu-goto)')).toHaveCount(n);
  await menu.locator('.pb-menu-item', { hasText: 'Features' }).click();
  await expect(panel(page).locator('.pb-step.is-here')).toContainText('Features');
  await expect(panel(page).locator('.cbt-ro')).toHaveText('View only');
});

test('panel folders: two rows until Show all, remembered on this device', async ({ page }) => {
  await go(page);
  await narrow(page);   // two columns → four folders shown of the seed's five… unless only one is hidden
  const folders = panel(page).locator('.ft-grid.is-panel [data-folder-id]');
  const total = await panel(page).locator('.list-section-count').first().textContent();
  const more = panel(page).getByRole('button', { name: /^Show all/ });
  if (await more.count()) {
    expect(await folders.count()).toBeLessThan(Number(total));
    await more.click();
    await expect(folders).toHaveCount(Number(total));
    await page.reload();
    await expect(page.locator('.rail-brand')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Show fewer' })).toBeVisible();
  } else {
    await expect(folders).toHaveCount(Number(total));
  }
});

test('captions drop the file extension; the tooltip keeps the full name', async ({ page }) => {
  await go(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await panel(page).locator('input[type="file"][multiple]').setInputFiles([{ name: 'grade-ref.png', mimeType: 'image/png', buffer: png }]);
  const name = panel(page).locator('.ct-tile-name[title="grade-ref.png"]');
  await expect(name).toHaveText('grade-ref');
});

test('the round check on a tile adds it to the selection without a modifier key', async ({ page }) => {
  await go(page);
  await tiles(page).nth(1).click();
  await tiles(page).nth(3).hover();
  await tiles(page).nth(3).locator('.ct-tile-check').click();
  await expect(tiles(page).nth(1)).toHaveClass(/is-selected/);
  await expect(tiles(page).nth(3)).toHaveClass(/is-selected/);
  await expect(panel(page).locator('.list-selbar-count')).toHaveText('2 selected');
  await tiles(page).nth(3).locator('.ct-tile-check').click();
  await expect(tiles(page).nth(3)).not.toHaveClass(/is-selected/);
});

async function dragFilesOver(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.list-wrap.is-panel');
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
}

test('dragging files over the panel says where they go — and, browsing, that they can\'t', async ({ page }) => {
  await go(page);
  await dragFilesOver(page);
  await expect(panel(page).locator('.lp-drop')).toContainText('Drop to add to');
  await expect(panel(page).locator('.lp-drop')).toContainText('off the board');
  await page.evaluate(() => document.querySelector('.list-wrap.is-panel').dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: document.body })));
  await expect(panel(page).locator('.lp-drop')).toHaveCount(0);
  // Browsing another cluster: read-only here.
  await panel(page).locator('[data-folder-id]').first().dblclick();
  await expect(panel(page).locator('.cbt-ro')).toBeVisible();
  await dragFilesOver(page);
  await expect(panel(page).locator('.lp-drop.is-blocked')).toContainText('to add files');
});

test('a cluster with no files says so and offers the one thing to do', async ({ page }) => {
  await go(page);
  await panel(page).locator('[data-folder-id]').first().dblclick();
  const empty = panel(page).locator('.list-empty.is-compact');
  await expect(empty).toBeVisible();
  await expect(empty.locator('.list-empty-title')).toContainText('No files in');
});

test('Quick look gives a link its own card with an Open link that works for a bare domain', async ({ page }) => {
  await go(page);
  await panel(page).locator('[data-item-id="home-link"]').dblclick();
  const open = page.locator('.ql .ql-link a.ql-open');
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute('href', 'https://docs.soleil');
});

test('the divider states its bounds, and Home / End take the panel to them', async ({ page }) => {
  await go(page);
  const div = page.locator('.fdl-divider');
  await expect(div).toHaveAttribute('aria-valuemin', '300');
  const max = Number(await div.getAttribute('aria-valuemax'));
  expect(max).toBeGreaterThan(300);
  await div.focus();
  await page.keyboard.press('End');
  await expect(div).toHaveAttribute('aria-valuenow', String(max));
  await page.keyboard.press('Home');
  await expect(div).toHaveAttribute('aria-valuenow', '300');
});

test('Back returns Files to where it was scrolled; a folder opens at its top', async ({ page }) => {
  await go(page, { width: 1440, height: 560 });
  const p = panel(page);
  await p.evaluate((el) => { el.scrollTop = 260; });
  await expect.poll(() => p.evaluate((el) => el.scrollTop)).toBeGreaterThan(200);
  // Let the panel finish laying out (its folder rows reflow once their width
  // is known) before reading where it rests — that's the place it remembers.
  await page.waitForTimeout(400);
  const at = await p.evaluate((el) => el.scrollTop);
  // Step into a folder from the title row's ▾ (the folder rows are scrolled away).
  await p.locator('.pb-step.is-here button.pb-here').click();
  await page.locator('.pb-menu .pb-menu-item').first().click();
  await expect(p.locator('.cbt-ro')).toBeVisible();
  await expect.poll(() => p.evaluate((el) => el.scrollTop)).toBe(0);
  await p.getByRole('button', { name: 'Back' }).click();
  await expect.poll(() => p.evaluate((el) => el.scrollTop)).toBe(at);
});

test('the List layout is a table whose sortable columns say how they sort', async ({ page }) => {
  await go(page);
  await panel(page).getByRole('button', { name: /^View/ }).click();
  await page.locator('.cbt-menu .ctx-item', { hasText: /^List$/ }).click();
  await page.keyboard.press('Escape');
  await panel(page).getByRole('button', { name: 'Expand Files to full screen' }).click();
  const table = page.locator('.list-wrap:not(.is-panel) .ct-table');
  await expect(table).toHaveAttribute('role', 'table');
  await expect(table.locator('[aria-selected]')).toHaveCount(0);
  const name = table.getByRole('columnheader').filter({ hasText: 'Name' });
  await expect(name).toHaveAttribute('aria-sort', 'none');
  await name.getByRole('button').click();
  await expect(name).toHaveAttribute('aria-sort', /ascending|descending/);
});

test('the View menu speaks in radios and checkboxes, grouped by heading', async ({ page }) => {
  await go(page);
  await panel(page).getByRole('button', { name: /^View/ }).click();
  const menu = page.locator('.cbt-menu');
  await expect(menu.getByRole('group', { name: 'Sort by' })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: 'List' })).toHaveAttribute('aria-checked', 'false');
});

test('Escape on an open View menu closes the menu and keeps the selection', async ({ page }) => {
  await go(page);
  await tiles(page).nth(1).click();
  await panel(page).getByRole('button', { name: /^View/ }).click();
  await expect(page.locator('.cbt-menu')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cbt-menu')).toHaveCount(0);
  await expect(tiles(page).nth(1)).toHaveClass(/is-selected/);
  await expect(panel(page).locator('.ct-tile.is-active')).toHaveCount(0);
});

test('Shift+Space adds the highlighted file to the selection, and takes it out again', async ({ page }) => {
  await go(page);
  await tiles(page).nth(3).click();
  await page.keyboard.press('ArrowRight');       // the highlight starts on the first tile
  await expect(tiles(page).first()).toHaveClass(/is-active/);
  await page.keyboard.press('Shift+Space');
  await expect(panel(page).locator('.list-selbar-count')).toHaveText('2 selected');
  await expect(tiles(page).first()).toHaveClass(/is-selected/);
  await expect(tiles(page).nth(3)).toHaveClass(/is-selected/);
  await expect(page.locator('.ql')).toHaveCount(0);
  await page.keyboard.press('Shift+Space');
  await expect(tiles(page).first()).not.toHaveClass(/is-selected/);
});

test('the round check does not take focus: Space after it still opens Quick look', async ({ page }) => {
  await go(page);
  const t = tiles(page).nth(1);
  await t.hover();
  await t.locator('.ct-tile-check').click();
  await expect(t).toHaveClass(/is-selected/);
  await page.keyboard.press('Space');
  await expect(page.locator('.ql')).toBeVisible();
});

test('the path ▾ menu works from the keyboard and Escape hands focus back', async ({ page }) => {
  await go(page);
  const here = panel(page).locator('.pb-step.is-here button.pb-here');
  await here.focus();
  await page.keyboard.press('Enter');
  const items = page.locator('.pb-menu .pb-menu-item');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pb-menu')).toHaveCount(0);
  await expect(here).toBeFocused();
});

test('at phone width full Files keeps the cluster name and the View menu on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await page.reload();
  // No room for a panel at this width: Files opens full.
  await page.getByRole('button', { name: /^Files/ }).first().click();
  await expect(page.locator('.list-wrap:not(.is-panel)')).toBeVisible();
  const title = page.locator('.cb-pagehead-title');
  await expect(title).toBeVisible();
  expect((await title.boundingBox()).width).toBeGreaterThan(80);
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.locator('.list-wrap:not(.is-panel)').getByRole('button', { name: /^View/ }).click();
  const m = await page.locator('.cbt-menu').boundingBox();
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(390);
});

test('full Files: coming back from a folder returns to where the list was scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await openFullFiles(page);
  const wrap = page.locator('.list-wrap:not(.is-panel)');
  const home = (await page.locator('.cb-pagehead-title').textContent()).trim();
  await wrap.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => wrap.evaluate((el) => el.scrollTop)).toBeGreaterThan(30);
  const at = await wrap.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(100);
  await wrap.locator('[data-folder-id]').first().dblclick();
  await expect(page.locator('.cb-pagehead-title')).not.toHaveText(home);
  await page.locator('.crumbs .crumb', { hasText: home }).first().click();   // up one, in the topbar
  await expect(page.locator('.cb-pagehead-title')).toHaveText(home);
  await expect.poll(() => wrap.evaluate((el) => el.scrollTop)).toBe(at);
});

// ── Spring-loaded folders (lib/springLoad.js) ──────────────────────────────
// A held HTML5 drag: Playwright only sends dragover on mouse moves, and the
// spring is a timer from dragenter, so the hold is a plain wait.
async function startDrag(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 10, b.y + b.height / 2 + 10, { steps: 3 });
}
async function holdOver(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.waitForTimeout(900);
  await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 2);
}

test('holding a dragged file over a folder opens it; dropping there moves the file in', async ({ page }) => {
  await go(page);
  const p = panel(page);
  const tile = tiles(page).nth(3);
  const name = await tile.locator('.ct-tile-name').getAttribute('title');
  await startDrag(page, tile);
  const folder = p.locator('.ft', { hasText: 'Features' });
  const fb = await folder.boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2, { steps: 8 });
  await expect(folder).toHaveClass(/is-springing/);
  await page.waitForTimeout(900);
  await page.mouse.move(fb.x + fb.width / 2 + 2, fb.y + fb.height / 2 + 2);
  await expect(p.locator('.pb-step.is-here')).toContainText('Features');
  const box = await p.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 120, { steps: 5 });
  await expect(p.locator('.lp-drop')).toContainText('Drop to move to Features');
  await page.mouse.up();
  await expect(p.locator(`.ct-tile-name[title="${name}"]`)).toHaveCount(1);
  await p.getByRole('button', { name: 'Back' }).click();
  await expect(p.locator('.pb-step.is-here')).toContainText('Studio');
  await expect(p.locator(`.ct-tile-name[title="${name}"]`)).toHaveCount(0);
});

test('holding over Back goes back mid-drag; a cancelled drag returns to where it started', async ({ page }) => {
  await go(page);
  const p = panel(page);
  await startDrag(page, tiles(page).nth(2));
  await holdOver(page, p.locator('.ft', { hasText: 'Stills' }));
  await expect(p.locator('.pb-step.is-here')).toContainText('Stills');
  await holdOver(page, p.getByRole('button', { name: 'Back' }));
  await expect(p.locator('.pb-step.is-here')).toContainText('Studio');
  await holdOver(page, p.locator('.ft', { hasText: 'Stills' }));
  await expect(p.locator('.pb-step.is-here')).toContainText('Stills');
  // Let go outside any drop target: nothing moves, and the panel goes back.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.mouse.move(700, 400);
  await expect(p.locator('.pb-step.is-here')).toContainText('Studio');
});

test('full Files: holding over a folder browses into it mid-drag; the drop lands you there with the file', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await openFullFiles(page);
  const w = page.locator('.list-wrap:not(.is-panel)');
  const tile = w.locator('.ct-jg [data-item-id]').nth(4);
  const name = await tile.locator('.ct-tile-name').getAttribute('title');
  await startDrag(page, tile);
  await holdOver(page, w.locator('.ft', { hasText: 'Halcyon' }));
  await expect(page.locator('.cb-pagehead-title')).toHaveText('Halcyon');
  await expect(page.locator('.cb-pagehead-trail')).toContainText('Studio');
  await expect(page.locator('.crumb.here')).toContainText('Studio');   // the app hasn't moved yet
  await page.mouse.move(700, 600, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.crumb.here')).toContainText('Halcyon');
  await expect(w.locator(`.ct-tile-name[title="${name}"]`)).toHaveCount(1);
  // Done springing: the way up above the title opens Studio in the app again
  // (not a read-only browse inside Files).
  await page.locator('.cb-pagehead-trail').getByRole('button', { name: 'Studio' }).click();
  await expect(page.locator('.crumb.here')).toContainText('Studio');
  await expect(page.locator('.cb-pagehead-title')).toHaveText('Studio');
});
