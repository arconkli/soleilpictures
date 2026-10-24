// comment-draft-keeps-text.spec.js
//
// SHARE-11: a canvas comment whose post failed closed its draft anyway (a
// `finally` cleared it), so the error toast arrived with the text already
// gone. The ?local=1 harness has no Supabase, so every post there fails,
// which is exactly the path under test.
//
// `blank=1`: the seeded cards would catch a fixed-position right-click and
// open the card menu instead of the background one (see ws7-composers).

import { expect, test } from '@playwright/test';

test('a comment that fails to post keeps its draft and its text', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.click(cb.x + cb.width - 90, cb.y + 110, { button: 'right' });
  await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Comment', exact: true }).click();

  const input = page.locator('.canvas-comment-draft-input');
  await expect(input).toBeFocused();
  await input.fill('The cut at 01:12 is late');
  await input.press('Enter');

  await expect(page.locator('.toast-msg').filter({ hasText: 'Comment failed' })).toBeVisible();
  await expect(page.locator('.toast-msg').filter({ hasText: 'your text is still there' })).toBeVisible();
  // Still open, still holding what was typed, and ready to try again.
  await expect(input).toHaveValue('The cut at 01:12 is late');
  await expect(page.locator('.canvas-comment-draft-post')).toBeEnabled();
});
