import { expect, test } from '@playwright/test';

// Touch gestures on a lifted card. Press-and-hold LIFTS a card on an editable
// board (see mobile-lift-cue.spec.js); two things used to go wrong once it was
// up:
//   - a second finger fed the same drag, so the card hopped between fingers
//     and dropped under whichever lifted first;
//   - Android fires contextmenu on the same long press, which opened the card
//     menu over the card in your hand.

const CARD = '[data-card-id]';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

// One synthetic touch PointerEvent, positioned relative to the first card's
// centre at the time of the call.
async function touch(page, phase, { id = 7, dx = 0, dy = 0, at = null } = {}) {
  return page.evaluate(({ sel, phase, id, dx, dy, at }) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = at ? at.x : Math.round(r.left + r.width / 2 + dx);
    const y = at ? at.y : Math.round(r.top + r.height / 2 + dy);
    const o = {
      bubbles: true, cancelable: true, pointerId: id, isPrimary: id === 7,
      button: 0, buttons: phase === 'up' ? 0 : 1, pointerType: 'touch', clientX: x, clientY: y,
    };
    const target = phase !== 'down' ? window
      : (at ? (document.elementFromPoint(x, y) || window) : el);
    target.dispatchEvent(new PointerEvent('pointer' + phase, o));
    return { x, y };
  }, { sel: CARD, phase, id, dx, dy, at });
}

async function liftFirstCard(page) {
  const start = await touch(page, 'down');
  await expect(page.locator(`${CARD}.is-lifted`).first()).toBeAttached({ timeout: 2000 });
  return start;
}

async function open(page) {
  await page.goto('/?local=1');
  await page.locator(CARD).first().waitFor({ state: 'visible', timeout: 20000 });
}

// The card's position in the BOARD, from its own style — its on-screen box
// grows while lifted (the pick-up cue scales it).
const cardPos = (page, id) => page.locator(`.card[data-card-id="${id}"]`).evaluate((el) => (
  { left: el.style.left, top: el.style.top, transform: el.style.transform }
));

test('a second finger during a lifted drag puts the card back instead of dropping it under that finger', async ({ page }) => {
  await open(page);
  const id = await page.locator(CARD).first().getAttribute('data-card-id');
  const before = await cardPos(page, id);
  const start = await liftFirstCard(page);
  // Carry it a little with the first finger.
  await touch(page, 'move', { at: { x: start.x + 30, y: start.y + 20 } });
  await page.waitForTimeout(50);
  // A second finger lands on bare canvas far away, moves, and lifts first.
  const bare = await page.evaluate(() => {
    for (let y = 820; y > 300; y -= 20) {
      for (let x = 20; x < 380; x += 20) {
        const el = document.elementFromPoint(x, y);
        if (el?.closest('.canvas-wrap') && !el.closest('.card, button, [role="toolbar"], nav')) return { x, y };
      }
    }
    return null;
  });
  expect(bare).not.toBeNull();
  await touch(page, 'down', { id: 8, at: bare });
  await touch(page, 'move', { id: 8, at: { x: bare.x + 20, y: bare.y - 20 } });
  await touch(page, 'up', { id: 8, at: { x: bare.x + 20, y: bare.y - 20 } });
  await touch(page, 'up', { at: { x: start.x + 30, y: start.y + 20 } });
  await page.waitForTimeout(300);
  expect(await cardPos(page, id)).toEqual(before);
});

test('the long press that lifts a card does not also open its menu', async ({ page }) => {
  await open(page);
  const start = await liftFirstCard(page);
  // What Android Chrome dispatches during that same hold.
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    el.dispatchEvent(new PointerEvent('contextmenu', {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, button: 0,
    }));
  }, start);
  await page.waitForTimeout(200);
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
  await touch(page, 'up', { at: start });
});
