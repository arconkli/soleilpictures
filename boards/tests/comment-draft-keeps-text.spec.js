// comment-draft-keeps-text.spec.js
//
// SHARE-11: a canvas comment whose post failed closed its draft anyway (a
// `finally` cleared it), so the error arrived with the text already gone. The
// ?local=1 harness has no Supabase, so every post there fails, which is
// exactly the path under test.
//
// The draft is the shared comment card now (.cmt-canvas-card, opened beside
// its pin with nothing in it yet), and a post that fails says so under the
// box it was typed in, not in a toast.
//
// `blank=1`: the seeded cards would catch a fixed-position right-click and
// open the card menu instead of the background one (see ws7-composers).

import { expect, test } from '@playwright/test';

test('a comment that fails to post keeps its draft and its text', async ({ page }) => {
  // Refused at once: left to the network, the refusal takes seconds.
  await page.route('**/rest/v1/comments**', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"refused by the test"}' })
    : route.fallback()));
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.click(cb.x + cb.width - 90, cb.y + 110, { button: 'right' });
  await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Comment', exact: true }).click();

  const card = page.locator('.cmt-canvas-card');
  const input = card.locator('textarea.cmt-input');
  await expect(input).toBeFocused();
  await input.fill('The cut at 01:12 is late');
  await input.press('Enter');

  await expect(card.getByRole('alert')).toHaveText("Couldn't send. Your words are still here.");
  // Still open, still holding what was typed, and ready to try again.
  await expect(input).toHaveValue('The cut at 01:12 is late');
  await expect(card.locator('.cmt-send')).toBeEnabled();
  // …and still on the pin it was started from.
  await expect(page.locator('.cmt-pin--draft.is-open')).toHaveCount(1);
});
