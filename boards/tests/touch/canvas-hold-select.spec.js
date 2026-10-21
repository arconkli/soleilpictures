// A finger on the canvas (owner, 2026-10-20): a tap on empty canvas clears the
// selection and two open the add menu there; a hold, then a drag, draws a
// selection box (as in Apple Freeform); a hold let go where it was held opens
// the menu, with Select… in it; and the selection's ⋯ stays a finger's size at
// every zoom and opens the menu for every selected card at once.
//
// The hold gestures were released with the sidebar (lib/appHost.js
// touchPassAllowed is open everywhere); the specs still set its old dev flag,
// which nothing reads, and `touchPass: false` only leaves it unset. Holds need
// CDP touch: Chromium only (helpers.js).
import { expect, test } from '@playwright/test';
import { canvasZoom, hitBox, hold, holdDrag, needsHold, pinch, swipe, tap, touchDown, touchMove, touchUp } from './helpers.js';

async function open(page, { touchPass = true } = {}) {
  await page.addInitScript((on) => {
    try { if (on) localStorage.setItem('soleil.dev.touchPass', '1'); } catch (_) {}
  }, touchPass);
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  // The board fits itself to its cards once they land; let the camera settle.
  await page.waitForTimeout(900);
}

const selectedIds = (page) => page.$$eval('.canvas-wrap .card.is-selected', (els) => els.map((el) => el.getAttribute('data-card-id')).sort());

const rectOf = (page, id) => page.locator(`.canvas-wrap .card[data-card-id="${id}"]`).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 };
});

// Nothing but the board under (x, y): no card, no chrome.
const isEmptyCanvas = (page, p) => page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return !!el && !!el.closest('.canvas-wrap') && ['cards-layer', 'canvas-wrap', 'grain-canvas', 'cnv-ground'].some((c) => el.classList.contains(c));
}, p);

// The nearest empty point to `p`, walking out in rings.
async function emptyNear(page, p) {
  for (let r = 0; r <= 160; r += 8) {
    for (let a = 0; a < 360; a += 30) {
      const q = { x: p.x + r * Math.cos((a * Math.PI) / 180), y: p.y + r * Math.sin((a * Math.PI) / 180) };
      if (await isEmptyCanvas(page, q)) return q;
      if (r === 0) break;
    }
  }
  throw new Error(`no empty canvas near ${p.x},${p.y}`);
}

// Cards whose box on screen crosses the rectangle a→b.
const cardsCrossing = (page, a, b) => page.evaluate(({ a, b }) => {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  return [...document.querySelectorAll('.canvas-wrap .card')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.left < maxX && r.right > minX && r.top < maxY && r.bottom > minY;
  }).map((el) => el.getAttribute('data-card-id')).sort();
}, { a, b });

// A box from empty canvas past the note's top-right, across the note and the
// image below it: the two cards the seeded board stacks in one column.
async function boxOverTwo(page) {
  const note = await rectOf(page, 'home-note');
  const image = await rectOf(page, 'home-image');
  const from = await emptyNear(page, { x: Math.max(note.right, image.right) + 24, y: note.top - 6 });
  const to = { x: Math.min(note.x, image.x), y: image.y };
  return { from, to };
}

const menu = (page) => page.locator('.ctx-menu').first();

// Empty canvas near the middle of the board, and how far apart two fingers
// either side of it can start and both land on the board, not on its chrome
// (on a phone the rail runs down the left edge).
async function pinchCentre(page) {
  const b = await page.locator('.canvas-wrap').boundingBox();
  const p = await emptyNear(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const onBoard = (x) => page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return !!el && !!el.closest('.canvas-wrap') && !el.closest('button, [role=button], input, .cnv-tools, .cnv-zoom, .tob');
  }, { x, y: p.y });
  let room = Math.min(p.x - b.x, b.x + b.width - p.x) * 2 - 24;
  while (room > 80 && !((await onBoard(p.x - room / 2)) && (await onBoard(p.x + room / 2)))) room -= 16;
  return { p, room };
}

