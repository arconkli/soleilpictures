// The right-click menus in the toolbar look (the owner's pick "A · Islands"),
// held to a dev opt-in (lib/appHost.js): a card's menu and the canvas's wear
// the look's menu, its glass at the tooltip's 94% since they open over
// photos, rows of words at 13px, and a shortcut a cap per key, which the row
// says to a screen reader in aria-keyshortcuts rather than in its name
// (components/ctxMenuParts.jsx); a submenu's › is the look's caret. Today's
// look keeps today's: solid, the shortcut in words, the › glyph.
//
// On the real canvas, through ?local=1 (the home cluster's cards).
import { expect, test } from '@playwright/test';

const look = (page, on) => page.addInitScript((v) => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', v); } catch (_) {}
}, on ? '1' : '0');
const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const menu = (page) => page.locator('.ctx-menu:not(.ctx-submenu)');
const row = (page, name) => menu(page).getByRole('menuitem', { name, exact: true });
// A row that opens a submenu is a button in a menu, as it has been.
const subRow = (page, name) => menu(page).locator('.ctx-has-submenu')
  .filter({ has: page.locator('.ctx-label', { hasText: new RegExp(`^${name}$`) }) });

async function cardMenu(page, on = true) {
  await look(page, on);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  await card(page, 'home-image').click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
}
// A computed colour's alpha: "oklab(… / 0.94)", "rgba(…, 0.94)", or 1.
function alpha(c) {
  const slash = c.match(/\/\s*([\d.]+)\)$/);
  if (slash) return Number(slash[1]);
  const rgba = c.match(/^rgba\([^)]*,\s*([\d.]+)\)$/);
  return rgba ? Number(rgba[1]) : 1;
}
const style = (loc, props) => loc.evaluate((el, ps) => {
  const cs = getComputedStyle(el);
  return Object.fromEntries(ps.map((p) => [p, cs[p]]));
}, props);

test('a card\'s menu is the look\'s: the glass, 32px rows of words, the headers in small caps', async ({ page }) => {
  await cardMenu(page);
  const m = await style(menu(page), ['borderRadius', 'backgroundColor', 'backdropFilter']);
  expect(m.borderRadius).toBe('10px');
  // Glass, not a solid sheet: some of what's under it shows, blurred.
  expect(alpha(m.backgroundColor)).toBeCloseTo(0.94, 2);
  expect(m.backdropFilter).toContain('blur');
  const dup = row(page, 'Duplicate');
  expect((await dup.boundingBox()).height).toBe(32);
  expect((await style(dup, ['fontWeight'])).fontWeight).toBe('400');
  const head = menu(page).locator('.ctx-header').first();
  expect(await style(head, ['fontWeight', 'textTransform'])).toEqual({ fontWeight: '600', textTransform: 'uppercase' });
});

test('a shortcut is a cap per key, and the row says it in aria-keyshortcuts, not in its name', async ({ page }) => {
  await cardMenu(page);
  const dup = row(page, 'Duplicate');
  await expect(dup).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+D$/);
  const caps = dup.locator('.ctx-shortcut kbd');
  await expect(caps).toHaveText([/^(⌘|Ctrl)$/, 'D']);
  await expect(dup.locator('.ctx-shortcut')).toHaveAttribute('aria-hidden', 'true');
  // Delete's is ⌫, one cap.
  const del = menu(page).getByRole('menuitem', { name: /^Delete/ });
  await expect(del).toHaveAttribute('aria-keyshortcuts', 'Backspace');
  await expect(del.locator('.ctx-shortcut kbd')).toHaveText(['⌫']);
  // A row with no shortcut carries none.
  await expect(row(page, 'Download')).not.toHaveAttribute('aria-keyshortcuts', /.*/);
});

test('a submenu opens in the same glass, its row marked by the look\'s caret', async ({ page }) => {
  await cardMenu(page);
  const edit = subRow(page, 'Edit');
  await expect(edit.locator('svg.ctx-chevron')).toHaveCount(1);
  await edit.hover();
  const sub = page.locator('.ctx-submenu');
  await expect(sub).toBeVisible();
  expect((await style(sub, ['borderRadius'])).borderRadius).toBe('10px');
  await expect(sub.locator('.ctx-item').first()).toBeVisible();
});

test('the canvas\'s menu wears it too', async ({ page }) => {
  await look(page, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(card(page, 'home-note')).toBeVisible({ timeout: 30000 });
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  // Empty canvas, below the cards.
  await page.mouse.click(wrap.x + wrap.width - 160, wrap.y + wrap.height - 140, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  expect((await style(menu(page), ['borderRadius'])).borderRadius).toBe('10px');
  const paste = menu(page).getByRole('menuitem', { name: 'Paste', exact: true });
  await expect(paste).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+V$/);
  await expect(paste.locator('.ctx-shortcut kbd')).toHaveText([/^(⌘|Ctrl)$/, 'V']);
});

test('today\'s look keeps today\'s menu: solid, the shortcut in words, the › glyph', async ({ page }) => {
  await cardMenu(page, false);
  const m = await style(menu(page), ['borderRadius', 'backgroundColor']);
  expect(m.borderRadius).not.toBe('10px');
  expect(alpha(m.backgroundColor)).toBe(1);
  const dup = menu(page).getByRole('menuitem', { name: /^Duplicate/ });
  await expect(dup.locator('.ctx-shortcut')).toHaveText(/^(⌘|Ctrl\+)D$/);
  await expect(dup.locator('kbd')).toHaveCount(0);
  await expect(dup).not.toHaveAttribute('aria-keyshortcuts', /.*/);
  await expect(subRow(page, 'Edit').locator('.ctx-chevron')).toHaveText('›');
});
