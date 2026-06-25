import { expect, test } from '@playwright/test';

// Phone bottom-nav "+" create button.
//
// The mobile activation cliff: card creation lived only in a desktop-style
// left-edge toolbar, so phone users never made a first card. The first fix put
// a bold, thumb-reachable "+" in the centre of the bottom nav. It now opens the
// FULL add sheet (board / image / file / note / doc / shape / palette / link /
// comment / vote) instead of only adding a note — so every content type is
// reachable on phones. These tests lock that in.
//
// The "+" is phone-only (it renders inside MobileBottomNav, which only mounts
// at ≤640px), so skip the desktop + tablet projects.

const ADD_LABELS = [
  'Board', 'Image', 'File', 'Text note', 'Doc',
  'Shape', 'Color palette', 'Link', 'Comment', 'Vote',
];

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

test('tapping "+" opens the full add sheet with every option', async ({ page }) => {
  await page.locator('.mb-nav-create').tap();
  await expect(page.locator('.sheet-panel')).toBeVisible();
  await expect(page.locator('.mobile-add-grid')).toBeVisible();
  for (const label of ADD_LABELS) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
});

test('picking "Text note" from the sheet creates a focused note', async ({ page }) => {
  const cards = page.locator('.cards-layer .card');
  const notes = page.locator('.cards-layer .card.card-kind-note');
  const before = await cards.count();
  const notesBefore = await notes.count();

  await page.locator('.mb-nav-create').tap();
  await page.getByRole('button', { name: 'Text note', exact: true }).tap();

  // The sheet closes, and a new note card appears at viewport centre.
  await expect(page.locator('.sheet-panel')).toHaveCount(0);
  await expect(cards).toHaveCount(before + 1);
  await expect(notes).toHaveCount(notesBefore + 1);

  // ...and it opened in edit mode (addNote → setAutoFocusId).
  await expect.poll(() => page.evaluate(() => {
    const a = document.activeElement;
    return !!(a && (a.isContentEditable || a.closest?.('.card-kind-note')));
  })).toBe(true);
});

test('tapping the backdrop dismisses the sheet without adding a card', async ({ page }) => {
  const cards = page.locator('.cards-layer .card');
  const before = await cards.count();

  await page.locator('.mb-nav-create').tap();
  await expect(page.locator('.sheet-panel')).toBeVisible();
  await page.locator('.sheet-backdrop').tap();

  await expect(page.locator('.sheet-panel')).toHaveCount(0);
  await expect(cards).toHaveCount(before);
});

test('the "+" is hidden when a non-board surface (Search) is open', async ({ page }) => {
  await expect(page.locator('.mb-nav-create')).toBeVisible();
  await page.locator('.mb-nav-tab').nth(1).tap(); // Search → command palette
  await expect(page.locator('.cmdk')).toBeVisible();
  await expect(page.locator('.mb-nav-create')).toHaveCount(0);
});
