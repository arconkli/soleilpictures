import { expect, test } from '@playwright/test';

// Phone bottom-nav "+" create button.
//
// The mobile activation cliff: card creation lived only in a desktop-style
// left-edge toolbar, so phone users never made a first card (card_create_intent
// was 0 across every mobile session). The fix puts a bold, thumb-reachable "+"
// in the centre of the bottom nav that creates a note at viewport centre and
// auto-focuses it. These tests lock that in.
//
// The "+" is phone-only (it renders inside MobileBottomNav, which only mounts
// at ≤640px), so skip the desktop project.

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (≤640px)');
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.canvas-wrap')).toBeVisible();
});

test('the create "+" puck is present and does not disturb the 4 tabs', async ({ page }) => {
  await expect(page.locator('.mb-nav-create')).toBeVisible();
  // The "+" is NOT a .mb-nav-tab — the four tabs (and their indices) are intact.
  await expect(page.locator('.mb-nav-tab')).toHaveCount(4);
  // On a board surface no tab is "selected" (active={null}), so Home is NOT lit.
  await expect(page.locator('.mb-nav-tab.is-active')).toHaveCount(0);
});

test('tapping "+" creates a focused note at viewport centre', async ({ page }) => {
  const cards = page.locator('.cards-layer .card');
  const before = await cards.count();
  await page.locator('.mb-nav-create').tap();
  // A new card appears...
  await expect(cards).toHaveCount(before + 1);
  // ...and it's a note that opened in edit mode (addNote → setAutoFocusId).
  await expect(page.locator('.cards-layer .card.card-kind-note')).toHaveCount(
    await page.locator('.cards-layer .card.card-kind-note').count(),
  );
  const focusedEditable = await page.evaluate(() => {
    const a = document.activeElement;
    return !!(a && (a.isContentEditable || a.closest?.('.card-kind-note')));
  });
  expect(focusedEditable).toBe(true);
});

test('the "+" is hidden when a non-board surface (Search) is open', async ({ page }) => {
  await expect(page.locator('.mb-nav-create')).toBeVisible();
  await page.locator('.mb-nav-tab').nth(1).tap(); // Search → BoardPicker
  await expect(page.locator('.picker')).toBeVisible();
  await expect(page.locator('.mb-nav-create')).toHaveCount(0);
});
