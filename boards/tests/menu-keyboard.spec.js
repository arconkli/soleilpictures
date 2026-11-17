// The right-click menus from the keyboard: the keys that walk a menu (roving
// focus, Home / End, type-ahead, Enter and Space), Esc and where the focus goes
// back to, the quick row as a card menu's first stop, and ⇧F10 / the Menu key
// opening the menu of whatever has the focus: the picked cards or the canvas,
// a sidebar tree row, a Files row.
//
// The submenu → / ← walk and the step-in Back row are ctx-submenu.spec.js and
// mobile/card-menu-phone.spec.js. Placement is menu-placement.spec.js.
//
// The canvas through ?local=1; the sidebar tree and its Files through the
// dev-only QA harness (?sidebarqa=1), which mounts the real ClusterSidebar.
import { expect, test } from '@playwright/test';

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const menu = (page) => page.locator('.ctx-menu:not(.ctx-submenu)');
const rowsOf = (page) => menu(page).locator('button.ctx-item');
const quickBtn = (page, name) => menu(page).locator('.ctx-quick').getByRole('menuitem', { name });
// What the focus is on: a row's label, or a quick button's name.
const focusedName = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a?.querySelector?.('.ctx-label')?.textContent ?? a?.getAttribute?.('aria-label') ?? null;
});

