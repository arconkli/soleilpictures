import { expect, test } from '@playwright/test';

// First-run discoverability for press-and-hold-to-lift.
//
// When a touch user drags from a card without holding first, the board pans
// (the card stays put) — confusing if you expected to move the card. The first
// time that happens we show a one-time toast explaining the hold. The "seen"
// flag is device-local (localStorage 'soleil.liftHintSeen').
//
// Touch-only, so skip the mouse (desktop-chrome) project.

const DRAGGABLE = /card-kind-(note|image|shape|link|text|doc)/;
const HINT = 'Press and hold a card to pick it up';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome',
    'press-and-hold lift hint is a touch interaction');
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card').first()).toBeVisible();
});

// One-finger drag (no hold) starting on the first onscreen draggable card.
// Returns false if no suitable card landed onscreen.
async function panFromCard(page) {
  return page.evaluate(async ({ DRAGGABLE_SRC }) => {
    const DRAGGABLE = new RegExp(DRAGGABLE_SRC);
    const vw = window.innerWidth, vh = window.innerHeight;
    const el = [...document.querySelectorAll('.cards-layer .card')].find((e) => {
      if (!DRAGGABLE.test(e.className)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 24 && r.height > 24
        && r.left > 8 && r.top > 60 && r.right < vw - 8 && r.bottom < vh - 8;
    });
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
      pointerId: 7, clientX: x, clientY: y, button: 0,
    }));
    const raf = () => new Promise((res) => requestAnimationFrame(() => res()));
    fire(el, 'pointerdown', cx, cy);
    let lastX = cx, lastY = cy;
    for (let i = 1; i <= 6; i++) { lastX = cx + i * 12; lastY = cy + i * 8; fire(window, 'pointermove', lastX, lastY); await raf(); await raf(); }
    fire(window, 'pointerup', lastX, lastY);
    await raf();
    return true;
  }, { DRAGGABLE_SRC: DRAGGABLE.source });
}

test('first pan-from-a-card shows the hold hint and sets the seen flag', async ({ page }) => {
  await page.evaluate(() => { try { localStorage.removeItem('soleil.liftHintSeen'); } catch (_) {} });
  const ok = await panFromCard(page);
  test.skip(!ok, 'no draggable card landed onscreen for this seed/viewport');
  await expect(page.locator('.toast-msg', { hasText: HINT })).toBeVisible();
  const flag = await page.evaluate(() => localStorage.getItem('soleil.liftHintSeen'));
  expect(flag).toBe('1');
});

test('the hint does NOT fire again once the flag is set', async ({ page }) => {
  await page.evaluate(() => { try { localStorage.setItem('soleil.liftHintSeen', '1'); } catch (_) {} });
  const ok = await panFromCard(page);
  test.skip(!ok, 'no draggable card landed onscreen for this seed/viewport');
  // Give any (incorrect) toast a moment to mount, then assert none with the hint.
  await page.waitForTimeout(300);
  await expect(page.locator('.toast-msg', { hasText: HINT })).toHaveCount(0);
});
