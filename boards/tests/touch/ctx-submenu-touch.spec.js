// A finger on a card menu's submenus, on an iPad held sideways: the desktop
// layout, so a submenu flies out beside the menu instead of stepping in
// (components/ctxMenuParts.jsx CtxSubmenu). A tap comes with the browser's
// own enter and leave, which opened the flyout a moment before the tap's click
// toggled it shut: only a mouse hovers now. A row of the flyout with a submenu
// of its own (a group's Outline shape) opens a flyout beside that one.
//
// Taps go through page.touchscreen, real touch input on both engines, so the
// compatibility mouse events fire as they do under a finger.
import { expect, test } from '@playwright/test';
import { tap } from './helpers.js';

test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('tablet-landscape'),
    'the desktop layout under a finger; a phone and an upright iPad step in (mobile/card-menu-phone)');
});

const menu = (page) => page.locator('.ctx-menu:not(.ctx-submenu)');
const flyouts = (page) => page.locator('.ctx-submenu');
const named = (page, name) => page.getByRole('menu', { name, exact: true });
const hugOutline = (page) => page.locator('.group-outline.group-hug');

const tapOn = async (page, locator) => {
  const b = await locator.boundingBox();
  await tap(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
};

// Every card of the board in one group, and one card's menu from its ⋯.
async function openGroupedCardMenu(page) {
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  // The board fits itself to its cards once they land; let the camera settle.
  await page.waitForTimeout(900);
  const b = await page.locator('[data-card-id="home-image"]').boundingBox();
  await tap(page, { x: b.x + b.width / 2, y: b.y + b.height - 6 });
  await expect(page.locator('.sel-menu > .card-menu-btn')).toBeVisible();
  // A keyboard paired with the iPad: ⌘A, ⌘G.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');
  await expect(page.locator('.group-label').first()).toBeVisible();
  await expect(hugOutline(page)).toHaveCount(0);
  // One card's menu, not the selection's: the menu of several cards has no
  // Group "Name" › (plan.md §3, Several cards), so the selection goes first.
  await page.keyboard.press('Escape');
  await expect(page.locator('.card.is-selected')).toHaveCount(0);
  await tap(page, { x: b.x + b.width / 2, y: b.y + b.height - 6 });
  await expect(page.locator('.sel-menu > .card-menu-btn')).toBeVisible();
  await tapOn(page, page.locator('.sel-menu > .card-menu-btn'));
  await expect(menu(page)).toBeVisible();
  return menu(page).locator('.ctx-has-submenu', { hasText: /^Group "/ });
}

test('a tap opens a submenu\'s flyout and it stays; a nested row\'s opens beside it; an action runs and closes the menu', async ({ page }) => {
  const groupRow = await openGroupedCardMenu(page);
  await groupRow.scrollIntoViewIfNeeded();
  await tapOn(page, groupRow);
  const group = named(page, /^Group "/);
  await expect(group).toBeVisible();
  // Still open once the tap's own events have all landed, and after the 140ms
  // a mouse's leave would take.
  await page.waitForTimeout(500);
  await expect(group).toBeVisible();
  await expect(flyouts(page)).toHaveCount(1);
  await expect(menu(page)).not.toHaveClass(/is-step/);
  await expect(groupRow).toHaveAttribute('aria-expanded', 'true');

  const shapeRow = group.getByRole('menuitem', { name: 'Outline shape', exact: true });
  await expect(shapeRow).toHaveAttribute('aria-haspopup', 'menu');
  await tapOn(page, shapeRow);
  const shape = named(page, 'Outline shape');
  await expect(shape).toBeVisible();
  await page.waitForTimeout(500);
  await expect(shape).toBeVisible();
  await expect(group).toBeVisible();
  await expect(flyouts(page)).toHaveCount(2);
  // Beside the flyout it opened from, and inside the window.
  const g = await group.boundingBox();
  const s = await shape.boundingBox();
  expect(s.x >= g.x + g.width || s.x + s.width <= g.x, `nested ${s.x}..${s.x + s.width} beside ${g.x}..${g.x + g.width}`).toBe(true);
  expect(s.x).toBeGreaterThanOrEqual(0);
  expect(s.x + s.width).toBeLessThanOrEqual(page.viewportSize().width);
  // On the way the flyout went, not back over the menu.
  const m = await menu(page).boundingBox();
  expect(s.x >= m.x + m.width || s.x + s.width <= m.x, `nested ${s.x}..${s.x + s.width} off the menu ${m.x}..${m.x + m.width}`).toBe(true);

  // Box and Hug are a choice of one, checked (plan.md §3, Group: "Box / Hug, checked").
  await tapOn(page, shape.getByRole('menuitemradio', { name: /^Hug/ }));
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
  await expect(hugOutline(page)).toHaveCount(1);
});

test('a second tap on a submenu row closes its flyout, and a tap on another row\'s swaps them', async ({ page }) => {
  const groupRow = await openGroupedCardMenu(page);
  await groupRow.scrollIntoViewIfNeeded();
  await tapOn(page, groupRow);
  const group = named(page, /^Group "/);
  await expect(group).toBeVisible();
  await page.waitForTimeout(300);
  await tapOn(page, groupRow);
  await expect(flyouts(page)).toHaveCount(0);
  await expect(menu(page)).toBeVisible();

  await tapOn(page, groupRow);
  await expect(group).toBeVisible();
  const arrange = menu(page).locator('.ctx-has-submenu', { hasText: 'Arrange' }).first();
  await arrange.scrollIntoViewIfNeeded();
  await tapOn(page, arrange);
  await expect(named(page, 'Arrange')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(flyouts(page)).toHaveCount(1);
  await expect(named(page, 'Arrange')).toBeVisible();
});
