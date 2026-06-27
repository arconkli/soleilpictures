import { expect, test } from '@playwright/test';

// Mobile first-card affordance: on an EMPTY board the bottom-nav "+" must drop a
// card in ONE tap — not open the multi-tile "Add to board" type-picker sheet.
// Mobile first-card converts at <half of desktop, so the very first action has to
// be a single obvious tap, not a second decision. (On a non-empty board the full
// sheet still returns for power users — that path is unchanged.)

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'mobile bottom-nav flow');
  // onboard mode seeds a real EMPTY "Ideas" child board — the clean empty-canvas the
  // one-tap path targets (the default local root carries demo cards).
  await page.goto('/?local=1&onboard=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
});

test('bottom-nav + drops a card in one tap on an empty board (no type-picker sheet)', async ({ page }) => {
  // Drill into the empty Ideas board (a single clean tap on its board card opens it).
  await page.locator('[data-card-id="local-ideas"]').click();
  await expect(page.locator('[data-card-id]')).toHaveCount(0);   // Ideas starts empty

  const createBtn = page.getByRole('button', { name: 'Add a card' });
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  // One tap → exactly one card, and the multi-tile "Add to board" sheet never opened.
  await expect(page.locator('[data-card-id]')).toHaveCount(1);
  await expect(page.locator('.mobile-add-grid')).toHaveCount(0);
});
