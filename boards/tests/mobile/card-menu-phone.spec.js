// The card and canvas menus on a phone.
//
// A phone has no room beside a menu, so a submenu steps in (ctxMenuParts.jsx,
// as the doc menus do: menu-step-in.spec.js) instead of flying out past the
// right edge; a card's menu puts Delete on its first screen; drawings that are
// selected can be deleted from the canvas menu; and a photo opens full size
// from its menu. On the real canvas, through ?local=1.

import { expect, test } from '@playwright/test';
import { bootSignedIn } from '../helpers/signedInStub.js';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch menus');
});

// The cases that set a phone's screen size. An iPad held upright has the same
// shell (submenus step in there too), and runs the ones that take the
// device's own screen.
const phoneOnly = () => test.skip(test.info().project.name === 'tablet', 'phone-width only (≤640px)');

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const menu = (page) => page.locator('.ctx-menu');
const row = (page, name) => menu(page).getByRole('menuitem', { name, exact: true });

async function boot(page, { width, height, blank = false } = {}) {
  if (width) await page.setViewportSize({ width, height });
  await page.goto(`/?local=1&reset=1${blank ? '&blank=1' : ''}`);
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  // What only the dev harness draws, over the corner a menu opens in.
  await page.addStyleTag({ content: '.twk-gear { display: none !important; }' });
  if (blank) await expect(page.getByRole('button', { name: 'Free-draw tool', exact: true })).toBeVisible({ timeout: 30000 });
  else await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
}

// A card's menu, the way a finger gets it: tap the card, then its ⋯.
async function openCardMenu(page, id) {
  const b = await card(page, id).boundingBox();
  // Its foot: a note's middle is its text.
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 6);
  const more = page.locator('.sel-menu .card-menu-btn');
  await expect(more).toBeVisible();
  await more.tap();
  await expect(menu(page)).toBeVisible();
}

// A finger held still at a point. Chromium takes a touch PointerEvent made in
// the page; Playwright's WebKit drops pointerType from one (see
// long-press.spec.js), so there the hold is its outcome, the contextmenu.
async function hold(page, x, y, browserName) {
  await page.evaluate(async ({ x, y, webkit }) => {
    const el = document.elementFromPoint(x, y);
    if (webkit) {
      // Past the window in which the canvas reads a contextmenu as the echo
      // of the tap before it (isTouchContextMenu).
      await new Promise((r) => setTimeout(r, 1600));
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      return;
    }
    const ev = (type) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true,
      pointerId: 3, clientX: x, clientY: y, button: 0, buttons: type === 'pointerdown' ? 1 : 0,
    });
    el.dispatchEvent(ev('pointerdown'));
    await new Promise((r) => setTimeout(r, 650));
    el.dispatchEvent(ev('pointerup'));
  }, { x, y, webkit: browserName === 'webkit' });
}

// The whole menu, inside the window.
async function expectOnScreen(page) {
  await expect.poll(async () => {
    const b = await menu(page).boundingBox();
    const v = page.viewportSize();
    return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= v.width + 0.5 && b.y + b.height <= v.height + 0.5;
  }).toBe(true);
}

