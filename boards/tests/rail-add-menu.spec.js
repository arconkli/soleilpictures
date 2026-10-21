// The rail's + opens the add menu, and it behaves as a menu does: a press
// anywhere outside it closes it (it used to stay open over the sidebar, the top
// bar and the cards, closing only on the canvas's bare ground, Escape or an
// item), and the keys walk it: focus starts on its first item, ↑ ↓ Home End
// move through them, Esc and Tab close it and hand focus back to +.
import { expect, test } from '@playwright/test';

const plus = (page) => page.locator('.cnv-tools').getByRole('button', { name: 'Add menu', exact: true });
const menu = (page) => page.locator('.cnv-add-menu');
const items = (page) => menu(page).getByRole('menuitem');
const focusedItem = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el?.closest('.cnv-add-menu') ? el.getAttribute('aria-label') : null;
});

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  await page.waitForTimeout(600);
});

test('a press anywhere outside the add menu closes it', async ({ page }) => {
  const outside = [
    ['a card', page.locator('.canvas-wrap .card[data-card-id="home-note"]')],
    // Its "Clusters" heading: a press that opens nothing.
    ['the sidebar', page.locator('.sidebar .sb-eyebrow').first()],
    ['the zoom control', page.locator('.cnv-zoom').first()],
    ['another tool', page.locator('.cnv-tools').getByRole('button', { name: 'Pan tool', exact: true })],
  ];
  for (const [what, target] of outside) {
    await plus(page).click();
    await expect(menu(page), `open, before a press on ${what}`).toBeVisible();
    await target.click({ position: { x: 6, y: 6 } });
    await expect(menu(page), `closed by a press on ${what}`).toHaveCount(0);
  }
  // + still toggles it, and the canvas's own ground still closes it.
  await plus(page).click();
  await plus(page).click();
  await expect(menu(page)).toHaveCount(0);
});

test('the keys walk the add menu, and Esc or Tab hands focus back to +', async ({ page }) => {
  await plus(page).focus();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  const names = await items(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(names.length).toBeGreaterThan(2);
  await expect.poll(() => focusedItem(page)).toBe(names[0]);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focusedItem(page)).toBe(names[1]);
  await page.keyboard.press('End');
  await expect.poll(() => focusedItem(page)).toBe(names.at(-1));
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focusedItem(page)).toBe(names[0]);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focusedItem(page)).toBe(names.at(-1));
  await page.keyboard.press('Home');
  await expect.poll(() => focusedItem(page)).toBe(names[0]);
  // The arrows move focus through the items; none is a Tab stop of its own.
  expect(await items(page).evaluateAll((els) => els.every((el) => el.tabIndex < 0))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(plus(page)).toBeFocused();
  // ↓ on + opens it on its first item, as Enter does.
  await page.keyboard.press('ArrowDown');
  await expect(menu(page)).toBeVisible();
  await expect.poll(() => focusedItem(page)).toBe(names[0]);
  await page.keyboard.press('Tab');
  await expect(menu(page)).toHaveCount(0);
  await expect(plus(page)).toBeFocused();
  // Enter on an item does what a click does.
  await page.keyboard.press('Enter');
  await expect.poll(() => focusedItem(page)).toBe(names[0]);
  const shapeAt = names.indexOf('Shape');
  expect(shapeAt, `Shape among ${names.join(', ')}`).toBeGreaterThan(0);
  for (let i = 0; i < shapeAt; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(() => focusedItem(page)).toBe('Shape');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('.cnv-hint')).toContainText('place a shape');
});

test('opened by the pointer, the menu takes focus without a ring', async ({ page }) => {
  await plus(page).click();
  await expect(menu(page)).toBeVisible();
  const names = await items(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  await expect.poll(() => focusedItem(page)).toBe(names[0]);
  expect(await page.evaluate(() => document.activeElement.matches(':focus-visible'))).toBe(false);
});