test.describe('a finger on empty canvas', () => {
  test('a tap clears the selection, as a click does', async ({ page }) => {
    await open(page, { touchPass: false });
    await tap(page, await rectOf(page, 'home-note'));
    await expect.poll(() => selectedIds(page)).toEqual(['home-note']);
    await tap(page, await emptyNear(page, { x: (await rectOf(page, 'home-note')).right + 60, y: (await rectOf(page, 'home-note')).y }));
    await expect.poll(() => selectedIds(page)).toEqual([]);
  });

  test('a double tap opens the add menu there, once', async ({ page }) => {
    await open(page, { touchPass: false });
    const p = await emptyNear(page, { x: (await rectOf(page, 'home-note')).right + 60, y: (await rectOf(page, 'home-note')).y });
    await tap(page, p);
    await page.waitForTimeout(90);
    await tap(page, p);
    await expect(page.locator('.cnv-quick-add')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.locator('.cnv-quick-add')).toHaveCount(1);
  });

  test('the Image tool opens the photo picker where the finger lifts', async ({ page }) => {
    await open(page, { touchPass: false });
    await page.getByRole('button', { name: 'Add image tool', exact: true }).tap();
    await expect(page.locator('.cnv-hint')).toContainText('Tap on the canvas to place an image');
    await expect(page.locator('.cnv-hint').getByRole('button', { name: 'Done' })).toBeVisible();
    const p = await emptyNear(page, { x: (await rectOf(page, 'home-note')).right + 60, y: (await rectOf(page, 'home-note')).y });
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
    await tap(page, p);
    expect((await chooser).isMultiple()).toBe(true);
  });

  test('a quick drag pans, and selects nothing', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await open(page);
    const p = await emptyNear(page, { x: (await rectOf(page, 'home-note')).right + 60, y: (await rectOf(page, 'home-note')).y });
    const before = await rectOf(page, 'home-note');
    await swipe(page, p, { x: p.x - 90, y: p.y + 40 });
    await expect.poll(async () => Math.round((await rectOf(page, 'home-note')).left - before.left)).toBeLessThan(-60);
    expect(await selectedIds(page)).toEqual([]);
    await expect(menu(page)).toBeHidden();
  });

  test('a hold, then a drag, selects the cards the box crosses', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await open(page);
    const { from, to } = await boxOverTwo(page);
    const expected = await cardsCrossing(page, from, to);
    expect(expected).toEqual(expect.arrayContaining(['home-image', 'home-note']));
    const before = await rectOf(page, 'home-note');
    await holdDrag(page, from, [to]);
    await expect.poll(() => selectedIds(page)).toEqual(expected);
    // The board didn't move under the box, and no menu opened.
    expect(Math.round((await rectOf(page, 'home-note')).left)).toBe(Math.round(before.left));
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('.cnv-selcount')).toHaveText(`${expected.length} selected`);
  });

  test('a hold let go where it was held opens the menu at the finger, with Select…', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await open(page);
    const p = await emptyNear(page, { x: (await rectOf(page, 'home-note')).right + 60, y: (await rectOf(page, 'home-note')).y });
    await touchDown(page, [p]);
    await page.waitForTimeout(700);
    // Still held: the ring is full and no menu covers the place a box could go.
    await expect(page.locator('.cnv-hold-cue.is-on')).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await touchUp(page);
    await expect(menu(page)).toBeVisible();
    await expect(page.locator('.cnv-hold-cue.is-on')).toHaveCount(0);
    await expect(menu(page).getByRole('menuitem', { name: 'Select…' })).toBeVisible();
    // At the finger, or as near as the window's edge lets a 240px menu be.
    const box = await menu(page).boundingBox();
    const vw = page.viewportSize().width;
    expect(Math.abs(box.x - Math.min(p.x, vw - 248))).toBeLessThan(12);
    // The click that letting go raises didn't pick anything off the menu.
    await page.waitForTimeout(300);
    await expect(menu(page)).toBeVisible();
  });

  test('a hold, then a second finger: no menu, and the pinch zooms', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await open(page);
    const { p, room } = await pinchCentre(page);
    const z0 = await canvasZoom(page);
    await touchDown(page, [p]);
    await page.waitForTimeout(600);
    // The second finger lands and the two spread apart.
    const at = (g) => [{ x: p.x - g / 2, y: p.y, id: 0 }, { x: p.x + g / 2, y: p.y, id: 1 }];
    await touchDown(page, at(40));
    for (let g = 40; g <= Math.min(240, room); g += 20) {
      await touchMove(page, at(g));
      await page.waitForTimeout(16);
    }
    await touchUp(page);
    await expect.poll(() => canvasZoom(page)).toBeGreaterThan(z0 * 1.2);
    await page.waitForTimeout(300);
    await expect(menu(page)).toBeHidden();
    expect(await selectedIds(page)).toEqual([]);
  });

  test('Select…: taps add cards and take them out, and Done keeps them', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await open(page);
    const p = await emptyNear(page, { x: (await rectOf(page, 'home-note')).right + 60, y: (await rectOf(page, 'home-note')).y });
    await hold(page, p);
    await menu(page).getByRole('menuitem', { name: 'Select…' }).tap();
    const pill = page.locator('.cnv-hint[data-hint="touch_select"]');
    await expect(pill).toContainText('Tap cards to select');
    await tap(page, await rectOf(page, 'home-note'));
    await tap(page, await rectOf(page, 'home-image'));
    await expect.poll(() => selectedIds(page)).toEqual(['home-image', 'home-note']);
    await tap(page, await rectOf(page, 'home-note'));
    await expect.poll(() => selectedIds(page)).toEqual(['home-image']);
    // A cluster card toggles too, rather than opening.
    await tap(page, await rectOf(page, 'b-stills'));
    await expect.poll(() => selectedIds(page)).toEqual(['b-stills', 'home-image']);
    await expect(page.locator('.canvas-wrap .card[data-card-id="b-stills"]')).toBeVisible();
    await pill.getByRole('button', { name: 'Done' }).tap();
    await expect(pill).toHaveCount(0);
    expect(await selectedIds(page)).toEqual(['b-stills', 'home-image']);
    // Out of Select…, a tap selects only what it lands on again.
    await tap(page, await rectOf(page, 'home-note'));
    await expect.poll(() => selectedIds(page)).toEqual(['home-note']);
  });

  test('Escape drops a box half drawn and puts the selection back', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await open(page);
    const { from, to } = await boxOverTwo(page);
    const two = await cardsCrossing(page, from, to);
    await holdDrag(page, from, [to]);
    await expect.poll(() => selectedIds(page)).toEqual(two);
    // A second box, over the image alone, dropped half drawn. (Not from the
    // first box's corner: the selection's ⋯ sits there now.)
    const image = await rectOf(page, 'home-image');
    const start = await emptyNear(page, { x: image.right + 20, y: image.bottom + 20 });
    await holdDrag(page, start, [{ x: image.x, y: image.y }], { lift: false });
    await expect(page.locator('.canvas-wrap .marquee')).toBeVisible();
    await page.keyboard.press('Escape');
    await touchUp(page);
    await expect(page.locator('.canvas-wrap .marquee')).toHaveCount(0);
    await expect.poll(() => selectedIds(page)).toEqual(two);
  });
});

