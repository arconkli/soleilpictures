// The right-click menus under a finger: on a phone a card's menu and the
// canvas's are a bottom sheet (.ctx-menu.is-sheet in shell/Sheet.jsx) with a
// header that shows what the menu is for, the quick row as four labelled
// tiles, and rows a finger can hit. A submenu steps in (card-menu-phone.spec.js
// has that walk for a card; the canvas's Add is here), and the scrim closes it.
//
// A phone and an upright iPad share the phone's shell (lib/deviceShell.js:
// touch screens up to 1024px wide), so both get the sheet, at most 480px wide
// on the iPad (plan.md §9, 11-17: "Upright iPad (834px) gets the mobile shell,
// so the sheet"); the last test pins it there. An iPad held sideways keeps the
// anchored menu (tablet/card-menu-landscape.spec.js). On the real canvas,
// through ?local=1.
import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch menus');
});

// The sheet is the phone shell's: phones and an upright iPad.
const sheetOnly = (page) => test.skip((page.viewportSize()?.width ?? 0) > 1024, 'a sheet is the phone shell\'s; a wider screen has the anchored menu');

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const sheet = (page) => page.locator('.ctx-menu.is-sheet');
const head = (page) => page.locator('.ctx-sheet-head');
const tiles = (page) => page.locator('.ctx-quick.is-tiles');
const tile = (page, name) => tiles(page).getByRole('menuitem', { name });
const MIN = 44;
const PHONE_ROW = 48;   // the phone sheet's list rows (styles.css, min-height: 48px)

// `viewOnly`: the board as one this person may only look at (the harness's
// &filesrules=1&viewonly=1, LocalBoardsApp.jsx: canEdit false).
async function boot(page, { blank = false, viewOnly = false } = {}) {
  await page.goto(`/?local=1&reset=1${blank ? '&blank=1' : ''}${viewOnly ? '&filesrules=1&viewonly=1' : ''}`);
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  // What only the dev harness draws, over the corner a menu opens in.
  await page.addStyleTag({ content: '.twk-gear { display: none !important; }' });
  if (blank) await expect(page.getByRole('button', { name: 'Free-draw tool', exact: true })).toBeVisible({ timeout: 30000 });
  else await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
}

// A card's menu, the way a finger gets it: tap the card's foot, then its ⋯.
async function openCardSheet(page, id) {
  const b = await card(page, id).boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 6);
  const more = page.locator('.sel-menu .card-menu-btn');
  await expect(more).toBeVisible();
  await more.tap();
  await expect(sheet(page)).toBeVisible();
}

// A finger held still at a point (as card-menu-phone.spec.js: Chromium takes a
// touch PointerEvent made in the page; WebKit drops its pointerType, so there
// the hold is its outcome, the contextmenu).
async function hold(page, x, y, browserName) {
  await page.evaluate(async ({ x, y, webkit }) => {
    const el = document.elementFromPoint(x, y);
    if (webkit) {
      await new Promise((r) => setTimeout(r, 1600));
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      return;
    }
    const ev = (type) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true,
      pointerId: 3, clientX: x, clientY: y, button: 0, buttons: type === 'pointerdown' ? 1 : 0,
    });
    el.dispatchEvent(ev('pointerdown'));
    await new Promise((r) => setTimeout(r, 650));
    el.dispatchEvent(ev('pointerup'));
  }, { x, y, webkit: browserName === 'webkit' });
}

async function openCanvasSheet(page, browserName) {
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  await hold(page, wrap.x + wrap.width * 0.92, wrap.y + 80, browserName);
  await expect(sheet(page)).toBeVisible();
}

