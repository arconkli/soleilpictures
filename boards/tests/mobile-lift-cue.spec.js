// Press-and-hold to pick up a card is the touch gesture, and it used to be
// completely invisible: nothing happened for TOUCH_LIFT_MS, so a touch user had
// no way to discover that WAITING was the thing to do. The only teaching moment
// was a toast shown after their drag had already panned the board — once per
// device, for all time. A quarter of mobile users reached the app and hit that.
//
// .is-lifting shows the hold while it happens. These pin that it appears on
// touch-down, hands off to .is-lifted on completion, and — the part that matters
// most — is abandoned the moment the gesture turns into a pan, so it can never
// promise a pickup that isn't coming.

import { expect, test } from '@playwright/test';

const CARD = '[data-card-id]';

async function touch(page, sel, phase, dx = 0, dy = 0) {
  return page.evaluate(({ sel, phase, dx, dy }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const o = {
      bubbles: true, cancelable: true, pointerId: 7, isPrimary: true,
      button: 0, pointerType: 'touch',
      clientX: Math.round(r.left + r.width / 2 + dx),
      clientY: Math.round(r.top + r.height / 2 + dy),
    };
    const target = phase === 'down' ? el : window;
    target.dispatchEvent(new PointerEvent('pointer' + phase, o));
    return true;
  }, { sel, phase, dx, dy });
}

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test('a finger resting on a card shows the hold filling', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator(CARD).first().waitFor({ state: 'visible' });

  expect(await touch(page, CARD, 'down')).toBe(true);
  await expect(page.locator(`${CARD}.is-lifting`).first()).toBeAttached();
});

test('holding still long enough hands the cue off to a picked-up card', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator(CARD).first().waitFor({ state: 'visible' });

  await touch(page, CARD, 'down');
  await expect(page.locator(`${CARD}.is-lifting`).first()).toBeAttached();

  // TOUCH_LIFT_MS is 480ms; wait it out without moving.
  await expect(page.locator(`${CARD}.is-lifted`).first()).toBeAttached({ timeout: 2000 });
  await expect(page.locator(`${CARD}.is-lifting`)).toHaveCount(0);
});

test('moving the finger abandons the hold instead of promising a pickup', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator(CARD).first().waitFor({ state: 'visible' });

  await touch(page, CARD, 'down');
  await expect(page.locator(`${CARD}.is-lifting`).first()).toBeAttached();

  // Past TOUCH_LIFT_TOLERANCE (10px) → this gesture is a pan.
  await touch(page, CARD, 'move', 40, 0);
  await expect(page.locator(`${CARD}.is-lifting`)).toHaveCount(0);
  await expect(page.locator(`${CARD}.is-lifted`)).toHaveCount(0);
});

test('the cue never intercepts the gesture it describes', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator(CARD).first().waitFor({ state: 'visible' });
  await touch(page, CARD, 'down');
  await page.locator(`${CARD}.is-lifting`).first().waitFor({ state: 'attached' });

  const pe = await page.evaluate(() => {
    const el = document.querySelector('[data-card-id].is-lifting');
    return el ? getComputedStyle(el, '::after').pointerEvents : null;
  });
  expect(pe).toBe('none');
});
