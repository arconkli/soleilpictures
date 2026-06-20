import { expect, test } from '@playwright/test';

// Mobile press-and-hold to pick up a card.
//
// The bug: on touch, a one-finger drag that happened to start on a card would
// fling that card instead of panning the board (you're trying to look around).
// The fix: on touch a drag PANS; a card only becomes movable after a ~480ms
// press-and-hold "lift". These tests lock that in.
//
// Touch-only behavior, so skip on the mouse (desktop-chrome) project.

const DRAGGABLE = /card-kind-(note|image|shape|link|text|doc)/;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome',
    'press-and-hold to lift is a touch interaction');
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card').first()).toBeVisible();
});

// Run a synthetic one-finger touch gesture on the first onscreen draggable
// card: pointerdown, an optional hold, then window-level pointermoves, then
// pointerup. Returns the card's canvas-space x/y (inline left/top — unaffected
// by pan) and the .canvas transform, before and after. Returns null if no
// suitable card is onscreen (the seed/viewport didn't cooperate).
async function touchGesture(page, { holdMs, moves }) {
  return page.evaluate(async ({ holdMs, moves, DRAGGABLE_SRC }) => {
    const DRAGGABLE = new RegExp(DRAGGABLE_SRC);
    const vw = window.innerWidth, vh = window.innerHeight;
    const el = [...document.querySelectorAll('.cards-layer .card')].find(e => {
      if (!DRAGGABLE.test(e.className)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 24 && r.height > 24
        && r.left > 8 && r.top > 60 && r.right < vw - 8 && r.bottom < vh - 8;
    });
    if (!el) return null;
    const canvas = document.querySelector('.canvas');
    const read = () => ({
      left: parseFloat(el.style.left) || 0,
      top: parseFloat(el.style.top) || 0,
      transform: canvas ? getComputedStyle(canvas).transform : '',
    });
    const before = read();
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pid = 7;
    const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
      pointerId: pid, clientX: x, clientY: y, button: 0,
    }));
    const raf = () => new Promise(res => requestAnimationFrame(() => res()));

    fire(el, 'pointerdown', cx, cy);
    if (holdMs) await new Promise(res => setTimeout(res, holdMs));
    let lastX = cx, lastY = cy;
    for (let i = 1; i <= moves; i++) {
      lastX = cx + i * 10; lastY = cy + i * 7;
      fire(window, 'pointermove', lastX, lastY);
      await raf(); await raf();
    }
    fire(window, 'pointerup', lastX, lastY);
    await raf(); await raf();
    return { before, after: read() };
  }, { holdMs, moves, DRAGGABLE_SRC: DRAGGABLE.source });
}

test('one-finger drag on a card pans the board — it does NOT move the card', async ({ page }) => {
  const res = await touchGesture(page, { holdMs: 0, moves: 6 });
  test.skip(!res, 'no draggable card landed onscreen for this seed/viewport');
  const { before, after } = res;
  // The card's own coordinates are unchanged (it was not grabbed)...
  expect(Math.abs(after.left - before.left)).toBeLessThan(2);
  expect(Math.abs(after.top - before.top)).toBeLessThan(2);
  // ...but the canvas panned (its transform changed).
  expect(after.transform).not.toBe(before.transform);
});

test('press-and-hold then drag moves the card', async ({ page }) => {
  // Hold 600ms (> the 480ms lift) so the card is picked up, then drag.
  const res = await touchGesture(page, { holdMs: 600, moves: 6 });
  test.skip(!res, 'no draggable card landed onscreen for this seed/viewport');
  const { before, after } = res;
  expect(Math.abs(after.left - before.left) + Math.abs(after.top - before.top)).toBeGreaterThan(20);
});
