import { expect, test } from '@playwright/test';

// lib/touchScroll.js — the arming + scroll math behind finger-scrolling inside
// the canvas.
//
// Why any of this exists: `.canvas-wrap { touch-action: none }` lets useGesture
// own pinch-zoom and two-finger pan, but touch-action INTERSECTS down the
// ancestor chain, so it also makes every scroll container inside a card
// impossible to finger-scroll — and no CSS on the descendant can widen it back.
// So the scroll is driven in JS, gated by the same rule the desktop wheel
// handler uses (a card-content scroller only scrolls once the card is selected
// or being edited, otherwise a drag across a big note could never pan the
// board).
//
// Loaded straight from source over the vite dev server, so this asserts the
// real module rather than a copy of its logic.
async function loadLib(page) {
  await page.goto('/?local=1&blank=1');
  return page.evaluate(async () => {
    const m = await import('/src/lib/touchScroll.js');
    window.__ts = m;
    return Object.keys(m).sort();
  });
}

// Build a detached DOM tree with a controllable overflow state. jsdom-style
// stubbing of scrollHeight/clientHeight keeps the test independent of layout.
async function makeTree(page, { className, overflowing, wrapperClass }) {
  return page.evaluate(({ className, overflowing, wrapperClass }) => {
    document.querySelectorAll('.ts-fixture').forEach(n => n.remove());
    const wrap = document.createElement('div');
    wrap.className = 'ts-fixture ' + (wrapperClass || '');
    const el = document.createElement('div');
    el.className = className;
    const inner = document.createElement('span');
    inner.textContent = 'target';
    el.appendChild(inner);
    wrap.appendChild(el);
    document.body.appendChild(wrap);
    Object.defineProperty(el, 'scrollHeight', { value: overflowing ? 500 : 100, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    let top = 0;
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      set: (v) => { top = v; },
      configurable: true,
    });
    window.__tsEl = el;
    window.__tsTarget = inner;
    return true;
  }, { className, overflowing, wrapperClass });
}

test.describe('touchScroll arming rule', () => {
  test('the module exposes its contract', async ({ page }) => {
    const keys = await loadLib(page);
    expect(keys).toEqual([
      'canScrollVertically',
      'driveTouchScroll',
      'findTouchScrollable',
      'isTouchScrollArmed',
      'startTouchScrollGesture',
    ]);
  });

  test('a note body only scrolls once its card is selected or editing', async ({ page }) => {
    await loadLib(page);

    // Overflowing but the card is idle → the drag belongs to the canvas (pan).
    await makeTree(page, { className: 'note-body', overflowing: true, wrapperClass: 'card' });
    expect(await page.evaluate(() => !!window.__ts.findTouchScrollable(window.__tsTarget))).toBe(false);

    // Selected card → armed.
    await makeTree(page, { className: 'note-body', overflowing: true, wrapperClass: 'card is-selected' });
    expect(await page.evaluate(() => !!window.__ts.findTouchScrollable(window.__tsTarget))).toBe(true);

    // Editing → armed (this is the path an open Tiptap note takes).
    await makeTree(page, { className: 'note-body', overflowing: true, wrapperClass: 'note is-editing' });
    expect(await page.evaluate(() => !!window.__ts.findTouchScrollable(window.__tsTarget))).toBe(true);

    // Selected but NOT overflowing → nothing to scroll, so the canvas keeps it.
    await makeTree(page, { className: 'note-body', overflowing: false, wrapperClass: 'card is-selected' });
    expect(await page.evaluate(() => !!window.__ts.findTouchScrollable(window.__tsTarget))).toBe(false);
  });

  test('chrome scrollers arm without any selection', async ({ page }) => {
    await loadLib(page);
    // The phone tool rail is overflow-y:auto inside .canvas-wrap and was
    // completely unscrollable; it has no owning card to select.
    await makeTree(page, { className: 'cnv-tools', overflowing: true, wrapperClass: '' });
    expect(await page.evaluate(() => !!window.__ts.findTouchScrollable(window.__tsTarget))).toBe(true);
  });

  test('an unrelated container is never claimed', async ({ page }) => {
    await loadLib(page);
    await makeTree(page, { className: 'some-other-box', overflowing: true, wrapperClass: 'card is-selected' });
    expect(await page.evaluate(() => !!window.__ts.findTouchScrollable(window.__tsTarget))).toBe(false);
  });

  test('driveTouchScroll moves content opposite the finger and pins at both ends', async ({ page }) => {
    await loadLib(page);
    await makeTree(page, { className: 'note-body', overflowing: true, wrapperClass: 'card is-selected' });
    const r = await page.evaluate(() => {
      const { driveTouchScroll } = window.__ts;
      const el = window.__tsEl;          // scrollHeight 500, clientHeight 100 → max 400
      const out = {};
      // Finger UP the screen (negative dy) scrolls content DOWN.
      out.up = driveTouchScroll(el, -50);
      out.afterUp = el.scrollTop;
      // Finger DOWN scrolls back.
      out.down = driveTouchScroll(el, 20);
      out.afterDown = el.scrollTop;
      // Pinned at the top: no further movement, and it reports 0 consumed
      // (callers use that to know the gesture did nothing).
      out.pinnedTop = driveTouchScroll(el, 999);
      out.afterPinnedTop = el.scrollTop;
      // Pinned at the bottom, clamped to max.
      driveTouchScroll(el, -9999);
      out.afterFling = el.scrollTop;
      out.pinnedBottom = driveTouchScroll(el, -50);
      return out;
    });
    expect(r.up).toBe(50);
    expect(r.afterUp).toBe(50);
    expect(r.down).toBe(-20);
    expect(r.afterDown).toBe(30);
    expect(r.pinnedTop).toBe(-30);   // consumed only what was left
    expect(r.afterPinnedTop).toBe(0);
    expect(r.afterFling).toBe(400);  // clamped to scrollHeight - clientHeight
    expect(r.pinnedBottom).toBe(0);  // nothing left to give
  });
});
