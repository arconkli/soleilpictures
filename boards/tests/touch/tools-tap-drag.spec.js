// A finger moving cards: tap a card, then drag it (no hold); a drag on a card
// that is not selected pans the board; a hold still lifts it; a second finger
// puts a card back; the hint that teaches "tap, then drag" shows once.
//
// Drags need a finger that stays down: CDP touch, Chromium only (helpers.js).
//
//   cd boards && PW_PORT=5291 npx playwright test tests/touch/tools-tap-drag.spec.js --project=mobile-chrome
import { expect, test } from '@playwright/test';
import { canvasZoom, emptyCanvasPoint, holdDrag, needsHold, swipe, tap, touchDown, touchMove, touchUp } from './helpers.js';

test.describe.configure({ timeout: 60_000 });

async function open(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('soleil.dev.touchPass', '1'); localStorage.removeItem('soleil.liftHintSeen.tapDrag'); } catch (_) {}
  });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  // The opening fit has landed: the camera has stopped moving.
  let last;
  await expect.poll(async () => {
    const now = await page.evaluate(() => document.querySelector('.canvas-wrap > .canvas').style.transform);
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [150], timeout: 8000 }).toBe(true);
}

const ID = 'home-image';
const card = (page, id = ID) => page.locator(`.canvas-wrap .card[data-card-id="${id}"]`);
const rectOf = (page, id = ID) => card(page, id).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
// Where the card is on the board (not on screen).
const placeOf = (page, id = ID) => card(page, id).evaluate((el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
const camera = (page) => page.evaluate(() => document.querySelector('.canvas-wrap > .canvas').style.transform);
// A spot low on the card, clear of its centre-top controls and its corner handles.
const grabPoint = (r) => ({ x: r.x, y: r.bottom - Math.min(8, r.h / 4) });
// The way toward the middle of the board, so a drag stays on screen.
const towardMiddle = async (page, r, d) => {
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  return {
    x: r.x + (wrap.x + wrap.width / 2 > r.x ? d : -d),
    y: r.y + (wrap.y + wrap.height / 2 > r.y ? d : -d),
  };
};
// Where a card can be carried `d` px and land on open board. A finger occludes
// the card it drags, so on touch a card that ends up over a cluster card goes
// INTO that cluster (CanvasSurface's overlap fallback) and leaves the canvas;
// toward the middle can run onto one of the home board's clusters. So pick the
// first diagonal (toward the middle first) whose moved card stays on screen
// and clear of every card that takes a drop (clusters, grids).
const clearWay = async (page, d, id = ID) => {
  const r = await rectOf(page, id);
  const from = grabPoint(r);
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  const others = await page.evaluate((id) => [...document.querySelectorAll('.canvas-wrap .card.card-kind-board, .canvas-wrap .card.card-kind-grid')]
    .filter((el) => el.dataset.cardId !== id)
    .map((el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; }), id);
  const sx = wrap.x + wrap.width / 2 > r.x ? 1 : -1;
  const sy = wrap.y + wrap.height / 2 > r.y ? 1 : -1;
  const pad = 6;
  for (const [dx, dy] of [[sx, sy], [-sx, sy], [sx, -sy], [-sx, -sy]]) {
    const m = { left: r.left + dx * d, top: r.top + dy * d, right: r.right + dx * d, bottom: r.bottom + dy * d };
    const onScreen = m.left >= wrap.x && m.top >= wrap.y && m.right <= wrap.x + wrap.width && m.bottom <= wrap.y + wrap.height;
    const clear = others.every((o) => m.right + pad <= o.left || m.left - pad >= o.right || m.bottom + pad <= o.top || m.top - pad >= o.bottom);
    if (onScreen && clear) return { from, to: { x: from.x + dx * d, y: from.y + dy * d } };
  }
  throw new Error(`no clear way to carry ${id} ${d}px`);
};
async function selectIt(page) {
  const r = await rectOf(page);
  await tap(page, grabPoint(r));
  await expect(card(page)).toHaveClass(/is-selected/);
  await page.waitForTimeout(350);   // past a double-tap's window
}

test('tap a card, then drag it: it follows the finger with no hold', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page);
  await selectIt(page);
  const r0 = await rectOf(page);
  const { from, to } = await clearWay(page, 50);
  await swipe(page, from, to, { steps: 10 });
  await expect.poll(async () => Math.hypot((await rectOf(page)).left - r0.left, (await rectOf(page)).top - r0.top)).toBeGreaterThan(20);
  await page.waitForTimeout(300);
  const r1 = await rectOf(page);
  // Where it settles, a moved card snaps to a neighbour's edge or centre
  // within SNAP_TUNING.SNAP_PX (6 screen px, lib/snapGuides.js), so "under
  // the finger" is within that radius; on the landscape tablet it snaps 4.6px.
  expect(Math.abs((r1.left - r0.left) - (to.x - from.x))).toBeLessThanOrEqual(6);
  expect(Math.abs((r1.top - r0.top) - (to.y - from.y))).toBeLessThanOrEqual(6);
});

