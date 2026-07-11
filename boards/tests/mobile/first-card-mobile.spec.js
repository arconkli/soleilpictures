import { expect, test } from '@playwright/test';

// Mobile first-card affordance: on an EMPTY board the bottom-nav "+" must open
// the camera-roll photo picker in ONE tap — not the multi-tile type-picker
// sheet, and not a reflexive note (zero note-only users ever activated; images
// are THE activation signal). On a non-empty board the full sheet still
// returns for power users — that path is covered by create-button.spec.js.

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'mobile bottom-nav flow');
  // blank=1 seeds a clean EMPTY root cluster — the exact first-run canvas the
  // one-tap path targets (the default local root carries demo cards).
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
});

test('bottom-nav + opens the photo picker in one tap on an empty board (no sheet, no note)', async ({ page }) => {
  await expect(page.locator('[data-card-id]')).toHaveCount(0);   // truly empty

  const createBtn = page.getByRole('button', { name: 'Add a card' });
  await expect(createBtn).toBeVisible();

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    createBtn.tap(),
  ]);
  expect(chooser.isMultiple()).toBe(true);
  expect(await chooser.element().getAttribute('accept')).toBe('image/*');

  // No type-picker sheet, and no card materialized without a pick.
  await expect(page.locator('.mobile-add-grid')).toHaveCount(0);
  await expect(page.locator('[data-card-id]')).toHaveCount(0);
});
