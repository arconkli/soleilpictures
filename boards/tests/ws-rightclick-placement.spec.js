import { expect, test } from '@playwright/test';

// Right-click → Add → "Text note" must drop the new card CENTERED on the
// cursor, including right after a wheel/trackpad pan. Regression guard for the
// stale-state bug: clientToCanvas read debounced React pan/zoom state, so a
// right-click inside the 140ms commit window (kept open by trackpad momentum)
// converted the cursor with a stale transform and the card landed offset.
// Fix: clientToCanvas reads the live panRef/zoomRef. See CanvasSurface.jsx.
//
// Ground truth is independent of React state: we derive the cursor's canvas
// point from the LIVE `.canvas` transform (a DOMMatrix off getComputedStyle)
// and compare it to the created card's measured center, also in canvas space.

const TOL = 2; // canvas px (mutators Math.round + sub-pixel rounding)
// Local-mode addNote creation size (LocalBoardsApp.jsx addNote). We assert the
// card's TOP-LEFT against (cursor − half creation size): top-left is fixed at
// creation, so it stays correct even though an empty note auto-resizes its
// HEIGHT shortly after mount (which would skew a center-based check).
const NOTE_W = 240, NOTE_H = 160;

// Open the background context menu via a synthetic contextmenu event, picking
// an empty point inside the canvas. Optionally fire a wheel-pan burst FIRST, in
// the same synchronous tick, so React pan state is still stale when the menu
// captures canvasPos (reproduces the regression condition). Returns the
// cursor's EXPECTED canvas-space point from the live transform.
async function openMenuAtEmptyPoint(page, wheel) {
  return page.evaluate(({ wheel }) => {
    const wrap = document.querySelector('.canvas-wrap');
    if (wheel) {
      for (let i = 0; i < (wheel.times || 1); i++) {
        wrap.dispatchEvent(new WheelEvent('wheel', {
          deltaX: wheel.dx || 0, deltaY: wheel.dy || 0, deltaMode: 0,
          bubbles: true, cancelable: true,
        }));
      }
    }
    const r = wrap.getBoundingClientRect();
    // Find an empty client point (no card under it) after any pan.
    let cx = r.left + r.width * 0.5, cy = r.top + r.height * 0.5;
    let found = false;
    for (let fy = 0.25; fy <= 0.75 && !found; fy += 0.07) {
      for (let fx = 0.25; fx <= 0.75 && !found; fx += 0.07) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('.canvas-wrap') && !el.closest('.card')) {
          cx = x; cy = y; found = true;
        }
      }
    }
    const tgt = document.elementFromPoint(cx, cy) || wrap;
    tgt.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: cx, clientY: cy, button: 2, buttons: 2,
      bubbles: true, cancelable: true,
    }));
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.canvas')).transform);
    return { cx, cy, zoom: m.a, x: (cx - r.left - m.e) / m.a, y: (cy - r.top - m.f) / m.a };
  }, { wheel });
}

async function cardIds(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.card[data-card-id]'))
      .map(el => el.getAttribute('data-card-id')));
}

// Stored canvas-space top-left of the card whose id is not in `beforeIds`. The
// inline left/top are unscaled canvas px (the card lives inside the scaled
// .canvas layer) — the exact position the mutator wrote, free of render-box and
// zoom-conversion noise, and unaffected by the note's post-mount height resize.
async function newCardTopLeft(page, beforeIds) {
  return page.evaluate((beforeIds) => {
    const before = new Set(beforeIds);
    const el = Array.from(document.querySelectorAll('.card[data-card-id]'))
      .find(e => !before.has(e.getAttribute('data-card-id')));
    if (!el) return null;
    const px = (v) => parseFloat(v);
    return { left: px(el.style.left), top: px(el.style.top) };
  }, beforeIds);
}