test('a drag on a card that is not selected pans the board and leaves the card where it is', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page);
  const r0 = await rectOf(page);
  const p0 = await placeOf(page);
  const cam0 = await camera(page);
  const from = grabPoint(r0);
  const to = await towardMiddle(page, { x: from.x, y: from.y }, 50);
  await swipe(page, from, to, { steps: 10 });
  await expect.poll(() => camera(page)).not.toBe(cam0);
  await page.waitForTimeout(300);
  expect(await placeOf(page)).toEqual(p0);
  await expect(card(page)).not.toHaveClass(/is-selected/);
  const r1 = await rectOf(page);
  expect(Math.abs((r1.left - r0.left) - (to.x - from.x))).toBeLessThanOrEqual(3);
  expect(Math.abs((r1.top - r0.top) - (to.y - from.y))).toBeLessThanOrEqual(3);
});

test('hold 480 ms or more on a card that is not selected, then drag: it moves', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page);
  const r0 = await rectOf(page);
  const p0 = await placeOf(page);
  const cam0 = await camera(page);
  const { from, to } = await clearWay(page, 50);
  await holdDrag(page, from, [to], { ms: 650, steps: 10 });
  await expect.poll(async () => {
    const p = await placeOf(page);
    return Math.hypot(p.x - p0.x, p.y - p0.y);
  }).toBeGreaterThan(5);
  expect(await camera(page)).toBe(cam0);   // the board did not pan
});

test('a second finger during a tap-then-drag puts the card back and leaves nothing to undo', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page);
  await selectIt(page);
  const r0 = await rectOf(page);
  const p0 = await placeOf(page);
  const from = grabPoint(r0);
  const to = await towardMiddle(page, { x: from.x, y: from.y }, 40);
  const spare = await emptyCanvasPoint(page);
  // One finger drags the card well past the tolerance...
  await touchDown(page, [from]);
  for (let i = 1; i <= 6; i++) {
    await touchMove(page, [{ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 }]);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  // ...then a second one lands.
  await touchDown(page, [to, spare]);
  await page.waitForTimeout(200);
  await touchUp(page);
  await page.waitForTimeout(400);
  expect(await placeOf(page)).toEqual(p0);
  // The local harness may have no undo button; where it does, it is empty.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undo.count()) await expect(undo.first()).toBeDisabled();
  expect(await canvasZoom(page)).toBeGreaterThan(0);
});

test.fixme('a selected note whose text overflows: a drag scrolls its text and the card does not move',
  // The seeded notes fit their text, and a note only overflows once it has been
  // sized by hand shorter than its text. The harness has no helper that seeds
  // one, and the handle drag that makes one is not worth faking here; the code
  // path (touchScrollEl in flushMove) wants a seeded overflowing note first.
  async () => {});

test('a drag on a card that is not selected shows "To move a card, tap it, then drag it." once', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page);
  // Count every toast that carries the words, whatever dedupes them.
  await page.evaluate(() => {
    window.__hintToasts = 0;
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && /To move a card, tap it, then drag it\./.test(n.textContent || '')
          && (n.matches?.('.toast') || n.querySelector?.('.toast'))) window.__hintToasts++;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const r0 = await rectOf(page);
  const from = grabPoint(r0);
  await swipe(page, from, await towardMiddle(page, { x: from.x, y: from.y }, 40), { steps: 8 });
  await expect(page.locator('.toast', { hasText: 'To move a card, tap it, then drag it.' })).toBeVisible();
  await page.waitForTimeout(400);
  // Again, on another unselected card: no second hint.
  const r1 = await rectOf(page, 'home-note');
  const f2 = grabPoint(r1);
  await swipe(page, f2, await towardMiddle(page, { x: f2.x, y: f2.y }, 40), { steps: 8 });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__hintToasts)).toBe(1);
});
