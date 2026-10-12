// `blank=1`: these right-click the bare canvas, and the local seed grew to
// ~10 cards — a fixed-position click lands on one and opens the CARD menu
// instead of the background one. It also pins autoFrame off so the camera does
// not move under the click.
import { expect, test } from '@playwright/test';

test('canvas comment draft autofocuses its input on open', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  const cb = await page.locator('.canvas-wrap').boundingBox();
  // Right-click an empty area → background menu → Add → Comment (the comment
  // item lives in the Add submenu now, as comment-draft-keeps-text does it).
  await page.mouse.click(cb.x + cb.width - 90, cb.y + 110, { button: 'right' });
  await page.locator('.ctx-submenu-wrap', { hasText: 'Add' }).first().hover();
  await page.locator('.ctx-submenu').getByRole('button', { name: 'Comment', exact: true }).first().click();
  const input = page.locator('.canvas-comment-draft-input');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  // Enter posts (the draft textarea already had this) — Shift+Enter would newline.
  // The ?local=1 harness has no Supabase, so the post fails, and since SHARE-11
  // a failed post keeps the draft and its text: the failure toast is the proof
  // that Enter submitted (comment-draft-keeps-text covers the keep).
  await input.fill('hello');
  await input.press('Enter');
  await expect(page.locator('.toast-msg').filter({ hasText: 'Comment failed' })).toBeVisible();
  await expect(input).toHaveValue('hello');
});
