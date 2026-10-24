// The top islands and the comments toggle in the toolbar look (the owner's
// pick "A · Islands", the top of mockup A-select), held to a dev opt-in
// (lib/appHost.js): FloatingChrome's islands wear the bars' glass, with 28px
// buttons, regular icons, hairlines between the groups and the glass tooltip
// with the shortcut's keys; ⋯ is the look's menu (ChromeMoreA.jsx); the
// comments toggle is a small island of its own. The islands keep their place
// and size, which the toasts and the template tray line up to. Today's look
// keeps today's.
//
// The islands on the sidebar harness (?sidebarqa=1, App's markup for them);
// the comments toggle on the real canvas (?local=1).
import { expect, test } from '@playwright/test';

const look = (page, on) => page.addInitScript((v) => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', v); } catch (_) {}
}, on ? '1' : '0');
async function islands(page, on = true) {
  await look(page, on);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?sidebarqa=1');
  await page.waitForSelector('[data-sidebarqa-ready]');
  // ⋯ itself, not the stand-in that holds its place while its chunk loads.
  await page.locator('.chrome-right .chrome-more-btn:not([aria-disabled])').waitFor();
}
const right = (page) => page.locator('.chrome-right');
const box = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());

test('the islands keep their place and size, in the bars\' glass', async ({ page }) => {
  await islands(page);
  const main = await box(page.locator('main.main'));
  for (const sel of ['.chrome-left', '.chrome-right']) {
    const b = await box(page.locator(sel));
    expect(b.top - main.top, sel).toBe(8);
    expect(b.height, sel).toBe(36);
  }
  expect((await box(page.locator('.chrome-left'))).left - main.left).toBe(10);
  expect(main.right - (await box(right(page))).right).toBe(10);
  // The glass is a layer under the controls, not the island's own background.
  const glass = await right(page).evaluate((el) => ({
    own: getComputedStyle(el).backgroundColor,
    layer: getComputedStyle(el, '::before').backgroundColor,
    blur: getComputedStyle(el, '::before').backdropFilter,
  }));
  expect(glass.own).toBe('rgba(0, 0, 0, 0)');
  expect(glass.layer).not.toBe('rgba(0, 0, 0, 0)');
  expect(glass.blur).toContain('blur');
});

test('28px buttons with 16px icons, Share in words, and a hairline between the groups', async ({ page }) => {
  await islands(page);
  for (const name of ['Undo', 'Search', 'Toggle theme', 'More']) {
    const b = await box(right(page).getByRole('button', { name, exact: true }));
    expect([b.width, b.height], name).toEqual([28, 28]);
    const icon = await right(page).getByRole('button', { name, exact: true }).locator('svg').evaluate((el) => el.getBoundingClientRect().width);
    expect(icon, name).toBe(16);
  }
  const share = right(page).getByRole('button', { name: 'Share this cluster' });
  await expect(share).toHaveText('Share');
  expect((await box(share)).height).toBe(28);
  // undo, redo | search …: the hairline after Redo; and one before ⋯.
  const after = await right(page).getByRole('button', { name: 'Redo' }).evaluate((el) => getComputedStyle(el, '::after').height);
  expect(after).toBe('16px');
  const before = await page.locator('.chrome-right .chrome-more').evaluate((el) => getComputedStyle(el, '::before').height);
  expect(before).toBe('16px');
});

test('a button\'s tooltip is the glass one, with its shortcut\'s keys', async ({ page }) => {
  await islands(page);
  const undo = right(page).getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).not.toHaveAttribute('title', /.*/);
  await expect(undo).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+Z$/);
  await undo.hover();
  const tip = page.locator('.tl-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Undo');
  await expect(tip.locator('.tl-keys')).toHaveText(/^(⌘|Ctrl)Z$/);
});

test('⋯ is the look\'s menu, under the island and lined up with it', async ({ page }) => {
  await islands(page);
  const more = right(page).getByRole('button', { name: 'More', exact: true });
  await more.click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu).toHaveClass(/tl-menu/);
  await expect(menu.getByRole('menuitem')).toHaveText(['Version history', 'Deleted clusters', 'Help & feedback']);
  const [m, b] = await Promise.all([box(menu), box(more)]);
  expect(m.top).toBeGreaterThan(b.bottom);
  expect(Math.abs(m.right - b.right)).toBeLessThanOrEqual(1);
  await menu.getByRole('menuitem', { name: 'Deleted clusters' }).click();
  await expect(page.getByTestId('sbqa-log')).toContainText('trash');
  await expect(menu).toHaveCount(0);
});

// The keyboard can reach ⋯ while its stand-in still holds the place (a slow
// line, a keyboard that's quick off the mark): when the menu comes, the
// keyboard is on it, not dropped to the page with the stand-in.
test('the keyboard on ⋯ before its menu has loaded is on ⋯ when the menu comes', async ({ page }) => {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(/\/src\/components\/chrome\/ChromeMoreA\.jsx/, async (route) => { await held; await route.continue(); });
  await look(page, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?sidebarqa=1');
  await page.waitForSelector('[data-sidebarqa-ready]');
  const standIn = right(page).locator('.chrome-more-btn[aria-disabled="true"]');
  await expect(standIn).toBeVisible();
  await right(page).getByRole('button', { name: 'Undo', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(standIn).toBeFocused();
  release();
  const more = right(page).locator('.chrome-more-btn:not([aria-disabled])');
  await expect(more).toBeVisible();
  await expect(more).toBeFocused();
  // And the bar's keys go on from there: round to its first.
  await page.keyboard.press('ArrowRight');
  await expect(more).not.toBeFocused();
  expect(await right(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

test('today\'s look keeps today\'s islands: titles, the island\'s own menu', async ({ page }) => {
  await islands(page, false);
  await expect(right(page).getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute('title', 'Undo (⌘Z)');
  await right(page).getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.locator('.chrome-menu')).toBeVisible();
  await expect(page.locator('.tl-menu')).toHaveCount(0);
  expect((await box(right(page).getByRole('button', { name: 'Undo', exact: true }))).height).toBe(30);
});

test('the comments toggle is a small island over the rail, named for what it does', async ({ page }) => {
  await look(page, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('[data-card-id="home-note"]')).toBeVisible({ timeout: 30000 });
  const eye = page.getByRole('button', { name: /^Hide all comments/ });
  await expect(eye).toHaveClass(/cnv-comments-eye/);
  const [e, rail] = await Promise.all([box(eye), box(page.locator('.cnv-tools'))]);
  expect([e.width, e.height]).toEqual([32, 32]);
  expect(e.left).toBe(rail.left);
  expect(e.bottom).toBeLessThan(rail.top);
  await eye.click();
  await expect(page.getByRole('button', { name: /^Show all comments/ })).toHaveClass(/is-muted/);
});
