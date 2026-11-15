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

// A submenu's row with a submenu of its own: a group's Outline shape, in a
// card's Group submenu. Every card of the board in one group (⌘A, ⌘G).
const named = (page, name) => page.getByRole('menu', { name, exact: true });
const hugOutline = (page) => page.locator('.group-outline.group-hug');

async function openGroupedCardMenu(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
  await card(page, 'home-image').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');
  await expect(page.locator('.group-label').first()).toBeVisible();
  await expect(hugOutline(page)).toHaveCount(0);
  await card(page, 'home-image').click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  return menu(page).locator('.ctx-has-submenu', { hasText: /^Group "/ });
}

test('a mouse over a submenu\'s own submenu row opens a flyout beside the flyout, and choosing from it runs it and closes the menu', async ({ page }) => {
  const groupRow = await openGroupedCardMenu(page);
  // Hover opens a flyout, as before.
  await groupRow.hover();
  const group = named(page, /^Group "/);
  await expect(group).toBeVisible();
  const shapeRow = group.getByRole('menuitem', { name: 'Outline shape', exact: true });
  await expect(shapeRow).toHaveAttribute('aria-haspopup', 'menu');
  await expect(shapeRow).toHaveAttribute('aria-expanded', 'false');
  await expect(shapeRow.locator('.ctx-chevron')).toBeVisible();

  await shapeRow.hover();
  const shape = named(page, 'Outline shape');
  await expect(shape).toBeVisible();
  await expect(shapeRow).toHaveAttribute('aria-expanded', 'true');
  // Beside the flyout it is in, on one side or the other, and in the window.
  const g = await group.boundingBox();
  const s = await shape.boundingBox();
  expect(s.x >= g.x + g.width || s.x + s.width <= g.x, `nested ${s.x}..${s.x + s.width} beside ${g.x}..${g.x + g.width}`).toBe(true);
  expect(s.x).toBeGreaterThanOrEqual(0);
  expect(s.x + s.width).toBeLessThanOrEqual(1440);
  // On the flyout's far side while the window has the room there; flipped to
  // its near side, over the menu, when it doesn't.
  const roomRight = g.x + g.width + 204 <= 1440 - 8;
  expect(roomRight ? s.x >= g.x + g.width : s.x + s.width <= g.x).toBe(true);

  // The pointer travels into it, and stays: nothing closes behind it.
  const hug = shape.getByRole('menuitem', { name: /^Hug/ });
  await hug.hover();
  await page.waitForTimeout(400);
  await expect(shape).toBeVisible();
  await expect(group).toBeVisible();
  await expect(menu(page)).toBeVisible();

  await hug.click();
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
  await expect(hugOutline(page)).toHaveCount(1);
});

test('a mouse leaving a nested flyout\'s row closes the nested flyout and keeps the flyout', async ({ page }) => {
  const groupRow = await openGroupedCardMenu(page);
  await groupRow.hover();
  const group = named(page, /^Group "/);
  await group.getByRole('menuitem', { name: 'Outline shape', exact: true }).hover();
  await expect(named(page, 'Outline shape')).toBeVisible();
  await group.getByRole('menuitem', { name: 'Group info', exact: true }).hover();
  await expect(named(page, 'Outline shape')).toHaveCount(0);
  await expect(group).toBeVisible();
});

test('a click on a nested submenu row opens it and a second closes it', async ({ page }) => {
  const groupRow = await openGroupedCardMenu(page);
  // Clicked without the pointer passing over them first.
  await groupRow.dispatchEvent('click');
  const group = named(page, /^Group "/);
  await expect(group).toBeVisible();
  const shapeRow = group.getByRole('menuitem', { name: 'Outline shape', exact: true });
  await shapeRow.dispatchEvent('click');
  await expect(named(page, 'Outline shape')).toBeVisible();
  await expect(group).toBeVisible();
  await shapeRow.dispatchEvent('click');
  await expect(named(page, 'Outline shape')).toHaveCount(0);
  await expect(group).toBeVisible();
  // Another row's flyout takes the first one's place.
  await menu(page).locator('.ctx-has-submenu', { hasText: 'Arrange' }).first().dispatchEvent('click');
  await expect(named(page, 'Arrange')).toBeVisible();
  await expect(group).toHaveCount(0);
});

test('the keys open a nested flyout, ← closes one level at a time, and Escape closes the menu', async ({ page }) => {
  const groupRow = await openGroupedCardMenu(page);
  await groupRow.focus();
  await page.keyboard.press('ArrowRight');
  const group = named(page, /^Group "/);
  await expect(group.locator('button:not(:disabled)').first()).toBeFocused();
  const shapeRow = group.getByRole('menuitem', { name: 'Outline shape', exact: true });
  for (let i = 0; i < 12 && !(await shapeRow.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(shapeRow).toBeFocused();

  await page.keyboard.press('ArrowRight');
  const shape = named(page, 'Outline shape');
  await expect(shape).toBeVisible();
  await expect(shape.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(shape.getByRole('menuitem').nth(1)).toBeFocused();

  // ← closes the nested one, back on its row; the flyout stays.
  await page.keyboard.press('ArrowLeft');
  await expect(shape).toHaveCount(0);
  await expect(group).toBeVisible();
  await expect(shapeRow).toBeFocused();
  // Enter and Space open it too.
  await page.keyboard.press('Enter');
  await expect(shape.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press(' ');
  await expect(shape.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(shapeRow).toBeFocused();
  // ← again closes the flyout, back on the menu's row.
  await page.keyboard.press('ArrowLeft');
  await expect(group).toHaveCount(0);
  await expect(groupRow).toBeFocused();
  await expect(menu(page)).toBeVisible();

  // Escape, two levels in, closes the menu.
  await page.keyboard.press('ArrowRight');
  await shapeRow.focus();
  await page.keyboard.press('ArrowRight');
  await expect(shape).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
});