async function bootLocal(page, { blank = false } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?local=1&reset=1${blank ? '&blank=1' : ''}`);
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  if (blank) await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toBeVisible({ timeout: 30000 });
  else await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
}

async function bootSidebar(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?sidebarqa=1');
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.sbf-block').first()).toBeVisible();
}

test.describe('walking a menu', () => {
  test('a card menu is a role=menu of menuitems; the quick row is the first stop and ← → walk it round', async ({ page }) => {
    await bootLocal(page);
    await card(page, 'home-image').click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await expect(menu(page)).toHaveAttribute('role', 'menu');
    expect(await menu(page).getByRole('menuitem').count()).toBeGreaterThan(5);
    // Opened by the mouse: the menu itself holds the focus, and ↓ goes to the first stop.
    await expect(menu(page)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(quickBtn(page, 'Cut')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(quickBtn(page, 'Copy')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(quickBtn(page, 'Duplicate')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(quickBtn(page, /^Delete/)).toBeFocused();
    // Round the ends.
    await page.keyboard.press('ArrowRight');
    await expect(quickBtn(page, 'Cut')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(quickBtn(page, /^Delete/)).toBeFocused();
    // ↓ goes into the list, on its first row.
    await page.keyboard.press('ArrowDown');
    await expect(rowsOf(page).first()).toBeFocused();
  });

  test('↓ and ↑ move one row at a time, Home and End jump to the first stop and the last row, and the focus stays in the menu', async ({ page }) => {
    await bootLocal(page);
    await card(page, 'home-image').click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('ArrowDown');       // Cut
    await page.keyboard.press('ArrowDown');       // the first row
    await expect(rowsOf(page).first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(rowsOf(page).nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(rowsOf(page).first()).toBeFocused();
    // ↑ from the first row goes back up to the quick row.
    await page.keyboard.press('ArrowUp');
    await expect(quickBtn(page, 'Cut')).toBeFocused();
    await page.keyboard.press('End');
    await expect(rowsOf(page).last()).toBeFocused();
    // ↓ from the last row wraps to the first stop.
    await page.keyboard.press('ArrowDown');
    await expect(quickBtn(page, 'Cut')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(quickBtn(page, 'Cut')).toBeFocused();
    expect(await page.evaluate(() => !!document.activeElement?.closest('.ctx-menu'))).toBe(true);
  });

  test('on a menu with no quick row (a cluster\'s), Home is its first row and End its last', async ({ page }) => {
    await bootSidebar(page);
    await page.locator('.sb-tree-row', { hasText: 'Locations' }).first().click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).locator('.ctx-quick')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(rowsOf(page).first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(rowsOf(page).last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(rowsOf(page).first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(rowsOf(page).last()).toBeFocused();
  });

  test('typing letters jumps to the first row whose label starts with them', async ({ page }) => {
    await bootLocal(page);
    await card(page, 'home-image').click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    const labels = await rowsOf(page).locator('.ctx-label').allTextContents();
    // The last row that starts with three plain letters, so the jump is a real one.
    const pick = [...labels].reverse().find((l) => /^[A-Za-z]{3}/.test(l));
    expect(pick, `labels: ${labels.join(' | ')}`).toBeTruthy();
    const prefix = pick.slice(0, 3);
    const want = labels.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()));
    await page.keyboard.type(prefix);
    await expect.poll(() => focusedName(page)).toBe(want);
  });

  test('Enter runs the focused row, and so does Space', async ({ page }) => {
    await bootLocal(page);
    const cards = page.locator('.canvas-wrap .card');
    const before = await cards.count();
    await card(page, 'home-image').click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await quickBtn(page, 'Duplicate').focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveCount(0);
    await expect(cards).toHaveCount(before + 1);

    // The copy lands over the original, picked: its menu this time.
    await page.locator('.canvas-wrap .card.is-selected').click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await quickBtn(page, 'Duplicate').focus();
    await page.keyboard.press('Space');
    await expect(menu(page)).toHaveCount(0);
    await expect(cards).toHaveCount(before + 2);
  });

  test('Enter on a list row of the canvas menu runs it and closes the menu', async ({ page }) => {
    await bootLocal(page, { blank: true });
    // A MouseEvent made in the page: Playwright's dispatchEvent makes a plain
    // Event for 'contextmenu', with no clientX / clientY.
    await page.locator('.canvas-wrap').evaluate((el) => {
      el.dispatchEvent(new MouseEvent('contextmenu', { clientX: 500, clientY: 200, bubbles: true, cancelable: true, button: 2 }));
    });
    await expect(menu(page)).toBeVisible();
    const selectAll = menu(page).getByRole('menuitem', { name: 'Select all', exact: true });
    await selectAll.focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveCount(0);
  });
});

test.describe('Esc, and where the focus goes back to', () => {
  test('Esc closes a card menu and the canvas has the keys again', async ({ page }) => {
    await bootLocal(page);
    await card(page, 'home-image').click();
    // The first stop: the quick row's first button, or the first row where there is no quick row.
    const firstStop = menu(page).locator('.ctx-quick-btn, [role="menuitem"]').first();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    await expect(firstStop).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest?.('.ctx-menu'))).toBe(false);
    // The canvas still gets keys: the same chord opens the menu again.
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
  });

  test('Esc closes the sidebar tree row\'s menu and the row has the focus again', async ({ page }) => {
    await bootSidebar(page);
    const row = page.locator('.sb-tree-row', { hasText: 'Locations' }).first();
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(row).toBeFocused();
  });

  test('Esc closes a Files row\'s menu and the row has the focus again', async ({ page }) => {
    await bootSidebar(page);
    const file = page.locator('.sbf-file', { hasText: 'film-take-2.mov' }).first();
    await file.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(file).toBeFocused();
  });
});

test.describe('⇧F10 and the Menu key', () => {
  for (const key of ['Shift+F10', 'ContextMenu']) {
    test(`${key} on a picked card opens its menu at the card, the quick row focused`, async ({ page }) => {
      await bootLocal(page);
      await card(page, 'home-image').click();
      const b = await card(page, 'home-image').boundingBox();
      await page.keyboard.press(key);
      await expect(menu(page)).toBeVisible();
      await expect(menu(page).locator('.ctx-quick')).toBeVisible();
      // At the card's left edge (and its foot, unless that left no room).
      await expect.poll(async () => Math.abs((await menu(page).boundingBox()).x - b.x)).toBeLessThanOrEqual(2);
      // Opened by a key: the first stop has the focus, not the menu.
      await expect(quickBtn(page, 'Cut')).toBeFocused();
    });
  }

  test('⇧F10 with nothing picked opens the canvas menu at the centre of the canvas', async ({ page }) => {
    await bootLocal(page, { blank: true });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    // The canvas menu: its quick row is the adds, and it lists Select all.
    await expect(menu(page).locator('.ctx-quick')).toBeVisible();
    await expect(menu(page).getByRole('menuitem', { name: 'Select all', exact: true })).toBeVisible();
    const wrap = await page.locator('.canvas-wrap').boundingBox();
    const cx = wrap.x + wrap.width / 2;
    const cy = wrap.y + wrap.height / 2;
    await expect.poll(async () => {
      const m = await menu(page).boundingBox();
      // Right of the centre, and the centre is on the menu's top edge, or on its
      // foot when it had to open upward.
      return Math.abs(m.x - cx) <= 2 && cy >= m.y - 2 && cy <= m.y + m.height + 2;
    }).toBe(true);
    await expect(quickBtn(page, /^Add a note/)).toBeFocused();
  });

  test('⇧F10 on a focused sidebar tree row opens that cluster\'s menu', async ({ page }) => {
    await bootSidebar(page);
    const row = page.locator('.sb-tree-row', { hasText: 'Locations' }).first();
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu', { name: 'Locations', exact: true })).toBeVisible();
    await expect(menu(page).getByRole('menuitem', { name: 'Open', exact: true })).toBeVisible();
  });

  test('the Menu key on a focused sidebar tree row does the same', async ({ page }) => {
    await bootSidebar(page);
    const row = page.locator('.sb-tree-row', { hasText: 'Casting' }).first();
    await row.focus();
    await page.keyboard.press('ContextMenu');
    await expect(page.getByRole('menu', { name: 'Casting', exact: true })).toBeVisible();
  });

  test('⇧F10 on a focused Files row opens that file\'s menu', async ({ page }) => {
    await bootSidebar(page);
    const file = page.locator('.sbf-file', { hasText: 'film-take-2.mov' }).first();
    await file.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    await expect(menu(page)).toHaveAttribute('aria-label', 'film-take-2.mov');
    await expect(menu(page).getByRole('menuitem', { name: 'Quick look', exact: true })).toBeVisible();
  });
});
