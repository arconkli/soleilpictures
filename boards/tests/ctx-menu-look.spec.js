// The right-click menus in the look "B · Icons + quick row" (the right-click
// rework, 2026-11-17): a card's menu and the canvas's wear the one menu, its
// glass at the canon's 96% (glass-solid) since they open over photos, 32px rows
// of words at 13px, groups split by thin lines with no headers (plan.md §1.3),
// and a shortcut as quiet plain text (no caps per key, plan.md §1.9), which the
// row says to a screen reader in aria-keyshortcuts rather than in its name
// (components/ctxMenuParts.jsx); a submenu's › is the look's caret.
//
// On the real canvas, through ?local=1 (the home cluster's cards).
import { expect, test } from '@playwright/test';

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const menu = (page) => page.locator('.ctx-menu:not(.ctx-submenu)');
const row = (page, name) => menu(page).getByRole('menuitem', { name, exact: true });
// A row that opens a submenu (a menu item that says it has a menu).
const subRow = (page, name) => menu(page).locator('.ctx-has-submenu')
  .filter({ has: page.locator('.ctx-label', { hasText: new RegExp(`^${name}$`) }) });

async function cardMenu(page) {
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

test('a card\'s menu is the look\'s: the glass, 32px rows of words, groups split by lines, no headers', async ({ page }) => {
  await cardMenu(page);
  const m = await style(menu(page), ['borderRadius', 'backgroundColor', 'backdropFilter']);
  expect(m.borderRadius).toBe('10px');
  // Glass, not a solid sheet: some of what's under it shows, blurred.
  expect(alpha(m.backgroundColor)).toBeCloseTo(0.96, 2);
  expect(m.backdropFilter).toContain('blur');
  // Measured once the 0.98 → 1 open scale (plan.md §2.1, Motion) has run.
  await menu(page).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  const info = row(page, 'Info');
  expect((await info.boundingBox()).height).toBe(32);
  expect((await style(info, ['fontWeight'])).fontWeight).toBe('400');
  // The headers (EDIT, ANNOTATE, …) went; thin lines split the groups (plan.md §1.3).
  await expect(menu(page).locator('.ctx-header')).toHaveCount(0);
  expect(await menu(page).locator('.ctx-divider').count()).toBeGreaterThan(0);
});

test('a shortcut is quiet text, and the row says it in aria-keyshortcuts, not in its name', async ({ page }) => {
  await cardMenu(page);
  // Plain text now, no cap per key (plan.md §1.9: "key caps go").
  const info = row(page, 'Info');
  await expect(info).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+I$/);
  await expect(info.locator('.ctx-shortcut')).toHaveText(/^(⌘I|Ctrl\+I)$/);
  await expect(info.locator('.ctx-shortcut kbd')).toHaveCount(0);
  await expect(info.locator('.ctx-shortcut')).toHaveAttribute('aria-hidden', 'true');
  // Duplicate and Delete are quick-row buttons (plan.md §2.3): named by their
  // aria-label, their keys still in aria-keyshortcuts. Delete's is ⌫.
  const dup = row(page, 'Duplicate');
  await expect(dup).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+D$/);
  const del = row(page, 'Delete');
  await expect(del).toHaveAttribute('aria-keyshortcuts', 'Backspace');
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(card(page, 'home-note')).toBeVisible({ timeout: 30000 });
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  // Empty canvas, below the cards.
  await page.mouse.click(wrap.x + wrap.width - 160, wrap.y + wrap.height - 140, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  expect((await style(menu(page), ['borderRadius'])).borderRadius).toBe('10px');
  // "Paste" is "Paste here" on the canvas (plan.md §3, Canvas).
  const paste = menu(page).getByRole('menuitem', { name: 'Paste here', exact: true });
  await expect(paste).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+V$/);
  await expect(paste.locator('.ctx-shortcut')).toHaveText(/^(⌘V|Ctrl\+V)$/);
});