async function addTextNoteViaMenu(page) {
  await expect(page.locator('.ctx-menu')).toBeVisible();
  await page.locator('.ctx-submenu-wrap').filter({ hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByText('Text note', { exact: true }).click();
}

async function runScenario(page, { wheel } = {}) {
  const before = await cardIds(page);
  const exp = await openMenuAtEmptyPoint(page, wheel);
  await addTextNoteViaMenu(page);
  await expect.poll(async () => (await cardIds(page)).length).toBeGreaterThan(before.length);
  const card = await newCardTopLeft(page, before);
  expect(card, 'new card should exist').not.toBeNull();
  // Expected top-left if the card is centered on the cursor at creation size.
  const expLeft = exp.x - NOTE_W / 2, expTop = exp.y - NOTE_H / 2;
  const out = {
    zoom: Number(exp.zoom.toFixed(3)),
    expTopLeft: { x: Math.round(expLeft), y: Math.round(expTop) },
    cardTopLeft: { x: card.left, y: card.top },
    dx: Math.abs(card.left - expLeft),
    dy: Math.abs(card.top - expTop),
  };
  console.log('[placement]', JSON.stringify(out));
  return out;
}

test.describe('right-click Add drops the card centered on the cursor', () => {
  test('at rest', async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    const { dx, dy } = await runScenario(page);
    expect(dx).toBeLessThanOrEqual(TOL);
    expect(dy).toBeLessThanOrEqual(TOL);
  });

  test('at a non-default (settled) zoom', async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    // Zoom IN via ctrl+wheel anchored at viewport center (keeps canvas coords
    // positive), then let the debounced state commit (>140ms) so refs == state
    // — isolates geometry from the stale-state window.
    const z0 = await page.evaluate(() =>
      new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.canvas')).transform).a);
    await page.evaluate(() => {
      const wrap = document.querySelector('.canvas-wrap');
      const r = wrap.getBoundingClientRect();
      for (let i = 0; i < 2; i++) wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -80, ctrlKey: true, deltaMode: 0,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        bubbles: true, cancelable: true,
      }));
    });
    await page.waitForTimeout(300);
    const { zoom, dx, dy } = await runScenario(page);
    expect(zoom).toBeGreaterThan(z0 + 0.1); // confirm we actually zoomed in
    expect(dx).toBeLessThanOrEqual(TOL);
    expect(dy).toBeLessThanOrEqual(TOL);
  });

  test('immediately after a wheel pan (stale-state regression)', async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    // Wheel burst + contextmenu fire in the same tick, so React pan state is
    // still stale when canvasPos is captured. Pre-fix this offset the card by
    // ~160px; with the ref-based fix the card stays under the cursor.
    const { dx, dy } = await runScenario(page, { wheel: { dx: 160, dy: 120 } });
    expect(dx).toBeLessThanOrEqual(TOL);
    expect(dy).toBeLessThanOrEqual(TOL);
  });

  // Touch parity: long-press (the mobile "right-click") opens the same
  // background menu and must place at the touch point. Drives the
  // useLongPress path (CanvasSurface.jsx onLongPress → clientToCanvas).
  test('touch long-press Add drops the card centered on the touch point', async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    const before = await cardIds(page);
    const exp = await page.evaluate(() => {
      const wrap = document.querySelector('.canvas-wrap');
      const r = wrap.getBoundingClientRect();
      let cx = r.left + r.width * 0.5, cy = r.top + r.height * 0.5, found = false;
      for (let fy = 0.25; fy <= 0.75 && !found; fy += 0.07) {
        for (let fx = 0.25; fx <= 0.75 && !found; fx += 0.07) {
          const x = r.left + r.width * fx, y = r.top + r.height * fy;
          const el = document.elementFromPoint(x, y);
          if (el && el.closest('.canvas-wrap') && !el.closest('.card')) { cx = x; cy = y; found = true; }
        }
      }
      // Primary touch pointerdown, held in place — the long-press timer
      // (480ms) fires onLongPress(clientX, clientY) which opens the menu.
      wrap.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: cx, clientY: cy, pointerType: 'touch', isPrimary: true,
        button: 0, bubbles: true, cancelable: true,
      }));
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.canvas')).transform);
      return { cx, cy, x: (cx - r.left - m.e) / m.a, y: (cy - r.top - m.f) / m.a };
    });
    // Wait out the 480ms long-press timer, then place via the menu.
    await expect(page.locator('.ctx-menu')).toBeVisible({ timeout: 2000 });
    await addTextNoteViaMenu(page);
    await expect.poll(async () => (await cardIds(page)).length).toBeGreaterThan(before.length);
    const card = await newCardTopLeft(page, before);
    expect(card, 'new card should exist').not.toBeNull();
    expect(Math.abs(card.left - (exp.x - NOTE_W / 2))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(card.top - (exp.y - NOTE_H / 2))).toBeLessThanOrEqual(TOL);
  });
});
