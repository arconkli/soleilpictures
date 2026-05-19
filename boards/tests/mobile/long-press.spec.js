import { expect, test } from '@playwright/test';

// Long-press on the canvas surface opens the background context menu
// (touch equivalent of right-click). Locks in the P3.4 behavior.

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
});

test('long-press on empty canvas opens background context menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome',
    'long-press is a touch input — desktop right-clicks via onContextMenu');
  // Find an empty patch of canvas (top-right is reliably empty in seeded data)
  const wrap = page.locator('.canvas-wrap');
  const box = await wrap.boundingBox();
  if (!box) test.skip();
  const x = box.x + box.width * 0.92;
  const y = box.y + 80;
  // Simulate a 600ms hold via Playwright's touchscreen API. The useLongPress
  // hook fires at 480ms, so 600ms guarantees the timer elapses.
  await page.touchscreen.tap(x, y);  // primes the page focus
  const start = Date.now();
  await page.evaluate(([cx, cy]) => {
    const el = document.elementFromPoint(cx, cy);
    if (!el) return;
    // Synthesize a touch pointerdown that doesn't move — useLongPress
    // listens at the element level via pointerdown/pointermove/pointerup.
    const send = (type) => {
      const ev = new PointerEvent(type, {
        bubbles: true, cancelable: true,
        pointerType: 'touch', isPrimary: true,
        clientX: cx, clientY: cy, pointerId: 1,
      });
      el.dispatchEvent(ev);
    };
    send('pointerdown');
    setTimeout(() => send('pointerup'), 600);
  }, [x, y]);
  // Wait for the menu to appear (allow a bit more than 480ms)
  await expect(page.locator('.ctx-menu, .bg-ctx-menu')).toBeVisible({ timeout: 1500 });
});