test.describe('a card\'s sheet', () => {
  test('its header shows the card: its name and kind', async ({ page }) => {
    sheetOnly(page);
    await boot(page);
    await openCardSheet(page, 'home-link');
    await expect(sheet(page)).toHaveClass(/is-sheet/);
    await expect(head(page).locator('.ctx-sheet-name')).toHaveText('Q4 production calendar');
    await expect(head(page).locator('.ctx-sheet-kind')).toHaveText('Link');
  });

  test('a picture\'s header has its thumb', async ({ page }) => {
    sheetOnly(page);
    await boot(page);
    await openCardSheet(page, 'home-image');
    await expect(head(page).locator('.ctx-sheet-name')).toHaveText('Image');
    await expect(head(page).locator('.ctx-sheet-thumb img')).toHaveCount(1);
  });

  test('the quick row is four labelled tiles, Cut, Copy, Duplicate, Delete, each at least 44px tall', async ({ page }) => {
    sheetOnly(page);
    await boot(page);
    await openCardSheet(page, 'home-note');
    await expect(tiles(page)).toBeVisible();
    await expect(tiles(page).locator('.ctx-quick-label')).toHaveText(['Cut', 'Copy', 'Duplicate', 'Delete']);
    for (const name of ['Cut', 'Copy', 'Duplicate', /^Delete/]) {
      const t = tile(page, name);
      await expect(t).toBeVisible();
      expect((await t.boundingBox()).height, String(name)).toBeGreaterThanOrEqual(MIN);
    }
  });

  test('every row of the list is at least 48px tall', async ({ page }) => {
    sheetOnly(page);
    await boot(page);
    await openCardSheet(page, 'home-image');
    const rows = sheet(page).locator('button.ctx-item');
    expect(await rows.count()).toBeGreaterThan(3);
    for (const r of await rows.all()) {
      expect((await r.boundingBox()).height).toBeGreaterThanOrEqual(PHONE_ROW);
    }
  });

  test('Delete is there without scrolling; it removes the card, and the toast\'s Undo brings it back', async ({ page }) => {
    sheetOnly(page);
    await boot(page);
    await openCardSheet(page, 'home-note');
    // Nothing scrolled, and the tile is inside the window and on top.
    expect(await sheet(page).evaluate((el) => el.scrollTop)).toBe(0);
    const del = tile(page, /^Delete/);
    await expect(del).toBeVisible();
    const b = await del.boundingBox();
    const v = page.viewportSize();
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(v.height);
    expect(await del.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    })).toBe(true);

    await del.tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(card(page, 'home-note')).toHaveCount(0);
    const toast = page.locator('.toast', { hasText: 'Deleted' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).tap();
    await expect(card(page, 'home-note')).toBeVisible();
  });

  test('a tap on the scrim outside the sheet closes it', async ({ page }) => {
    sheetOnly(page);
    await boot(page);
    await openCardSheet(page, 'home-image');
    const panel = await page.locator('.sheet-panel').boundingBox();
    const v = page.viewportSize();
    // Above the sheet, where only the scrim is.
    expect(panel.y, 'the sheet leaves room above it for the scrim').toBeGreaterThan(8);
    await page.touchscreen.tap(v.width / 2, panel.y / 2);
    await expect(sheet(page)).toHaveCount(0);
  });

  // On a cluster you can edit, a hold lifts the card to drag it and its ⋯
  // opens the menu (plan.md §1, decision 12; the ⋯ is the tests above). A
  // viewer has nothing to drag, so their hold opens the card's sheet.
  test('a viewer holding a card opens its sheet', async ({ page, browserName }) => {
    sheetOnly(page);
    await boot(page, { viewOnly: true });
    const b = await card(page, 'home-link').boundingBox();
    await hold(page, b.x + b.width / 2, b.y + b.height / 2, browserName);
    await expect(sheet(page)).toBeVisible();
    await expect(head(page).locator('.ctx-sheet-name')).toHaveText('Q4 production calendar');
  });
});

test.describe('the canvas\'s sheet', () => {
  test('holding empty canvas opens it, with the cluster in its header and five add tiles at least 44px tall', async ({ page, browserName }) => {
    sheetOnly(page);
    await boot(page, { blank: true });
    await openCanvasSheet(page, browserName);
    await expect(head(page).locator('.ctx-sheet-name')).toHaveText('Studio');
    await expect(head(page).locator('.ctx-sheet-kind')).toHaveText('Cluster');
    await expect(tiles(page).getByRole('menuitem')).toHaveCount(5);
    for (const t of await tiles(page).getByRole('menuitem').all()) {
      expect((await t.boundingBox()).height).toBeGreaterThanOrEqual(MIN);
    }
    // The tiles show the plain name of what they add (plan.md §2.3, Phone
    // sheet: "canvas: Note, Image, Cluster, Doc, Link"), and each button's
    // name says what it does.
    await expect(tiles(page).locator('.ctx-quick-label')).toHaveText(['Note', 'Image', 'Cluster', 'Doc', 'Link']);
    const names = await tiles(page).getByRole('menuitem').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(names).toHaveLength(5);
    [/^Add an? note$/i, /^Add an? image$/i, /^Add an? cluster$/i, /^Add an? doc$/i, /^Add an? link$/i]
      .forEach((re, i) => expect(names[i]).toMatch(re));
  });

  test('Add steps in to its rows and a Back row, and Back returns to the list', async ({ page, browserName }) => {
    sheetOnly(page);
    await boot(page, { blank: true });
    await openCanvasSheet(page, browserName);
    const add = sheet(page).locator('.ctx-has-submenu')
      .filter({ has: page.locator('.ctx-label', { hasText: /^Add$/ }) });
    await add.scrollIntoViewIfNeeded();
    await add.tap();
    await expect(sheet(page)).toHaveClass(/is-step/);
    const back = sheet(page).locator('.ctx-item.is-back');
    await expect(back).toHaveAccessibleName('Add, back to the canvas menu');
    for (const name of ['Note', 'Image', 'Cluster', 'Doc']) {
      await expect(sheet(page).getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    await back.tap();
    await expect(sheet(page)).not.toHaveClass(/is-step/);
    await expect(back).toHaveCount(0);
    await expect(sheet(page).getByRole('menuitem', { name: 'Select all', exact: true })).toBeVisible();
  });
});

// An upright iPad (834px) is in the phone's shell on purpose, so a card's ⋯
// opens the sheet there too, its rows a finger tall (plan.md §9, 11-17). The
// anchored menu with finger-sized rows is an iPad held sideways
// (tablet/card-menu-landscape.spec.js).
test('on an upright iPad a card\'s menu is the sheet, and its rows are at least 44px tall', async ({ page }) => {
  test.skip(test.info().project.name !== 'tablet', 'the upright iPad');
  await boot(page);
  await openCardSheet(page, 'home-image');
  await expect(sheet(page)).toHaveClass(/is-sheet/);
  await expect(head(page)).toBeVisible();
  const rows = sheet(page).locator('button.ctx-item');
  expect(await rows.count()).toBeGreaterThan(3);
  for (const r of await rows.all()) {
    expect((await r.boundingBox()).height).toBeGreaterThanOrEqual(MIN);
  }
});
