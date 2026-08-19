// The mobile tour pill has to keep its own controls ON the pill.
//
// `.onboarding-tour` is a non-wrapping flex row capped at
// min(340px, 100vw - 24px). On a phone that box cannot hold the copy, a
// full-width "Add photos" action AND Skip side by side, so the actions row
// overflowed: measured on a 390px viewport, Skip rendered ~34px OUTSIDE the
// frosted surface, floating on bare canvas beside the primary button. It still
// worked, it just looked broken — on the one step that carries mobile
// activation, where the primary action is the entire point of the step.
//
// These assertions are geometric rather than visual so they fail for the right
// reason: every control's box must sit inside the pill's box.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'phone/tablet layout only');
});

const contains = (outer, inner, slack = 1) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack;

test('the add_photos pill keeps Add photos and Skip inside its own surface', async ({ page }) => {
  await page.goto('/?tourqa=1&variant=mobile');
  await page.waitForSelector('[data-tourqa-ready="1"]', { timeout: 15000 });

  const pill = page.locator('.onboarding-tour');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Add your photos');

  const pillBox = await pill.boundingBox();
  const addBox  = await pill.getByRole('button', { name: /add photos/i }).boundingBox();
  const skipBox = await pill.getByRole('button', { name: /skip/i }).boundingBox();

  expect(contains(pillBox, addBox), 'the "Add photos" action must sit on the pill').toBe(true);
  expect(contains(pillBox, skipBox), 'Skip must sit on the pill, not on bare canvas').toBe(true);
});

test('the pill and its primary action are fully on screen and thumb-sized', async ({ page }) => {
  await page.goto('/?tourqa=1&variant=mobile');
  await page.waitForSelector('[data-tourqa-ready="1"]', { timeout: 15000 });

  const pill = page.locator('.onboarding-tour');
  const vp = page.viewportSize();
  const pillBox = await pill.boundingBox();
  const addBox = await pill.getByRole('button', { name: /add photos/i }).boundingBox();

  expect(pillBox.x).toBeGreaterThanOrEqual(0);
  expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(vp.width + 1);
  expect(addBox.y + addBox.height).toBeLessThanOrEqual(vp.height);
  // The camera roll is this step's whole job; the button that opens it should
  // not be a 30px sliver on a touch screen.
  expect(addBox.height).toBeGreaterThanOrEqual(38);
});
