// C3: in the immersive "focus view", tapping an image opens it fullscreen so a
// user can just look at pictures. Outside focus view a tap must NOT pop the
// lightbox (it selects, as before). Runs against the local app (?local=1), whose
// Home board seeds a real same-origin photo card. The focus toggle button lives
// in the authenticated shell, so here we set the same body flag it sets.
//
// The card uses a progressive image that keeps animating tiers, so a Playwright
// .click() never sees a "stable" element. We instead dispatch a clean pointer
// tap (pointerdown on the image + pointerup at the same spot) — exactly what the
// onCardPointerDown focus branch listens for.

import { expect, test } from '@playwright/test';

async function tapImage(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-card-id] .ic-img');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const o = {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
      button: 0, pointerType: 'mouse',
      clientX: Math.round(r.left + 20), clientY: Math.round(r.top + 20),
    };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    // The focus branch listens on window for the matching pointerup (≤4px = tap).
    window.dispatchEvent(new PointerEvent('pointerup', o));
    return true;
  });
}

test('focus view: tapping an image opens it fullscreen, then closes back to the board', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator('.ic-img').first().waitFor({ state: 'visible' });
  await page.evaluate(() => document.body.setAttribute('data-focus-mode', '1'));

  expect(await tapImage(page)).toBe(true);
  await expect(page.locator('.lightbox-stage')).toBeVisible();

  await page.locator('.lightbox-x').click();
  await expect(page.locator('.lightbox-stage')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.hasAttribute('data-focus-mode'))).toBe(true);
});

test('not in focus view: a single tap on an image does NOT open the lightbox', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator('.ic-img').first().waitFor({ state: 'visible' });
  expect(await tapImage(page)).toBe(true);
  // Give any (incorrect) lightbox a chance to appear before asserting absence.
  await page.waitForTimeout(300);
  await expect(page.locator('.lightbox-stage')).toHaveCount(0);
});
