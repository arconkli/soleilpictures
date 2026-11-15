// A finger on a card's handles, and a finger moving cards.
//
// Under a finger the one selected card's rotate and resize handles are drawn
// outside the card, in the selection layer (.sel-handle), at a fixed size on
// screen: inside the card its clip cut the rotate handle away and both shrank
// with the zoom. A note is picked up by its text on Android (its scrolling
// body used to hand the drag to the browser, which cancelled it). A palette's
// remove-colour x takes a finger only once the palette is selected.
//
// Drags need a finger that stays down: CDP touch, Chromium only (helpers.js).
// WebKit runs what a tap can show.
import { expect, test } from '@playwright/test';
import { canvasZoom, hitBox, holdDrag, pinch, swipe, tap } from './helpers.js';

async function open(page) {
  await page.addInitScript(() => { try { localStorage.setItem('soleil.dev.touchPass', '1'); } catch (_) {} });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  // The opening fit has landed: the camera has stopped moving.
  await settled(() => page.evaluate(() => document.querySelector('.canvas-wrap > .canvas').style.transform));
}

// Reads until two reads in a row agree, and returns that value.
async function settled(read) {
  let last;
  await expect.poll(async () => {
    const now = JSON.stringify(await read());
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [150], timeout: 8000 }).toBe(true);
  return JSON.parse(last);
}

const card = (page, id) => page.locator(`.canvas-wrap .card[data-card-id="${id}"]`);
const rectOf = (page, id) => card(page, id).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
// Where the card is on the board (not on screen): its own left / top / size
// and angle, which a move, a resize or a turn writes.
const placeOf = (page, id) => card(page, id).evaluate((el) => {
  const m = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || '');
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height), rot: m ? Number(m[1]) : 0 };
});
const centre = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
});
const select = async (page, id) => {
  const r = await rectOf(page, id);
  await tap(page, { x: r.x, y: r.bottom - Math.min(8, r.h / 4) });
  await expect(card(page, id)).toHaveClass(/is-selected/);
};
const rotateHandle = (page) => page.locator('.canvas .sel-handle > .card-rotate');
const resizeHandle = (page) => page.locator('.canvas .sel-handle > .card-resize:not(.multi-resize)');

const topAt = (page, p) => page.evaluate(({ x, y }) => {
  const el = document.elementsFromPoint(x, y)[0];
  return el ? el.className : null;
}, p);
// A trackpad's pinch (ctrl + wheel) until `done`: WebKit has no two fingers here.
async function zoomOutUntil(page, done) {
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  const at = { x: wrap.x + wrap.width / 2, y: wrap.y + wrap.height * 0.4 };
  for (let i = 0; i < 80 && !(await done()); i++) {
    await page.evaluate(({ x, y }) => {
      document.querySelector('.canvas-wrap').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: 40, ctrlKey: true }));
    }, at);
  }
  await settled(() => canvasZoom(page));
}

// Selects the seeded note at the opening zoom and checks the rotate handle is
// outside the card and takes the finger.
async function rotateReady(page) {
  await open(page);
  const id = 'home-note';
  await select(page, id);
  await expect(rotateHandle(page)).toHaveCount(1);
  // The card's own handles give way to these.
  await expect(card(page, id).locator('> .card-rotate, > .card-resize')).toHaveCount(0);
  const h = await centre(rotateHandle(page));
  expect(h.w).toBeCloseTo(24, 0);
  const r = await rectOf(page, id);
  expect(h.y).toBeLessThan(r.top);   // above the card, not clipped inside it
  expect(await topAt(page, h)).toBe('card-rotate');
  const box = await hitBox(rotateHandle(page));
  expect(box.w).toBeGreaterThanOrEqual(44);
  expect(box.h).toBeGreaterThanOrEqual(40);   // the card's edge is 36px below
  return { id, h, r };
}

test('the rotate handle is outside the card, under the finger', async ({ page }) => {
  await rotateReady(page);
});

test('dragging the rotate handle turns the card', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'a dragged finger needs CDP touch (Chromium)');
  const { id, h, r } = await rotateReady(page);
  expect((await placeOf(page, id)).rot).toBe(0);
  // A quarter turn clockwise about the card's centre: from above it to its right.
  const reach = r.y - h.y;
  await swipe(page, h, { x: r.x + reach, y: r.y }, { steps: 12 });
  await expect.poll(async () => (await placeOf(page, id)).rot).toBeGreaterThan(60);
  const { rot } = await settled(() => placeOf(page, id));
  expect(rot).toBeGreaterThan(60);
  expect(rot).toBeLessThan(120);
  // The handle turned with the card: it is beside it now, not above.
  const after = await centre(rotateHandle(page));
  expect(after.x).toBeGreaterThan(r.x + reach / 2);
});

