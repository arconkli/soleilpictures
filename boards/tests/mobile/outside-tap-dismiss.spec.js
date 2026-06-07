import { expect, test } from '@playwright/test';

// Popovers / menus must dismiss on an outside TAP, not only an outside mouse
// click. The dismiss listeners now capture `pointerdown` (not `mousedown` only),
// so a card's stopPropagation can't leave a menu stuck open on touch. Locks in
// the touch-dismiss fix (useDismissOnOutside + the inline pointerdown captures).

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
});

test('background context menu closes on an outside tap', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch dismissal path');

  const box = await page.locator('.canvas-wrap').boundingBox();
  if (!box) test.skip();
  const x = box.x + box.width * 0.92;
  const y = box.y + 80;

  // Open the background context menu with a long-press (the touch right-click).
  await page.evaluate(([cx, cy]) => {
    const el = document.elementFromPoint(cx, cy);
    if (!el) return;
    const send = (type, id) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
      clientX: cx, clientY: cy, pointerId: id,
    }));
    send('pointerdown', 1);
    setTimeout(() => send('pointerup', 1), 600);
  }, [x, y]);

  const menu = page.locator('.ctx-menu, .bg-ctx-menu');
  await expect(menu).toBeVisible({ timeout: 1500 });

  // Tap OUTSIDE the menu — a touch pointerdown whose target is the canvas, not
  // the menu. Before the fix the document listener only heard `mousedown`, so a
  // touch tap left the menu open; now the captured pointerdown closes it.
  await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    wrap.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
      clientX: 8, clientY: 220, pointerId: 2,
    }));
  });

  await expect(menu).toBeHidden({ timeout: 1500 });
});
