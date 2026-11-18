// An iPad turned: upright it is the phone shell (the bottom nav, no sidebar),
// sideways the desktop layout with the floating sidebar beside the board. The
// board goes with the canvas's left edge across that switch, so the note being
// typed is in view both ways and back where it was on every turn upright.
// CanvasSurface holdBoardStill used to hold the board against the sidebar on
// the way to landscape only: each round trip took the sidebar's width off the
// pan (317, -155, -627…) and the note went out of view. The + sheet, which
// belongs to the phone shell, closes on the turn to landscape; it used to hide
// there and come back.
import { expect, test } from '@playwright/test';
import { bootSignedIn } from '../helpers/signedInStub.js';

const PORTRAIT = { width: 834, height: 1194 };
const LANDSCAPE = { width: 1194, height: 834 };
// Boots upright, in the phone shell.
test.use({ viewport: PORTRAIT });

const upright = async (page) => {
  await expect(page.locator('.mb-nav')).toBeVisible();
  await expect(page.locator('.cnv-tools')).toBeVisible();
};
const sideways = async (page) => {
  await expect(page.locator('.mb-nav')).toHaveCount(0);
  await expect(page.locator('.sb-ws-trigger')).toBeVisible();
};
// The note's box, and the visible canvas: the wrap, from the rail's right edge,
// under the top islands that lie across the note's columns and above a
// finger's format bar.
const scene = (page) => page.evaluate(() => {
  const wrap = document.querySelector('.canvas-wrap');
  const r = wrap.getBoundingClientRect();
  const rail = wrap.querySelector('.cnv-tools').getBoundingClientRect();
  const b = wrap.querySelector('.cards-layer .card[data-card-id]').getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(wrap.querySelector('.canvas')).transform);
  return {
    zoom: m.a,
    wrap: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
    railRight: rail.right,
    islandsBottom: Math.max(0, ...[...document.querySelectorAll('.chrome-island')]
      .map((el) => el.getBoundingClientRect())
      .filter((i) => i.width > 0 && i.height > 0 && i.left < b.right && i.right > b.left)
      .map((i) => i.bottom)),
    barTop: [...wrap.querySelectorAll('.tob.tob-a.is-touch')]
      .map((el) => el.getBoundingClientRect()).filter((i) => i.height > 0).map((i) => i.top)[0] ?? null,
    note: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
  };
});
// A turn is over when the shell has switched and the canvas and the note have
// kept still past the app's own settle (300ms, then the pan's commit).
async function turn(page, size, shell) {
  await page.setViewportSize(size);
  await shell(page);
  await expect.poll(async () => {
    const a = await scene(page);
    await page.waitForTimeout(350);
    const b = await scene(page);
    return a.wrap.left === b.wrap.left && a.note.left === b.note.left && a.note.top === b.note.top;
  }, { timeout: 15000 }).toBe(true);
}

async function boot(page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(1500);
}

test('a note being typed stays put through three turns to landscape and back', async ({ page }) => {
  await boot(page);
  await upright(page);
  await page.locator('.cnv-empty-tile', { hasText: 'Note' }).tap();
  await expect(page.locator('.cards-layer .card[data-card-id]')).toHaveCount(1);
  await page.waitForTimeout(1200);
  await page.keyboard.type('Half typed');
  await page.waitForTimeout(400);
  const start = await scene(page);
  // The format bar lies over the zoom control, so it hides while the bar is up.
  await expect(page.locator('.tob.tob-a.is-touch')).toBeVisible();
  await expect(page.locator('.cnv-zoom')).toBeHidden();

  for (let i = 0; i < 3; i++) {
    await turn(page, LANDSCAPE, sideways);
    const land = await scene(page);
    // The canvas starts right of the sidebar, and the whole note is on it,
    // under the top islands.
    expect(land.wrap.left).toBeGreaterThan(200);
    expect(land.note.left).toBeGreaterThanOrEqual(land.railRight);
    expect(land.note.right).toBeLessThanOrEqual(land.wrap.right);
    expect(land.note.top).toBeGreaterThanOrEqual(land.wrap.top);
    expect(land.note.top).toBeGreaterThanOrEqual(land.islandsBottom);
    expect(land.note.bottom).toBeLessThanOrEqual(land.barTop ?? land.wrap.bottom);
    expect(Math.abs(land.zoom - start.zoom)).toBeLessThan(0.001);

    await turn(page, PORTRAIT, upright);
    const back = await scene(page);
    expect(Math.abs(back.note.left - start.note.left), `turn ${i + 1}`).toBeLessThanOrEqual(2);
    expect(Math.abs(back.zoom - start.zoom)).toBeLessThan(0.001);
  }
  // Still the note being typed in.
  await page.keyboard.type(' end');
  await expect(page.locator('.cards-layer .card[data-card-id]')).toContainText('Half typed end');
});

// A note from the rail's tool starts at the top of the upright board, under
// the phone's top bar. Sideways the canvas runs to the window's top, under the
// floating islands, so the note is moved down clear of them (CanvasSurface
// keepEditedCardInView), at the zoom there is.
test('a note typed at the top of the board comes out from under the top islands in landscape', async ({ page }) => {
  await boot(page);
  await upright(page);
  await page.locator('.cnv-tools').getByRole('button', { name: 'Add note tool', exact: true }).tap();
  const w = await page.locator('.canvas-wrap').boundingBox();
  await page.touchscreen.tap(Math.round(w.x + w.width * 0.55), Math.round(w.y + w.height * 0.3));
  await expect(page.locator('.cards-layer .card[data-card-id]')).toHaveCount(1);
  await page.waitForTimeout(1200);
  await page.keyboard.type('Half typed');
  await page.waitForTimeout(400);
  const start = await scene(page);
  // At the top of the board: the case the turn has to move.
  expect(start.note.top - start.wrap.top).toBeLessThan(58);

  await turn(page, LANDSCAPE, sideways);
  const land = await scene(page);
  expect(land.islandsBottom).toBeGreaterThan(0);
  expect(land.note.top).toBeGreaterThanOrEqual(land.islandsBottom);
  expect(land.note.left).toBeGreaterThanOrEqual(land.railRight);
  expect(land.note.right).toBeLessThanOrEqual(land.wrap.right);
  expect(land.note.bottom).toBeLessThanOrEqual(land.barTop ?? land.wrap.bottom);
  expect(Math.abs(land.zoom - start.zoom)).toBeLessThan(0.001);
  await page.keyboard.type(' end');
  await expect(page.locator('.cards-layer .card[data-card-id]')).toContainText('Half typed end');
});

test('the + sheet closes on the turn to landscape and stays closed on the turn back', async ({ page }) => {
  await boot(page);
  await upright(page);
  // A board with a card on it: on an empty one the + adds a note itself.
  // The note holds words, or leaving it (the + tap) would discard it as empty.
  await page.locator('.cnv-empty-tile', { hasText: 'Note' }).tap();
  await expect(page.locator('.cards-layer .card[data-card-id]')).toHaveCount(1);
  await page.waitForTimeout(1200);
  await page.keyboard.type('Opening shot');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Add a card' }).tap();
  await expect(page.locator('.mobile-add-grid')).toBeVisible();
  await turn(page, LANDSCAPE, sideways);
  await expect(page.locator('.mobile-add-grid')).toHaveCount(0);
  await turn(page, PORTRAIT, upright);
  await expect(page.locator('.mobile-add-grid')).toHaveCount(0);
});
