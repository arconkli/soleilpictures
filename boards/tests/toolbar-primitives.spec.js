// The parts of the toolbar look (components/toolbar/: the owner's pick
// "A · Islands", 2026-10-21), on the dev-only parts sheet (?toolbarqa=1):
// the one tooltip and its key caps, a toggle saying whether it's on, the bar
// as one Tab stop walked by the arrows, and a menu's keys and focus.
import { expect, test } from '@playwright/test';

const dark = '[data-qa-half="dark"]';
const bar = `${dark} [data-qa="format-bar"]`;

test.beforeEach(async ({ page }) => {
  await page.goto('/?toolbarqa=1');
  await page.locator(bar).waitFor();
});

// The host's tooltip (not the static one the sheet draws as a picture).
const liveTip = (page) => page.locator('body > .tl-tip');

test('a mouse resting on a control shows its words and its keys, each in a cap', async ({ page }) => {
  await page.locator(`${bar} button[aria-label="Italic"]`).hover();
  const tip = liveTip(page);
  await expect(tip).toHaveClass(/is-shown/, { timeout: 2000 });
  await expect(tip.locator('span').first()).toHaveText('Italic');
  const caps = tip.locator('kbd');
  await expect(caps).toHaveCount(2);
  await expect(caps.nth(1)).toHaveText('I');
  // The pointer leaves: so does the tooltip.
  await page.mouse.move(5, 5);
  await expect(tip).not.toHaveClass(/is-shown/);
});

test('it waits for a pause, then follows the pointer along the bar at once', async ({ page }) => {
  await page.locator(`${bar} button[aria-label="Underline"]`).hover();
  const tip = liveTip(page);
  // Not on arrival.
  await page.waitForTimeout(150);
  await expect(page.locator('body > .tl-tip.is-shown')).toHaveCount(0);
  await expect(tip).toHaveClass(/is-shown/, { timeout: 2000 });
  await page.locator(`${bar} button[aria-label="Strikethrough"]`).hover();
  await expect(tip.locator('span').first()).toHaveText('Strikethrough', { timeout: 150 });
  // No shortcut, no caps.
  await expect(tip.locator('kbd')).toHaveCount(0);
  await expect(tip).toHaveClass(/is-plain/);
});

test('a press hides it, and a control whose menu is open has none', async ({ page }) => {
  const more = page.locator(`${dark} [data-qa="overflow-bar"] button[aria-label="More"]`);
  await more.hover();
  const tip = liveTip(page);
  await expect(tip).toHaveClass(/is-shown/, { timeout: 2000 });
  await more.click();
  await expect(tip).not.toHaveClass(/is-shown/);
  await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
  await page.mouse.move(5, 5);
  await more.hover();
  await page.waitForTimeout(900);
  await expect(page.locator('body > .tl-tip.is-shown')).toHaveCount(0);
});

test('the bar is one Tab stop; the arrows walk it, and the keyboard gets the tooltip at once', async ({ page }) => {
  await page.locator(`${dark} h1`).click();
  // The static picture's cells come first on the sheet; the bar's first
  // control is the one stop.
  const bold = page.locator(`${bar} button[aria-label="Bold"]`);
  await bold.focus();
  expect(await bold.evaluate((el) => el.tabIndex)).toBe(0);
  expect(await page.locator(`${bar} button[aria-label="Italic"]`).evaluate((el) => el.tabIndex)).toBe(-1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`${bar} button[aria-label="Italic"]`)).toBeFocused();
  const tip = liveTip(page);
  await expect(tip).toHaveClass(/is-shown/);
  await expect(tip.locator('span').first()).toHaveText('Italic');
  await page.keyboard.press('End');
  await expect(page.locator(`${bar} button[aria-label="Comment"]`)).toBeFocused();
  await expect(tip.locator('span').first()).toHaveText('Comment');
  await expect(tip.locator('kbd')).toHaveCount(3);
});

test('a toggle says whether it is on, and lights when it is', async ({ page }) => {
  const bold = page.locator(`${bar} button[aria-label="Bold"]`);
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect(bold).toHaveClass(/is-on/);
  await expect(bold).toHaveAttribute('aria-keyshortcuts', /^(Control|Meta)\+B$/);
  // A button that isn't a toggle says nothing about it.
  await expect(page.locator(`${bar} button[aria-label="Comment"]`)).not.toHaveAttribute('aria-pressed', /.*/);
});

test('a menu opened with a press: the arrows start from the menu, Escape hands the focus back', async ({ page }) => {
  const more = page.locator(`${dark} [data-qa="overflow-bar"] button[aria-label="More"]`);
  await more.click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Strikethrough' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Spellcheck' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'Strikethrough' })).toBeFocused();
  await page.keyboard.press('a');
  await expect(menu.getByRole('menuitem', { name: /^Align/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
});

test('a menu opened from the keyboard puts the focus on its first row; a row picked closes it', async ({ page }) => {
  const more = page.locator(`${dark} [data-qa="overflow-bar"] button[aria-label="More"]`);
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu.getByRole('menuitem', { name: 'Strikethrough' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page.locator(`${dark} [data-qa="picked"]`)).toHaveText('picked: Clear formatting');
  // The row's action left the focus nowhere: it's back on the button.
  await expect(more).toBeFocused();
  // ↓ on the button opens it too.
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Strikethrough' })).toBeFocused();
  // Tab closes it and goes back to the button.
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
});

test('a press outside closes a menu and leaves the focus where it went', async ({ page }) => {
  const more = page.locator(`${dark} [data-qa="overflow-bar"] button[aria-label="More"]`);
  await more.click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu).toBeVisible();
  await page.locator(`${bar} button[aria-label="Italic"]`).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator(`${bar} button[aria-label="Italic"]`)).toBeFocused();
});

test('desktop sizes: 32px buttons in a bar 4px round them, menu rows 32px', async ({ page }) => {
  const b = await page.locator(`${bar} button[aria-label="Bold"]`).boundingBox();
  expect(Math.round(b.height)).toBe(32);
  expect(Math.round(b.width)).toBe(32);
  const barBox = await page.locator(bar).boundingBox();
  expect(Math.round(barBox.height)).toBe(40);
  await page.locator(`${dark} [data-qa="overflow-bar"] button[aria-label="More"]`).click();
  const row = await page.getByRole('menuitem', { name: 'Strikethrough' }).boundingBox();
  expect(Math.round(row.height)).toBe(32);
});
