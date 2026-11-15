import { expect, test } from '@playwright/test';

// On touch (coarse pointer) the selected card's resize/rotate handles are
// drawn outside the card, in the selection layer (.sel-handle), at a fixed
// finger size on screen with an invisible expanded hit area: inside the card
// its clip cut the rotate handle away and both shrank with the zoom. Verify
// the coarse-pointer sizes apply. (tests/touch/handles-drag.spec.js drags them
// with a real finger.)
//
// Touch-only (the sizes live in @media (hover:none) and (pointer:coarse)), so
// skip the mouse desktop project.

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome',
    'coarse-pointer handle sizing is a touch concern');
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card').first()).toBeVisible();
});

test('resize + rotate handles are finger-sized on touch, with expanded hit areas', async ({ page }) => {
  // Synthetic touch tap (down+up, no move) on an onscreen draggable card to
  // select it — handles render on .card.is-selected.
  const DRAGGABLE = /card-kind-(note|image|shape|link|text|doc)/;
  const tapped = await page.evaluate(({ DRAGGABLE_SRC }) => {
    const RE = new RegExp(DRAGGABLE_SRC);
    const vw = window.innerWidth, vh = window.innerHeight;
    const el = [...document.querySelectorAll('.cards-layer .card')].find((e) => {
      if (!RE.test(e.className)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 24 && r.height > 24 && r.left > 8 && r.top > 60 && r.right < vw - 8 && r.bottom < vh - 8;
    });
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const fire = (t) => el.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 9, clientX: x, clientY: y, button: 0,
    }));
    fire('pointerdown'); fire('pointerup');
    return true;
  }, { DRAGGABLE_SRC: DRAGGABLE.source });
  test.skip(!tapped, 'no draggable card landed onscreen for this seed/viewport');

  await expect(page.locator('.cards-layer .card.is-selected')).toHaveCount(1);

  // The selected card's own handles give way to the selection layer's.
  await expect(page.locator('.cards-layer .card.is-selected > .card-resize, .cards-layer .card.is-selected > .card-rotate')).toHaveCount(0);

  const dims = await page.evaluate(() => {
    const r = document.querySelector('.canvas .sel-handle > .card-resize');
    const rot = document.querySelector('.canvas .sel-handle > .card-rotate');
    return {
      resizeW: r ? getComputedStyle(r).width : null,
      rotateW: rot ? getComputedStyle(rot).width : null,
      resizeBeforeContent: r ? getComputedStyle(r, '::before').content : null,
    };
  });

  // Resize handle: a 26px puck on screen, with a content:'' expanded hit area.
  expect(dims.resizeW).toBe('26px');
  expect(dims.resizeBeforeContent).toBe('""');
  // Rotate handle (only on rotatable cards wide enough on screen): 24px.
  if (dims.rotateW) expect(dims.rotateW).toBe('24px');
});
