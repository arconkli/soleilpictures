// Camera-roll-first mobile activation: the phone's primary create paths lead
// to a photo multi-select (images are THE activation signal — zero note-only
// users have ever activated). Runs on the mobile-chrome / mobile-safari
// projects (Pixel 5 / iPhone 13 device descriptors → coarse pointer).
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (bottom-nav create puck is isPhone-gated)');
});

test('empty board: the "+" puck opens the photo picker in one tap (no note, no sheet)', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });

  const puck = page.getByRole('button', { name: 'Add a card' });
  await expect(puck).toBeVisible();

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    puck.tap(),
  ]);
  expect(chooser.isMultiple()).toBe(true);
  expect(await chooser.element().getAttribute('accept')).toBe('image/*');
  // No type-picker sheet and no reflexive note card.
  await expect(page.locator('.mobile-add-grid')).toHaveCount(0);
  await expect(page.locator('.bc')).toHaveCount(0);
});

test('non-empty board: the add sheet leads with Photos and it opens the picker', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Add a card' }).tap();
  const grid = page.locator('.mobile-add-grid');
  await expect(grid).toBeVisible();
  await expect(grid.locator('.mobile-add-tile').first()).toContainText('Photos');

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    grid.locator('.mobile-add-tile').first().tap(),
  ]);
  expect(chooser.isMultiple()).toBe(true);
  expect(await chooser.element().getAttribute('accept')).toBe('image/*');
});

test('tour content step shows the touch "Add photos" action and hands it to the app', async ({ page }) => {
  await page.goto('/?tourqa=1');
  await expect(page.locator('#tourqa-ready')).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const T = window.__soleilTourTest;
    for (const e of [
      { type: 'cluster_created', boardId: 'b1' },
      { type: 'cluster_renamed', boardId: 'b1' },
      { type: 'cluster_opened', boardId: 'b1' },
      { type: 'nav_ack' },
    ]) T.fire(e);
  });
  const pill = page.locator('.onboarding-tour');
  await expect(pill).toContainText('Now add anything');

  const addPhotos = pill.getByRole('button', { name: 'Add photos' });
  await expect(addPhotos).toBeVisible();
  await addPhotos.tap();
  expect(await page.evaluate(() => window.__soleilTourTest.getActions())).toEqual(['pick_photos']);
  // The action alone must NOT advance the step — content_added does that.
  await expect(pill).toContainText('Now add anything');
});
