// A right-click menu's submenus, for a screen reader and the keyboard
// (components/ctxMenuParts.jsx CtxSubmenu, in a card's menu and the
// canvas's): the row that opens one is a menu item that says it has a menu
// and whether it's open, and the submenu's rows are menu items; → (or Enter,
// or Space) opens it with its first row focused, ↑ ↓ Home End walk it, and ←
// closes it, back on its row, where ↑ ↓ walk the menu again. On the real
// canvas, through ?local=1.
import { expect, test } from '@playwright/test';

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const menu = (page) => page.locator('.ctx-menu:not(.ctx-submenu)');
const sub = (page) => page.locator('.ctx-submenu');

const MENUS = {
  card: { row: 'Edit', open: (page) => card(page, 'home-image').click({ button: 'right' }) },
  canvas: {
    row: 'Add',
    open: async (page) => {
      // Empty canvas, below the cards.
      const wrap = await page.locator('.canvas-wrap').boundingBox();
      await page.mouse.click(wrap.x + wrap.width - 160, wrap.y + wrap.height - 140, { button: 'right' });
    },
  },
};

for (const [where, { row: name, open }] of Object.entries(MENUS)) {
  test(`the ${where}'s menu: a submenu is menu items, and the keys go in and come back`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?local=1&reset=1');
    await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
    await open(page);
    await expect(menu(page)).toBeVisible();
    const row = menu(page).getByRole('menuitem', { name, exact: true });
    await expect(row).toHaveAttribute('aria-haspopup', 'menu');
    await expect(row).toHaveAttribute('aria-expanded', 'false');

    await row.focus();
    await page.keyboard.press('ArrowRight');
    await expect(sub(page)).toBeVisible();
    await expect(sub(page)).toHaveAttribute('aria-label', name);
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    // Every row of it a menu item.
    const rows = sub(page).getByRole('menuitem');
    expect(await rows.count()).toBeGreaterThan(1);
    expect(await sub(page).locator('button').count()).toBe(await rows.count());
    const live = sub(page).locator('button:not(:disabled)');
    await expect(live.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(live.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(live.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(live.first()).toBeFocused();

    // ← closes it and puts you back on its row; the menu stays, and its keys
    // walk it again.
    await page.keyboard.press('ArrowLeft');
    await expect(sub(page)).toHaveCount(0);
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(row).not.toBeFocused();
    expect(await page.evaluate(() => !!document.activeElement?.closest('.ctx-menu:not(.ctx-submenu)'))).toBe(true);
    await page.keyboard.press('ArrowUp');
    await expect(row).toBeFocused();
    // Enter opens it as well.
    await page.keyboard.press('Enter');
    await expect(live.first()).toBeFocused();
  });
}

test('a tap on the canvas menu\'s submenu row opens it and a second closes it, as on a card\'s', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
  await MENUS.canvas.open(page);
  const row = menu(page).getByRole('menuitem', { name: 'Add', exact: true });
  // Clicked without the pointer passing over it first (a finger has no hover).
  await row.dispatchEvent('click');
  await expect(sub(page)).toBeVisible();
  await row.dispatchEvent('click');
  await expect(sub(page)).toHaveCount(0);
});