test('a hold on the comments eye opens its archive, and leaves the comments showing', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page, { touchPass: false });
  const eye = page.locator('.cnv-comments-eye');
  await expect(eye).toBeVisible();
  const b = await eye.boundingBox();
  await hold(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await expect(page.locator('.comment-archive')).toBeVisible();
  // The release didn't click it: comments are still on, and no canvas menu.
  await page.waitForTimeout(300);
  await expect(eye).not.toHaveClass(/is-muted/);
  await expect(menu(page)).toBeHidden();
});

test.describe('the selection’s ⋯', () => {
  const dots = (page) => page.locator('.sel-menu > .card-menu-btn');

  async function measure(page) {
    const r = await dots(page).evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { w: b.width, h: b.height };
    });
    return { ...r, hit: await hitBox(dots(page)) };
  }

  test('one card: whole, a finger’s size, and it opens the card’s menu', async ({ page }) => {
    await open(page, { touchPass: false });
    await tap(page, await rectOf(page, 'home-note'));
    await expect(dots(page)).toBeVisible();
    const m = await measure(page);
    expect(Math.round(m.w)).toBe(36);
    expect(Math.round(m.h)).toBe(36);
    // Nothing clips or covers it: a finger finds all of it and its slop.
    expect(m.hit.covered).toBe(false);
    expect(Math.min(m.hit.w, m.hit.h)).toBeGreaterThanOrEqual(42);
    await dots(page).tap();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('menuitem', { name: /^Delete$/ })).toBeVisible();
  });

  test('stays a finger’s size zoomed out', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await open(page);
    const z0 = await canvasZoom(page);
    const { p, room } = await pinchCentre(page);
    const wide = Math.min(320, room);
    await pinch(page, p, wide, wide * 0.5);
    await expect.poll(() => canvasZoom(page)).toBeLessThan(z0 * 0.75);
    await page.waitForTimeout(400);
    await tap(page, await rectOf(page, 'home-note'));
    await expect(dots(page)).toBeVisible();
    // The tap drew the ⋯ under the finger (the card is smaller than it now);
    // that tap's own click must not open the menu.
    await page.waitForTimeout(300);
    await expect(menu(page)).toBeHidden();
    const m = await measure(page);
    expect(Math.round(m.w)).toBe(36);
    expect(m.hit.covered).toBe(false);
    expect(Math.min(m.hit.w, m.hit.h)).toBeGreaterThanOrEqual(42);
    // Clear of the card, so a finger can still hold the card to lift it.
    const card = await rectOf(page, 'home-note');
    const b = await dots(page).boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(card.right);
    expect(b.y + b.height).toBeLessThanOrEqual(card.top);
  });

  test('several cards: one ⋯ for them all, and its menu acts on them all', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await open(page);
    const { from, to } = await boxOverTwo(page);
    const expected = await cardsCrossing(page, from, to);
    await holdDrag(page, from, [to]);
    await expect.poll(() => selectedIds(page)).toEqual(expected);
    await expect(dots(page)).toHaveCount(1);
    await expect(dots(page)).toHaveAttribute('aria-label', `Options for ${expected.length} cards`);
    await dots(page).tap();
    await expect(menu(page).getByRole('menuitem', { name: `Delete (${expected.length})` })).toBeVisible();
  });
});
