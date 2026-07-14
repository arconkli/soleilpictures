// Momentum beat: after a phone user's FIRST photo batch lands and they're still
// short of a populated board (<3 genuine cards), a one-time toast nudges them to
// add a few more — tapping it re-opens the camera-roll multi-select. Once per
// device, ever. Runs on the phone projects (isPhone-gated, like the puck).
import { expect, test } from '@playwright/test';

// 1x1 transparent PNG — enough for classifyDropFile to route it as an image.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (momentum nudge is isPhone-gated, like the create puck)');
});

async function pickOnePhoto(page) {
  const puck = page.getByRole('button', { name: 'Add a card' });
  await expect(puck).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    puck.tap(),
  ]);
  await chooser.setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
}

test('first photo on an empty board raises a one-time "add a few more" nudge', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  // clean slate for the once-per-device stamp
  await page.evaluate(() => localStorage.removeItem('soleil.momentumHintSeen'));

  await pickOnePhoto(page);

  const toast = page.locator('.toast, [role="status"]').filter({ hasText: /add a few more|add more|3\+/i });
  await expect(toast.first()).toBeVisible({ timeout: 5000 });
  // stamped once it shows
  expect(await page.evaluate(() => localStorage.getItem('soleil.momentumHintSeen'))).toBe('1');
});

test('the nudge action re-opens the camera-roll picker', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => localStorage.removeItem('soleil.momentumHintSeen'));

  await pickOnePhoto(page);
  const addMore = page.getByRole('button', { name: /add more|add a few more/i });
  await expect(addMore).toBeVisible({ timeout: 5000 });

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    addMore.tap(),
  ]);
  expect(chooser.isMultiple()).toBe(true);
  expect(await chooser.element().getAttribute('accept')).toBe('image/*');
});

test('the nudge never fires twice (once-per-device stamp)', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  // simulate a user who has already seen it
  await page.evaluate(() => localStorage.setItem('soleil.momentumHintSeen', '1'));

  await pickOnePhoto(page);

  const toast = page.locator('.toast, [role="status"]').filter({ hasText: /add a few more|add more|3\+/i });
  await expect(toast).toHaveCount(0);
});