// The ⋯ is drawn above the handles and stays upright while the handle turns
// with the card: at no angle may it cover the handle, or the card is stuck there.
for (const deg of [30, 45, 60, 90]) {
  test(`turned to ${deg} degrees, the rotate handle can be taken again`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'a dragged finger needs CDP touch (Chromium)');
    const { id, h, r } = await rotateReady(page);
    const reach = r.y - h.y;
    const at = (d) => ({ x: r.x + Math.sin(d * Math.PI / 180) * reach, y: r.y - Math.cos(d * Math.PI / 180) * reach });
    await swipe(page, h, at(deg), { steps: 12 });
    const first = (await settled(() => placeOf(page, id))).rot;
    expect(Math.abs(first - deg)).toBeLessThan(12);
    await expect(page.locator('.canvas .sel-menu > .card-menu-btn')).toHaveCount(1);
    await expect(rotateHandle(page)).toHaveCount(1);
    await expect(resizeHandle(page)).toHaveCount(1);
    const again = await centre(rotateHandle(page));
    expect(await topAt(page, again)).toBe('card-rotate');
    expect(await topAt(page, await centre(resizeHandle(page)))).toContain('card-resize');
    await swipe(page, again, at(deg + 40), { steps: 12 });
    const second = (await settled(() => placeOf(page, id))).rot;
    expect(second).toBeGreaterThan(first + 20);
  });
}

test('a card too narrow on screen keeps resize and drops rotate', async ({ page }) => {
  await open(page);
  await zoomOutUntil(page, async () => (await rectOf(page, 'home-note')).w < 50);
  expect((await rectOf(page, 'home-note')).w).toBeLessThan(56);
  await select(page, 'home-note');
  await expect(resizeHandle(page)).toHaveCount(1);
  await expect(rotateHandle(page)).toHaveCount(0);
});

test('a card smaller than the resize puck can still be held: the puck steps out of its corner', async ({ page }) => {
  await open(page);
  const small = async () => { const r = await rectOf(page, 'home-note'); return Math.min(r.w, r.h) < 40; };
  await zoomOutUntil(page, small);
  test.skip(!(await small()), 'the board does not zoom out far enough here');
  await select(page, 'home-note');
  await expect(resizeHandle(page)).toHaveCount(1);
  const r = await rectOf(page, 'home-note');
  const top = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.card[data-card-id="home-note"]'), r);
  expect(top).toBe(true);
  const box = await hitBox(resizeHandle(page));
  expect(box.w).toBeGreaterThanOrEqual(44);
  expect(box.h).toBeGreaterThanOrEqual(44);
});

const ID = 'home-link';   // left of the pinch, so it stays on screen
// Selects a card and checks its resize handle is a finger wide on screen: at
// about half size where a pinch can be made (Chromium), else at the opening
// zoom, which is further out still.
async function resizeReady(page, browserName) {
  await open(page);
  if (browserName === 'chromium') {
    // To about half size: two fingers spreading on empty board below the cards.
    const grid = await rectOf(page, 'home-grid');
    const z0 = await canvasZoom(page);
    const gap = 110;
    await pinch(page, { x: 200, y: Math.min(grid.bottom + 70, 700) }, gap, gap * (0.5 / z0), { steps: 12 });
    const z = await settled(() => canvasZoom(page));
    expect(z).toBeGreaterThan(0.4);
    expect(z).toBeLessThan(0.65);
  }
  await select(page, ID);
  await expect(resizeHandle(page)).toHaveCount(1);
  const h = await centre(resizeHandle(page));
  expect(h.w).toBeCloseTo(26, 0);
  const box = await hitBox(resizeHandle(page));
  expect(box.w).toBeGreaterThanOrEqual(44);
  expect(box.h).toBeGreaterThanOrEqual(44);
  return h;
}

test('the resize handle is finger-sized when zoomed out', async ({ page, browserName }) => {
  await resizeReady(page, browserName);
});

test('dragging the resize handle resizes the card', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'a dragged finger needs CDP touch (Chromium)');
  const h = await resizeReady(page, browserName);
  const before = await placeOf(page, ID);
  await swipe(page, h, { x: h.x + 40, y: h.y + 30 }, { steps: 10 });
  await expect.poll(async () => (await placeOf(page, ID)).w).toBeGreaterThan(before.w + 20);
  const after = await settled(() => placeOf(page, ID));
  expect(after.w).toBeGreaterThan(before.w + 20);
  expect(after.h).toBeGreaterThan(before.h + 10);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
});

