// On a view-only board — the public /share case — a clean tap on an image opens
// it fullscreen. It used to do nothing at all: the read-only branch of
// onCardPointerDown only handled board covers and board links, so an image fell
// through to "drag pans the canvas" and a click died there. .ic-actions is
// hover-only on a mouse, so on a shared board a photo was the one thing you
// could not actually look at, and the field traces showed exactly that —
// dead- and rage-clicks on div.r2p.ic-img were the top in-board interaction
// on /share.
//
// ?roqa=1 renders the local board with canEdit=false + isPublic=true (DEV-only,
// see lib/localMode.js). Tap dispatch mirrors focus-view-image.spec.js: the
// progressive image never settles for Playwright's actionability check, and the
// branch listens on window for the matching pointerup (≤4px travel = a tap).

import { expect, test } from '@playwright/test';

async function tapImage(page, dx = 0, dy = 0) {
  return page.evaluate(({ dx, dy }) => {
    const el = document.querySelector('[data-card-id] .ic-img');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + 20), y = Math.round(r.top + 20);
    const base = {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
      button: 0, pointerType: 'mouse',
    };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: x + dx, clientY: y + dy }));
    return true;
  }, { dx, dy });
}

test('view-only board: tapping an image opens it fullscreen', async ({ page }) => {
  await page.goto('/?local=1&roqa=1');
  await page.locator('.ic-img').first().waitFor({ state: 'visible' });

  expect(await tapImage(page)).toBe(true);
  await expect(page.locator('.lightbox-stage')).toBeVisible();

  await page.locator('.lightbox-x').click();
  await expect(page.locator('.lightbox-stage')).toHaveCount(0);
});

test('view-only board: dragging across an image pans instead of opening it', async ({ page }) => {
  await page.goto('/?local=1&roqa=1');
  await page.locator('.ic-img').first().waitFor({ state: 'visible' });

  // 40px of travel is a pan, not a tap — the ≤4px gate must reject it.
  expect(await tapImage(page, 40, 0)).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.locator('.lightbox-stage')).toHaveCount(0);
});

test('view-only board: images advertise the tap with a zoom cursor', async ({ page }) => {
  await page.goto('/?local=1&roqa=1');
  await page.locator('.ic-img').first().waitFor({ state: 'visible' });

  const cursor = await page.evaluate(() => {
    const el = document.querySelector('[data-card-id] .ic-imgwrap');
    return el ? getComputedStyle(el).cursor : null;
  });
  expect(cursor).toBe('zoom-in');
});

test('editable board: a single tap on an image still does NOT open the lightbox', async ({ page }) => {
  // Guards the blast radius — the new branch is inside `if (!canEdit)`, so the
  // normal editing canvas must keep select-on-click.
  await page.goto('/?local=1');
  await page.locator('.ic-img').first().waitFor({ state: 'visible' });
  expect(await tapImage(page)).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.locator('.lightbox-stage')).toHaveCount(0);
});
