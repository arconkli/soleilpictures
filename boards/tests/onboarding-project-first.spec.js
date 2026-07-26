// Live-canvas walk of the desktop project_first tour via the DEV ?tour=project
// preview (LocalBoardsApp mounts the REAL OnboardingTour + engine over the real
// canvas — no Supabase). This is the mechanics-tour retirement: first-run asks
// what the user is working on, seeds a cluster NAMED for their answer, then
// goes straight to content — nothing locked, everything skippable.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome',
    'desktop-width only (project_first is the non-phone variant)');
  await page.goto('/?local=1&reset=1&blank=1&tour=project');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
});

test('opens on the centered intent card: four choices, nothing locked, tiles hidden', async ({ page }) => {
  const pill = page.locator('.onboarding-tour');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('What are you working on?');
  await expect(pill).toHaveClass(/tour-centered/);
  await expect(pill.locator('.onboarding-tour-choice')).toHaveCount(4);
  // Unlocked (the old tour's body lock must be absent) + the variant styling
  // hook that hides the competing empty-state tiles.
  await expect(page.locator('body')).not.toHaveAttribute('data-tour-active', '1');
  await expect(page.locator('body')).toHaveAttribute('data-tour-variant', 'project');
  await expect(page.locator('.cnv-empty-tiles')).toBeHidden();
});

test('picking an intent seeds a cluster named for it and advances to the content step', async ({ page }) => {
  const pill = page.locator('.onboarding-tour');
  await pill.getByRole('button', { name: 'A moodboard' }).click();

  // The named project cluster lands on the canvas — already named, so no
  // rename-editing session opens (pre-named seeds skip the autofocus).
  await expect(page.locator('.canvas-wrap')).toContainText('Moodboard');

  // And the tour moved on to the content-first close.
  await expect(pill).toContainText('Now drop your stuff in');
  await expect(page.locator('body')).toHaveAttribute('data-tour-variant', 'project');
});

test('dropping content after the pick completes the tour', async ({ page }) => {
  const pill = page.locator('.onboarding-tour');
  await pill.getByRole('button', { name: 'Collecting references' }).click();
  await expect(pill).toContainText('Now drop your stuff in');

  // Add a note through the live rail (unlocked during the tour) — any content
  // completes the project_first close.
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 640, y: 420 } });

  await expect(page.locator('.onboarding-tour')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-tour-variant', 'project');
});

test('a self-directed user who ignores the ask is never stuck: content completes everything', async ({ page }) => {
  const pill = page.locator('.onboarding-tour');
  await expect(pill).toContainText('What are you working on?');

  // Ignore the card entirely and just make a note — skip-ahead finishes the
  // tour. (Click well clear of the centered intent card, which owns mid-canvas.)
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 220, y: 560 } });

  await expect(page.locator('.onboarding-tour')).toHaveCount(0);
});

test('Skip ends the ask immediately', async ({ page }) => {
  const pill = page.locator('.onboarding-tour');
  await pill.getByRole('button', { name: /skip/i }).click();
  await expect(page.locator('.onboarding-tour')).toHaveCount(0);
});
