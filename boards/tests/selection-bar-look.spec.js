// The selection's bar in the toolbar look (the owner's pick "A · Islands",
// mockup A-select), shipped 2026-10-25 (lib/appHost.js toolbarLookAllowed;
// components/toolbar/SelectionBarA.jsx): two or more cards picked on a desktop
// canvas get, on the bottom row, what right-clicking one of them offers, each
// control the card menu's own item: Tidy up, Align (and Distribute), Group, Tag
// (its picker, 2026-10-26), New cluster from N cards, Move N cards to…; ⋯ is
// that menu itself, over the bar, and Delete is ⌫'s, with its undo. Today's
// look keeps the count at the top.
//
// On the real canvas, through ?local=1 (the home cluster's cards).
import { expect, test } from '@playwright/test';

const look = (page, on) => page.addInitScript((v) => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', v); } catch (_) {}
}, on ? '1' : '0');
const bar = (page) => page.getByRole('toolbar', { name: 'Selection' });
const button = (page, name) => bar(page).getByRole('button', { name, exact: true });
const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const PICKED = ['home-note', 'home-pal', 'home-image'];
const names = (loc) => loc.locator('button')
  .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()));
const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// The note, the palette and the image on the home cluster, picked.
async function threePicked(page, on = true) {
  await look(page, on);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(card(page, 'home-note')).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  // By a corner, clear of what's on a card (the note's text), but the image
  // by its middle: its corner is its caption's +.
  const at = (id) => (id === 'home-image' ? {} : { position: { x: 6, y: 6 } });
  await card(page, PICKED[0]).click(at(PICKED[0]));
  for (const id of PICKED.slice(1)) await card(page, id).click({ ...at(id), modifiers: ['Shift'] });
  await expect(page.locator('.card.is-selected')).toHaveCount(3);
}
const lefts = (page) => page.evaluate((ids) => ids.map((id) => {
  const el = document.querySelector(`[data-card-id="${id}"]`);
  return Math.round(parseFloat(el.style.left));
}), PICKED);

test('three cards picked: the count, then Tidy up, Align, Group, Tag, New cluster, Move, More and Delete, by name', async ({ page }) => {
  await threePicked(page);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText('3 selected');
  await expect(page.locator('.cnv-selcount')).toHaveCount(0);
  expect(await names(bar(page))).toEqual(['Tidy up', 'Align', 'Group', 'Tag', 'New cluster from 3 cards', 'Move 3 cards to…',
    'More', 'Delete']);
  await expect(button(page, 'Group')).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+G$/);
  await expect(button(page, 'Delete')).toHaveAttribute('aria-keyshortcuts', 'Backspace');
  // On the bottom row, clear of the rail and the zoom.
  const [b, rail, zoom, wrap] = await Promise.all([bar(page).boundingBox(), page.locator('.cnv-tools').boundingBox(),
    page.locator('.cnv-zoom').boundingBox(), page.locator('.canvas-wrap').boundingBox()]);
  expect(meets(b, rail)).toBe(false);
  expect(meets(b, zoom)).toBe(false);
  expect(wrap.y + wrap.height - (b.y + b.height)).toBeLessThan(30);
});

test('Tidy up\'s and Align\'s menus are the card menu\'s, and Align lines the cards up', async ({ page }) => {
  await threePicked(page);
  await button(page, 'Tidy up').click();
  const tidy = page.getByRole('menu', { name: 'Tidy up' });
  await expect(tidy.getByRole('menuitem')).toHaveText(['Justified rows', 'Masonry columns', 'Grid', 'Single row',
    'Single column']);
  await page.keyboard.press('Escape');
  await expect(tidy).toHaveCount(0);
  await button(page, 'Align').click();
  const align = page.getByRole('menu', { name: 'Align' });
  await expect(align.getByRole('menuitem')).toHaveText(['Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom',
    'Horizontally', 'Vertically']);
  expect(new Set(await lefts(page)).size).toBeGreaterThan(1);
  await align.getByRole('menuitem', { name: 'Left', exact: true }).click();
  await expect.poll(async () => new Set(await lefts(page)).size).toBe(1);
  // Still picked, so the bar stays for the next step.
  await expect(bar(page)).toContainText('3 selected');
});

test('Group asks for a name, as the card menu\'s does, and groups them', async ({ page }) => {
  await threePicked(page);
  const labels = page.locator('.group-label');
  await expect(labels).toHaveCount(0);
  await button(page, 'Group').click();
  const dialog = page.getByRole('dialog', { name: 'Group these cards' });
  await dialog.getByRole('textbox').fill('Moodboard');
  await dialog.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(labels).toHaveCount(1);
  await expect(labels).toContainText('Moodboard');
});

test('Delete takes the three away with an undo, and Undo brings them back', async ({ page }) => {
  await threePicked(page);
  await button(page, 'Delete').click();
  for (const id of PICKED) await expect(card(page, id)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  for (const id of PICKED) await expect(card(page, id)).toHaveCount(1);
});

test('More opens the right-click menu itself, over the bar', async ({ page }) => {
  await threePicked(page);
  await button(page, 'More').click();
  const menu = page.locator('.ctx-menu').first();
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Delete (3)');
  const [m, b] = await Promise.all([menu.boundingBox(), bar(page).boundingBox()]);
  expect(m.y + m.height).toBeLessThanOrEqual(b.y + 1);
});

test('Escape closes a menu, and then lets go of the selection', async ({ page }) => {
  await threePicked(page);
  await button(page, 'Tidy up').click();
  await expect(page.getByRole('menu', { name: 'Tidy up' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Tidy up' })).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.card.is-selected')).toHaveCount(0);
});

test('the arrows walk the bar, and leave the cards where they are', async ({ page }) => {
  await threePicked(page);
  const before = await lefts(page);
  await button(page, 'Tidy up').click();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Tidy up')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(button(page, 'Align')).toBeFocused();
  await page.keyboard.press('End');
  await expect(button(page, 'Delete')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(button(page, 'Tidy up')).toBeFocused();
  expect(await lefts(page)).toEqual(before);
  // ⌫ from the bar is still the canvas's, on the selection.
  await page.keyboard.press('Backspace');
  for (const id of PICKED) await expect(card(page, id)).toHaveCount(0);
});

test('today\'s look keeps the count at the top, and no bar', async ({ page }) => {
  await threePicked(page, false);
  await expect(page.locator('.cnv-selcount')).toHaveText('3 selected');
  await expect(bar(page)).toHaveCount(0);
});
