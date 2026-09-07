// Capture Mode — the ephemeral reframe.
//
// The feature makes three promises that are only worth anything if they are
// literally true, and all three fail SILENTLY if the wiring drifts:
//
//   1. Arrows follow. The reframe substitutes geometry into the cards array on
//      its way to the canvas; arrow endpoints resolve through the same array.
//      If that ever stops being true, arrows detach from the cards they point
//      at and you don't find out until you watch the recording back.
//   2. Nothing is written. A drag while reframed would commit a position taken
//      from the temporary layout into the real document — which broadcasts and
//      persists. That is the feature breaking its own central promise.
//   3. Turning it off restores the board EXACTLY. Not approximately.
//
// Cards carry their board-space geometry as inline left/top/width/height, so
// these are exact assertions rather than screenshot comparisons.

import { test, expect } from '@playwright/test';

// Board-space geometry of every mounted card, straight off the inline style.
async function geometry(page) {
  return page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('[data-card-id]')].map(el => [
      el.getAttribute('data-card-id'),
      `${el.style.left}|${el.style.top}|${el.style.width}|${el.style.height}`,
    ]),
  ));
}

const shared = (a, b) => Object.keys(a).filter(k => k in b);

async function boot(page) {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  // Frame everything so viewport culling isn't quietly deciding which cards
  // this test is allowed to see.
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(400);
}

async function enterCapture(page) {
  await page.keyboard.press('Control+Shift+Period');
  await expect(page.locator('html[data-capture-ready="1"]')).toHaveCount(1);
  await expect(page.locator('.capture-hud')).toBeVisible();
}

const reframeChip = (page) => page.locator('.capture-hud-chip', { hasText: 'Reframe' });

test('reframing moves the cards, and putting it back is exact', async ({ page }) => {
  await boot(page);
  const before = await geometry(page);
  expect(Object.keys(before).length).toBeGreaterThan(2);

  await enterCapture(page);
  await reframeChip(page).click();
  await page.waitForTimeout(400);

  const during = await geometry(page);
  const keys = shared(before, during);
  expect(keys.length).toBeGreaterThan(1);
  expect(keys.some(k => before[k] !== during[k]), 'nothing moved — the reframe did nothing').toBe(true);

  await reframeChip(page).click();
  await page.waitForTimeout(400);

  const after = await geometry(page);
  for (const k of shared(before, after)) {
    expect(after[k], `card ${k} did not return to where it started`).toBe(before[k]);
  }
});

test('the reframe reaches nothing outside this tab', async ({ page }) => {
  await boot(page);
  const before = await geometry(page);

  await enterCapture(page);
  await reframeChip(page).click();
  await page.waitForTimeout(400);
  expect(await geometry(page)).not.toEqual(before);

  // The staging FLAGS live in sessionStorage on purpose, so a reload mid-shoot
  // resumes where you left off. Clearing them models the thing that actually
  // matters: a fresh tab, or a collaborator, or the same board tomorrow. What
  // they must see is the real board, because the reframe was never written.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/?local=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(400);

  const after = await geometry(page);
  expect(await page.locator('.capture-hud').count(), 'capture came back on its own').toBe(0);
  for (const k of shared(before, after)) {
    expect(after[k], `card ${k} kept a reframed position outside the shoot`).toBe(before[k]);
  }
});

test('dragging while reframed cannot write a position into the document', async ({ page }) => {
  await boot(page);
  const before = await geometry(page);

  await enterCapture(page);
  await reframeChip(page).click();
  await page.waitForTimeout(400);

  // Drag a card a long way. The canvas will show it move under the pointer;
  // what must not happen is the release committing that position.
  const card = page.locator('[data-card-id]').first();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2 + 160, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Leave capture entirely; the real board must be untouched.
  await reframeChip(page).click();
  await page.keyboard.press('Control+Shift+Period');
  await page.waitForTimeout(400);

  const after = await geometry(page);
  for (const k of shared(before, after)) {
    expect(after[k], `a drag during capture was committed for card ${k}`).toBe(before[k]);
  }
});

test('arrows follow the reframed cards instead of detaching', async ({ page }) => {
  await boot(page);

  // Draw an arrow between the first two cards: 'a' selects the arrow tool,
  // then a click on each end. Nothing in the fixture ships with arrows.
  const cards = page.locator('[data-card-id]');
  const a = await cards.nth(0).boundingBox();
  const b = await cards.nth(1).boundingBox();
  await page.keyboard.press('a');
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.press('v');

  const line = page.locator('[data-arrow-line]').first();
  await expect(line, 'no arrow was drawn — the tool interaction changed').toBeVisible();
  const beforeD = await line.getAttribute('d');

  await enterCapture(page);
  await reframeChip(page).click();
  await page.waitForTimeout(500);

  const afterD = await line.getAttribute('d');
  expect(afterD, 'the arrow stayed put while its cards moved — it has detached').not.toBe(beforeD);
});

test('the cinematic camera moves the view and settles', async ({ page }) => {
  await boot(page);
  await enterCapture(page);

  const pose = () => page.evaluate(() => document.querySelector('.canvas')?.style.transform || '');
  // Zoom in first so "Fit" has somewhere to travel from.
  await page.keyboard.press('Control+Equal');
  await page.keyboard.press('Control+Equal');
  await page.waitForTimeout(300);
  const before = await pose();

  await page.locator('.capture-hud-btn', { hasText: 'Fit' }).click();

  // It must ANIMATE, not jump: sample mid-flight and require an intermediate
  // pose that is neither where we started nor where we end up.
  await page.waitForTimeout(300);
  const midFlight = await pose();
  expect(midFlight).not.toBe(before);

  // CAMERA_MS is 900; wait it out plus a margin for the final state commit.
  await page.waitForTimeout(1100);
  const settled = await pose();
  expect(settled).toMatch(/scale\(/);
  expect(settled).not.toBe(before);
  expect(settled, 'the camera never left its first frame').not.toBe(midFlight);

  // And it must actually STOP. A tween that never commits leaves the transform
  // drifting, which is invisible on screen and ruinous in a recording.
  await page.waitForTimeout(600);
  expect(await pose()).toBe(settled);
});