// One menu box, stepped into `name`: ‹ name, a hairline, its rows, 44px each.
async function expectStepped(page, name, root) {
  await expect(menu(page)).toHaveCount(1);
  await expect(page.locator('.ctx-submenu')).toHaveCount(0);
  await expect(menu(page)).toHaveClass(/is-step/);
  await expect(menu(page)).toHaveAttribute('aria-label', name);
  const rows = menu(page).getByRole('menuitem');
  await expect(rows.first()).toHaveClass(/is-back/);
  await expect(rows.first()).toHaveAccessibleName(`${name}, back to the ${root}`);
  await expect(menu(page).locator('.ctx-divider').first()).toBeVisible();
  expect(await menu(page).locator('.ctx-step-body button.ctx-item').count()).toBeGreaterThan(1);
  for (const r of await rows.all()) {
    expect((await r.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await expectOnScreen(page);
}

// null: the device's own screen (a phone's, or an upright iPad's).
for (const size of [null, [390, 844], [375, 667], [320, 568]]) {
  const [width, height] = size || [];
  test(`a card's Arrange steps in and stays on ${size ? `a ${width}px` : 'the device\'s own'} screen, and ‹ brings the menu back`, async ({ page }) => {
    if (size) phoneOnly();
    await boot(page, { width, height });
    await openCardMenu(page, 'home-image');
    await expectOnScreen(page);
    await menu(page).locator('.ctx-has-submenu', { hasText: 'Arrange' }).first().tap();
    await expectStepped(page, 'Arrange', 'card menu');
    await expect(row(page, 'Bring to front')).toBeVisible();
    await expect(row(page, 'Send to back')).toBeVisible();

    await menu(page).locator('.ctx-item.is-back').tap();
    await expect(menu(page)).not.toHaveClass(/is-step/);
    await expect(menu(page).locator('.ctx-item.is-back')).toHaveCount(0);
    await expect(menu(page).getByRole('menuitem', { name: /^Duplicate/ })).toHaveCount(1);
    // Back on the row that stepped in.
    await expect(menu(page).locator('.ctx-has-submenu', { hasText: 'Arrange' }).first()).toBeFocused();
    await expectOnScreen(page);

    // Escape goes back a level first, then closes.
    await menu(page).locator('.ctx-has-submenu', { hasText: 'Arrange' }).first().tap();
    await expect(menu(page)).toHaveClass(/is-step/);
    await page.keyboard.press('Escape');
    await expect(menu(page)).not.toHaveClass(/is-step/);
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
  });
}

test('the canvas menu\'s Export steps in and stays on screen', async ({ page, browserName }) => {
  phoneOnly();
  await boot(page, { width: 320, height: 568 });
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  // Empty canvas, top right (as long-press.spec.js).
  await hold(page, wrap.x + wrap.width * 0.92, wrap.y + 80, browserName);
  await expect(menu(page)).toBeVisible();
  await expectOnScreen(page);
  const exportRow = menu(page).locator('.ctx-has-submenu', { hasText: 'Export' });
  await exportRow.scrollIntoViewIfNeeded();
  await exportRow.tap();
  await expectStepped(page, 'Export', 'canvas menu');
  await expect(row(page, 'PNG image')).toBeVisible();
  await menu(page).locator('.ctx-item.is-back').tap();
  await expect(menu(page)).not.toHaveClass(/is-step/);
  await expect(exportRow).toBeFocused();
  // And where it was: the menu is scrolled back to the row, not to its top.
  await expect.poll(async () => {
    const m = await menu(page).boundingBox();
    const r = await exportRow.boundingBox();
    return !!m && !!r && r.y >= m.y - 0.5 && r.y + r.height <= m.y + m.height + 0.5;
  }).toBe(true);
});

// A photo's menu is the long one; a note's the short one.
for (const id of ['home-note', 'home-image']) {
  for (const [width, height] of [[393, 727], [375, 667], [320, 568]]) {
    test(`Delete is on the first screen of the ${id} menu at ${width}x${height}`, async ({ page }) => {
      phoneOnly();
      await boot(page, { width, height });
      await openCardMenu(page, id);
      const del = menu(page).getByRole('menuitem', { name: /^Delete/ });
      await expect(del).toBeVisible();
      // Right after Duplicate.
      const names = await menu(page).locator('button.ctx-item').allTextContents();
      const at = names.findIndex((n) => n.startsWith('Duplicate'));
      expect(at).toBeGreaterThan(-1);
      expect(names[at + 1]).toMatch(/^Delete/);
      // Inside the menu with nothing scrolled, and clear of the fade at its
      // foot (36px, styles.css).
      await expectOnScreen(page);
      expect(await menu(page).evaluate((m) => m.scrollTop)).toBe(0);
      const d = await del.boundingBox();
      const m = await menu(page).boundingBox();
      expect(d.y).toBeGreaterThanOrEqual(m.y);
      expect(d.y + d.height).toBeLessThanOrEqual(m.y + m.height - 36);
    });
  }
}

test('a scrolling menu fades at its foot while more rows wait, and not at its end', async ({ page }) => {
  phoneOnly();
  await boot(page, { width: 320, height: 568 });
  await openCardMenu(page, 'home-image');
  await expect(menu(page)).toHaveClass(/has-more-below/);
  await menu(page).evaluate((m) => { m.scrollTop = m.scrollHeight; });
  await expect(menu(page)).not.toHaveClass(/has-more-below/);
});

test('a selected drawing is deleted from the canvas menu, and Undo brings it back', async ({ page, browserName }) => {
  phoneOnly();
  await boot(page, { blank: true });
  await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  await page.evaluate(async () => {
    const el = document.querySelector('.canvas-wrap');
    const r = el.getBoundingClientRect();
    const ev = (type, t, extra = {}) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
      button: 0, buttons: 1, clientX: r.left + 160 + 140 * t, clientY: r.top + 300 + 80 * t, ...extra,
    });
    el.dispatchEvent(ev('pointerdown', 0));
    for (let i = 1; i <= 12; i++) {
      window.dispatchEvent(ev('pointermove', i / 12));
      await new Promise(requestAnimationFrame);
    }
    window.dispatchEvent(ev('pointerup', 1, { buttons: 0 }));
  });
  const paths = page.locator('.strokes-layer path');
  // A stroke is two paths: its hit halo and its line.
  await expect(paths).toHaveCount(2);

  await page.getByRole('button', { name: 'Select tool', exact: true }).click();
  const x = wrap.x + 230, y = wrap.y + 340;
  await page.touchscreen.tap(x, y);
  // Selected, it wears a third: its highlight.
  await expect(paths).toHaveCount(3);

  await hold(page, x, y, browserName);
  await expect(menu(page)).toBeVisible();
  const first = menu(page).locator('button.ctx-item').first();
  await expect(first).toHaveText('Delete drawing');
  await expect(first).toHaveClass(/danger/);
  await first.tap();
  await expect(paths).toHaveCount(0);

  const toast = page.locator('.toast', { hasText: 'Deleted' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).tap();
  await expect(paths).toHaveCount(2);
});

test('a photo\'s menu opens it full size', async ({ page }) => {
  phoneOnly();
  await boot(page);
  await openCardMenu(page, 'home-image');
  await row(page, 'View full size').tap();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('.lightbox-img')).toBeVisible();
});

// The signed-in phone shell has a tab bar fixed to the foot of the screen
// (.mb-nav); ?local=1 has none. The menu ends over it, and its last row can be
// reached.
test('signed in, a card\'s menu ends above the tab bar and its last row can be tapped', async ({ page }) => {
  phoneOnly();
  await page.setViewportSize({ width: 375, height: 667 });
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  const nav = page.locator('.mb-nav');
  await expect(nav).toBeVisible({ timeout: 30000 });

  const wrap = await page.locator('.canvas-wrap').boundingBox();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).tap();
  await page.touchscreen.tap(wrap.x + wrap.width * 0.55, wrap.y + wrap.height * 0.3);
  await page.keyboard.type('Opening shot');
  const note = page.locator('.card').first();
  await expect(note).toBeVisible();
  // Out of the note, and nothing selected.
  for (let i = 0; i < 2; i++) {
    await page.touchscreen.tap(wrap.x + wrap.width * 0.85, wrap.y + wrap.height * 0.9);
    await page.waitForTimeout(350);
  }
  const b = await note.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 6);
  const more = page.locator('.sel-menu .card-menu-btn');
  await expect(more).toBeVisible();
  await more.tap();
  await expect(menu(page)).toBeVisible();

  const navTop = (await nav.boundingBox()).y;
  await expect.poll(async () => {
    const m = await menu(page).boundingBox();
    return !!m && m.y >= 0 && m.y + m.height <= navTop + 0.5;
  }).toBe(true);

  await menu(page).evaluate((m) => { m.scrollTop = m.scrollHeight; });
  await expect(menu(page)).not.toHaveClass(/has-more-below/);
  const onTop = await menu(page).evaluate((m) => {
    const rows = m.querySelectorAll('button.ctx-item');
    const last = rows[rows.length - 1];
    const r = last.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === last || last.contains(hit));
  });
  expect(onTop).toBe(true);
});
