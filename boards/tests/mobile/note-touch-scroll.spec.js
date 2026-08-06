import { expect, test } from '@playwright/test';

// Finger-scrolling a clipped note on the canvas.
//
// `.canvas-wrap { touch-action: none }` lets useGesture own pinch-zoom and
// two-finger pan — but touch-action INTERSECTS down the ancestor chain, so it
// also made every scroll container inside a card unscrollable by finger, and no
// CSS on the descendant could widen it back. A long note simply could not be
// read on a phone. The scroll is now driven in JS.
//
// The arming rule mirrors the desktop wheel carve-out: a note scrolls once its
// card is selected (or is being edited). Dragging across an UNSELECTED note
// still pans the board — otherwise a dense canvas would be impossible to move
// around. Both halves are asserted here; the pure arming/scroll math lives in
// tests/touch-scroll.spec.js.

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch interaction');
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card').first()).toBeVisible();
});

// Force the first note onscreen to overflow, so there is something to scroll.
// Returns false when the seed put no note in view.
async function seedTallNote(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const card = [...document.querySelectorAll('.cards-layer .card')].find((e) => {
      if (!/card-kind-note/.test(e.className)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 24 && r.height > 24
        && r.left > 8 && r.top > 60 && r.right < vw - 8 && r.bottom < vh - 8;
    });
    if (!card) return false;
    const body = card.querySelector('.note-body');
    if (!body) return false;
    body.innerHTML = Array.from({ length: 40 }, (_, i) => `<p>line ${i} of a long note</p>`).join('');
    card.setAttribute('data-ts-probe', '1');
    return body.scrollHeight > body.clientHeight + 1;
  });
}

// One synthetic finger drag starting inside the note body. Mirrors the gesture
// helper in lift-to-drag.spec.js: pointerdown on the element, window-level
// pointermoves (that's where the drag handlers listen), then pointerup.
async function dragInsideNote(page, { dy }) {
  return page.evaluate(async ({ dy }) => {
    const card = document.querySelector('.card[data-ts-probe="1"]');
    const body = card.querySelector('.note-body');
    const canvas = document.querySelector('.canvas');
    const before = {
      scrollTop: body.scrollTop,
      transform: canvas ? getComputedStyle(canvas).transform : '',
    };
    const r = body.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pid = 11;
    const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
      pointerId: pid, clientX: x, clientY: y, button: 0,
    }));
    const raf = () => new Promise(res => requestAnimationFrame(() => res()));

    fire(body, 'pointerdown', cx, cy);
    // Several steps so the gesture clears the movement threshold that keeps a
    // tap resolving as a tap.
    for (let i = 1; i <= 8; i++) {
      fire(window, 'pointermove', cx, cy + (dy / 8) * i);
      await raf();
    }
    await raf();
    const after = {
      scrollTop: body.scrollTop,
      transform: canvas ? getComputedStyle(canvas).transform : '',
    };
    fire(window, 'pointerup', cx, cy + dy);
    return { before, after };
  }, { dy });
}

test('a selected note scrolls under the finger instead of panning the board', async ({ page }) => {
  const ok = await seedTallNote(page);
  test.skip(!ok, 'no onscreen note in the seed to make overflow');

  // Tap to select — the arming step.
  await page.locator('.card[data-ts-probe="1"]').tap();
  await expect(page.locator('.card[data-ts-probe="1"].is-selected')).toBeVisible();

  // Drag UP the screen → content scrolls down.
  const r = await dragInsideNote(page, { dy: -120 });
  expect(r.after.scrollTop).toBeGreaterThan(r.before.scrollTop);
  // …and the canvas did NOT pan.
  expect(r.after.transform).toBe(r.before.transform);
});

test('an unselected note still pans the board', async ({ page }) => {
  const ok = await seedTallNote(page);
  test.skip(!ok, 'no onscreen note in the seed to make overflow');

  // Deliberately NOT selected: this gesture belongs to the canvas.
  await page.evaluate(() => {
    document.querySelectorAll('.card.is-selected').forEach(e => e.classList.remove('is-selected'));
  });

  const r = await dragInsideNote(page, { dy: -120 });
  expect(r.after.scrollTop).toBe(r.before.scrollTop);
  expect(r.after.transform).not.toBe(r.before.transform);
});
