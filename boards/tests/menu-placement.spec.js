// Where a right-click menu opens (lib/ctxMenuFit.js placeMenu / placeFlyout):
// at the pointer; flipped to the pointer's left near the right edge and up near
// the bottom; always inside the window by a margin (8px); clamped and
// scrolling inside in a window too short for it; a flyout with no room on the
// right opening to the left of its menu.
//
// The canvas menu on an empty cluster (?local=1&reset=1&blank=1), opened with a
// contextmenu event at a point of the canvas, so the point can be anywhere in
// the window (a corner has the zoom controls, which keep their own menu).
import { expect, test } from '@playwright/test';

const MARGIN = 8;
const menu = (page) => page.locator('.ctx-menu:not(.ctx-submenu)');
const flyout = (page) => page.locator('.ctx-submenu');
const addRow = (page) => menu(page).locator('.ctx-has-submenu')
  .filter({ has: page.locator('.ctx-label', { hasText: /^Add$/ }) });

async function boot(page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
}

// The canvas's right-click at a point of the window. A MouseEvent made in the
// page: Playwright's dispatchEvent makes a plain Event for 'contextmenu', with
// no clientX / clientY.
async function openAt(page, x, y) {
  await page.locator('.canvas-wrap').evaluate((el, [cx, cy]) => {
    el.dispatchEvent(new MouseEvent('contextmenu', { clientX: cx, clientY: cy, bubbles: true, cancelable: true, button: 2 }));
  }, [x, y]);
  await expect(menu(page)).toBeVisible();
}

// A box once it has stopped moving: the menu grows from the pointer when it opens.
async function settled(loc) {
  let prev = null;
  await expect.poll(async () => {
    const b = await loc.boundingBox();
    const same = !!prev && !!b && ['x', 'y', 'width', 'height'].every((k) => Math.abs(b[k] - prev[k]) < 0.5);
    prev = b;
    return same;
  }).toBe(true);
  return prev;
}

function expectInside(b, vw, vh) {
  expect(b.x, 'left').toBeGreaterThanOrEqual(MARGIN - 0.5);
  expect(b.y, 'top').toBeGreaterThanOrEqual(MARGIN - 0.5);
  expect(b.x + b.width, 'right').toBeLessThanOrEqual(vw - MARGIN + 0.5);
  expect(b.y + b.height, 'bottom').toBeLessThanOrEqual(vh - MARGIN + 0.5);
}

test('a menu opens at the pointer', async ({ page }) => {
  await boot(page);
  await openAt(page, 400, 150);
  const b = await settled(menu(page));
  expect(Math.abs(b.x - 400)).toBeLessThanOrEqual(2);
  expect(Math.abs(b.y - 150)).toBeLessThanOrEqual(2);
  expectInside(b, 1440, 900);
});

test('near the right edge it flips to the left of the pointer', async ({ page }) => {
  await boot(page);
  await openAt(page, 1440 - 20, 150);
  const b = await settled(menu(page));
  // Its right edge is where the pointer was.
  expect(Math.abs(b.x + b.width - (1440 - 20))).toBeLessThanOrEqual(2);
  expect(b.x).toBeLessThan(1440 - 20 - 100);
  expectInside(b, 1440, 900);
});

test('near the bottom edge it flips up: its foot is where the pointer was', async ({ page }) => {
  await boot(page);
  await openAt(page, 400, 900 - 20);
  const b = await settled(menu(page));
  expect(Math.abs(b.y + b.height - (900 - 20))).toBeLessThanOrEqual(2);
  expect(Math.abs(b.x - 400)).toBeLessThanOrEqual(2);
  expectInside(b, 1440, 900);
});

test('in the bottom right corner it flips both ways and stays inside', async ({ page }) => {
  await boot(page);
  await openAt(page, 1440 - 24, 900 - 24);
  const b = await settled(menu(page));
  expect(b.x + b.width).toBeLessThanOrEqual(1440 - 24 + 2);
  expect(b.y + b.height).toBeLessThanOrEqual(900 - 24 + 2);
  expectInside(b, 1440, 900);
});

// A point closer to the edge than the margin: placeMenu pulls the point inside
// the 8px margin first, so the flipped menu's own edge never gets closer than 8px.
test('a menu opened at the very edge of the window still stays 8px inside it', async ({ page }) => {
  await boot(page);
  await openAt(page, 1440 - 2, 900 - 2);
  const b = await settled(menu(page));
  expectInside(b, 1440, 900);
});

test('in a short window the menu is clamped, scrolls inside, and fades at its foot', async ({ page }) => {
  await boot(page, 1280, 320);
  await openAt(page, 300, 200);
  const m = menu(page);
  const b = await settled(m);
  expectInside(b, 1280, 320);
  await expect(m).toHaveClass(/is-scrollable/);
  const { scrollH, clientH } = await m.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
  expect(scrollH).toBeGreaterThan(clientH);
  // Rows wait below the fold: the foot fades (useMenuPlacement's mark).
  await expect(m).toHaveClass(/has-more-below/);
  // Scrolled to its end, the fade goes.
  await m.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(m).not.toHaveClass(/has-more-below/);
  // The last row can be reached: it is inside the menu's box once scrolled.
  const last = m.locator('button.ctx-item').last();
  const lb = await last.boundingBox();
  const mb = await m.boundingBox();
  expect(lb.y + lb.height).toBeLessThanOrEqual(mb.y + mb.height + 0.5);
});

test('a flyout opens to the right of its menu when there is room', async ({ page }) => {
  await boot(page);
  await openAt(page, 200, 100);
  const mb = await settled(menu(page));
  await addRow(page).hover();
  await expect(flyout(page)).toBeVisible();
  const fb = await settled(flyout(page));
  expect(fb.x).toBeGreaterThanOrEqual(mb.x + mb.width - 1);
  expectInside(fb, 1440, 900);
});

test('a flyout with no room on the right opens to the left of its menu', async ({ page }) => {
  await boot(page);
  // The menu's width, opened where it fits.
  await openAt(page, 200, 100);
  const w = (await settled(menu(page))).width;
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  // Now as far right as it still fits: no room beside it for a flyout.
  await openAt(page, 1440 - w - MARGIN - 2, 100);
  const mb = await settled(menu(page));
  expect(mb.x + mb.width).toBeLessThanOrEqual(1440 - MARGIN + 0.5);
  await addRow(page).hover();
  await expect(flyout(page)).toBeVisible();
  const fb = await settled(flyout(page));
  expect(fb.x + fb.width).toBeLessThanOrEqual(mb.x + 1);
  expectInside(fb, 1440, 900);
});
