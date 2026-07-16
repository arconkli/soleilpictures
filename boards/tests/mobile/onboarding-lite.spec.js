// Live-canvas walk of the phones-only mobile_lite tour via the DEV ?tour=mobile
// preview (LocalBoardsApp mounts the REAL OnboardingTour + engine over the real
// bottom-nav puck — no Supabase). The invariant the desktop tour got wrong on
// phones: the bottom-nav "+" stays LIVE during onboarding (no body lock), so the
// one-tap camera roll — the mobile activation superpower — actually works.
import { expect, test } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (mobile_lite tour anchors the isPhone bottom-nav puck)');
});

test('opens on the photos step, anchored to the puck, WITHOUT locking the app', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1&tour=mobile');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });

  const pill = page.locator('.onboarding-tour');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Add your photos');
  await expect(pill).toHaveAttribute('data-tour-anchor', 'mb-create');
  // The lock the desktop tour uses would disable the puck — it must be absent.
  await expect(page.locator('body')).not.toHaveAttribute('data-tour-active', '1');
  await expect(page.locator('body')).toHaveAttribute('data-tour-variant', 'mobile');
  await expect(page.locator('[data-tour="mb-create"]')).toHaveClass(/tour-target/);
  // The competing empty-state tiles (incl. the "Cluster" tile that used to
  // complete the tour with zero photos) must be hidden during the tour, leaving
  // the ringed puck as the single obvious CTA.
  await expect(page.locator('.cnv-empty-tiles')).toBeHidden();
});

test('the puck is live during the tour and opens the camera-roll multi-select', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1&tour=mobile');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });

  const puck = page.getByRole('button', { name: 'Add a card' });
  await expect(puck).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    puck.tap(),
  ]);
  expect(chooser.isMultiple()).toBe(true);
  expect(await chooser.element().getAttribute('accept')).toBe('image/*');
});

test('adding an image advances to the group step; Done completes the tour', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1&tour=mobile');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  const pill = page.locator('.onboarding-tour');
  await expect(pill).toContainText('Add your photos');

  // Add a real image through the live picker (proves the whole content path).
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.getByRole('button', { name: 'Add a card' }).tap(),
  ]);
  await chooser.setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });

  await expect(pill).toContainText('Group them into a cluster');
  await pill.getByRole('button', { name: /done/i }).tap();
  await expect(page.locator('.onboarding-tour')).toHaveCount(0);
});