test('a note held by its text is lifted, moved and stays', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'a held finger needs CDP touch (Chromium)');
  await open(page);
  const cancels = await page.evaluateHandle(() => {
    const seen = { n: 0 };
    window.addEventListener('pointercancel', () => { seen.n++; }, true);
    return seen;
  });
  const z = await canvasZoom(page);
  const before = await placeOf(page, 'home-note');
  const body = await centre(card(page, 'home-note').locator('.note-body'));
  await holdDrag(page, body, [{ x: body.x - 40, y: body.y + 120 }], { ms: 850, steps: 12 });
  await expect.poll(async () => (await placeOf(page, 'home-note')).y).not.toBe(before.y);
  const after = await settled(() => placeOf(page, 'home-note'));
  expect(await cancels.evaluate((s) => s.n)).toBe(0);
  expect(Math.abs((after.x - before.x) - (-40 / z))).toBeLessThan(30);
  expect(Math.abs((after.y - before.y) - (120 / z))).toBeLessThan(30);
});

test('everything selected, held by one card and moved, stays where it was put', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'a held finger needs CDP touch (Chromium)');
  await open(page);
  const ids = await page.$$eval('.canvas-wrap .cards-layer .card', (els) => els.map((el) => el.getAttribute('data-card-id')));
  // A hold on empty board, then a drag: the box that selects.
  const all = await Promise.all(ids.map((id) => rectOf(page, id)));
  const from = { x: Math.min(...all.map((r) => r.left)) + 32, y: Math.max(...all.map((r) => r.bottom)) + 58 };
  const to = { x: Math.max(...all.map((r) => r.right)) + 6, y: Math.min(...all.map((r) => r.top)) - 20 };
  await holdDrag(page, from, [to], { ms: 750, steps: 16 });
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(ids.length);

  const z = await canvasZoom(page);
  const before = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await placeOf(page, id)])));
  const seen = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await rectOf(page, id)])));
  const held = seen['home-image'];
  await holdDrag(page, held, [{ x: held.x, y: held.y - 50 }], { ms: 850, steps: 12 });
  await expect.poll(async () => (await placeOf(page, 'home-image')).y).not.toBe(before['home-image'].y);
  await settled(async () => [await canvasZoom(page), await rectOf(page, 'home-image')]);
  // Where the cards are on the board, and where they are on screen: 50px up
  // from where they were, with the view where it was.
  expect(await canvasZoom(page)).toBeCloseTo(z, 3);
  for (const id of ids) {
    const a = await placeOf(page, id);
    expect(Math.abs(a.x - before[id].x), `${id} x`).toBeLessThan(30);
    expect(Math.abs((a.y - before[id].y) - (-50 / z)), `${id} y`).toBeLessThan(30);
    const s = await rectOf(page, id);
    expect(Math.abs(s.left - seen[id].left), `${id} screen x`).toBeLessThan(12);
    expect(Math.abs((s.top - seen[id].top) - (-50)), `${id} screen y`).toBeLessThan(12);
  }
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(ids.length);
});

test('the tap that selects a palette removes no colour', async ({ page }) => {
  await open(page);
  const pal = card(page, 'home-pal');
  const cells = pal.locator('.pc-cell');
  const n = await cells.count();
  expect(n).toBeGreaterThan(1);
  await expect(pal).not.toHaveClass(/is-selected/);
  const x = pal.locator('.pc-cell-x').nth(1);
  // Not shown, and not there for a finger, until the palette is selected.
  await expect(x).toHaveCSS('opacity', '0');
  await expect(x).toHaveCSS('pointer-events', 'none');
  // A tap right where the x is. (Chromium hands it to the card and selects
  // it, and the tap's click then lands on the x that has just appeared;
  // WebKit hands it to the swatch under the x.)
  await tap(page, await centre(x));
  await settled(() => cells.count());
  await expect(cells).toHaveCount(n);
  await expect(page.locator('.toast', { hasText: 'Color removed' })).toHaveCount(0);
});

test('a selected palette shows the x, and it removes a colour with an undo', async ({ page }) => {
  await open(page);
  const pal = card(page, 'home-pal');
  const cells = pal.locator('.pc-cell');
  const n = await cells.count();
  const title = await centre(pal.locator('.pc-title'));
  await tap(page, title);
  await expect(pal).toHaveClass(/is-selected/);
  const x = pal.locator('.pc-cell-x').nth(1);
  await expect(x).toHaveCSS('opacity', '1');
  await expect(x).toHaveCSS('pointer-events', 'auto');
  await page.waitForTimeout(500);   // not a double tap
  await tap(page, await centre(x));
  await expect(cells).toHaveCount(n - 1);
  await expect(page.locator('.toast', { hasText: 'Color removed' })).toBeVisible();
});
