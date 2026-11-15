// A tablet held sideways: the desktop layout under a finger, the floating
// sidebar beside the board.
//
// A note's format bar is fixed to the window there (the keyboard lifts it) and
// was centred on the window, so its left end, the font and Bold, lay under the
// sidebar. It is centred on the canvas now (useIslandFit's touch mode hands
// the bar the canvas's edges).
//
// On a short one (a 10.2-inch iPad, an Android tablet) the tool rail, a
// finger's size, is taller than the room between the comments button above it
// and the Add images dock below, and lay under both. It hangs under the button
// there and scrolls above the dock (toolbarLook.css).
import { expect, test } from '@playwright/test';
import { bootSignedIn } from '../helpers/signedInStub.js';

const SIZES = [{ width: 1194, height: 834 }, { width: 1080, height: 736 }];
const SHORT = { width: 1138, height: 712 };

async function boot(page, size) {
  await page.setViewportSize(size);
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.sb-ws-trigger')).toBeVisible();
  await page.waitForTimeout(1500);
}
// A note from the rail's tool, left with the caret in it.
async function addNote(page) {
  await page.locator('.cnv-tools').getByRole('button', { name: 'Add note tool', exact: true }).tap();
  const b = await page.locator('.canvas-wrap').boundingBox();
  await page.touchscreen.tap(Math.round(b.x + b.width * 0.55), Math.round(b.y + b.height * 0.3));
  await expect(page.locator('.cards-layer .card[data-card-id]')).toHaveCount(1);
  await page.waitForTimeout(900);
}
const rect = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
});
// The right edge of the sidebar's cards, which float over the window's left.
const sidebarRight = (page) => page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('.sbf-card')]
  .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.right)));

for (const size of SIZES) {
  test(`${size.width}x${size.height}: a note's format bar is clear of the sidebar, and its first control takes a tap`, async ({ page }) => {
    await boot(page, size);
    await addNote(page);
    await page.keyboard.type('Call sheet');
    const bar = page.locator('.tob.tob-a.nb-a');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveClass(/is-touch/);
    await expect(bar).toHaveCSS('position', 'fixed');
    const side = await sidebarRight(page);
    expect(side).toBeGreaterThan(200);
    const b = await rect(bar);
    const wrap = await rect(page.locator('.canvas-wrap'));
    expect(b.left).toBeGreaterThanOrEqual(side);
    expect(b.left).toBeGreaterThanOrEqual(wrap.left + 8);
    expect(b.right).toBeLessThanOrEqual(size.width - 8);
    // In the middle of the canvas, not the window.
    expect(Math.abs((b.left + b.right) / 2 - (wrap.left + wrap.right) / 2)).toBeLessThanOrEqual(1);
    // The leftmost control, the font, is the bar's own at its middle, and opens.
    const first = bar.locator('button').first();
    const f = await rect(first);
    expect(f.left).toBeGreaterThanOrEqual(side);
    const hit = await first.evaluate((el, [x, y]) => {
      const at = document.elementFromPoint(x, y);
      return !!at && (at === el || el.contains(at));
    }, [(f.left + f.right) / 2, (f.top + f.bottom) / 2]);
    expect(hit).toBe(true);
    await page.touchscreen.tap(Math.round((f.left + f.right) / 2), Math.round((f.top + f.bottom) / 2));
    await expect(page.locator('.nb-font-pop')).toBeVisible();
  });
}

// The bar lies over the zoom control (bottom right), so the control hides
// while the bar is up and comes back when editing ends.
for (const size of SIZES) {
  test(`${size.width}x${size.height}: the zoom control hides while a note's format bar is up and returns after`, async ({ page }) => {
    await boot(page, size);
    await expect(page.locator('.cnv-zoom')).toBeVisible();
    await addNote(page);
    await page.keyboard.type('Call sheet');
    await expect(page.locator('.tob.tob-a.nb-a')).toBeVisible();
    await expect(page.locator('.cnv-zoom')).toBeHidden();
    await expect(page.locator('.cnv-zoom')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('.cnv-zoom')).toHaveCSS('pointer-events', 'none');
    // Out of the note: tap empty canvas.
    const w = await page.locator('.canvas-wrap').boundingBox();
    for (let i = 0; i < 2; i++) {
      await page.touchscreen.tap(Math.round(w.x + w.width * 0.85), Math.round(w.y + w.height * 0.8));
      await page.waitForTimeout(400);
    }
    await expect(page.locator('.tob.tob-a.is-touch')).toHaveCount(0);
    await expect(page.locator('.cnv-zoom')).toBeVisible();
  });
}

for (const size of [...SIZES, SHORT]) {
  test(`${size.width}x${size.height}: the comments button, the rail and the Add images dock stay apart, and the rail's last tool takes a tap`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the short Android tablet: tablet-landscape-chrome');
    const sameKey = [];
    page.on('console', (m) => { if (/same key/i.test(m.text())) sameKey.push(m.text().slice(0, 200)); });
    await boot(page, size);
    await addNote(page);
    await page.keyboard.type('Scout notes');
    // Out of the note: the dock shows once the board has a card.
    const w = await page.locator('.canvas-wrap').boundingBox();
    for (let i = 0; i < 2; i++) {
      await page.touchscreen.tap(Math.round(w.x + w.width * 0.85), Math.round(w.y + w.height * 0.8));
      await page.waitForTimeout(400);
    }
    const dockEl = page.locator('.cnv-depth-dock');
    await expect(dockEl).toBeVisible();
    await page.waitForTimeout(400);   // its rise-in
    const eye = await rect(page.locator('.cnv-comments-eye'));
    const rail = await rect(page.locator('.cnv-tools'));
    const dock = await rect(dockEl);
    expect(rail.top).toBeGreaterThanOrEqual(eye.bottom);
    expect(dock.top).toBeGreaterThanOrEqual(rail.bottom);
    // The last tool: scrolled to where the rail scrolls, inside the rail's
    // box, and the rail's own at its middle.
    const last = page.locator('.cnv-tools').getByRole('button', { name: 'Keyboard shortcuts', exact: true });
    await last.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
    await page.waitForTimeout(200);
    const l = await rect(last);
    expect(l.top).toBeGreaterThanOrEqual(rail.top);
    expect(l.bottom).toBeLessThanOrEqual(rail.bottom);
    const hit = await last.evaluate((el, [x, y]) => {
      const at = document.elementFromPoint(x, y);
      return !!at && (at === el || el.contains(at));
    }, [(l.left + l.right) / 2, (l.top + l.bottom) / 2]);
    expect(hit).toBe(true);
    await page.touchscreen.tap(Math.round((l.left + l.right) / 2), Math.round((l.top + l.bottom) / 2));
    await expect(page.locator('.shortcuts-modal')).toBeVisible();
    // Two rows share a label ("One frame back · forward"): each has its own key.
    expect(sameKey).toEqual([]);
  });
}
