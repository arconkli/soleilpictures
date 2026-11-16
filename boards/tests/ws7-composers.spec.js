// `blank=1`: these right-click the bare canvas, and the local seed grew to
// ~10 cards — a fixed-position click lands on one and opens the CARD menu
// instead of the background one. It also pins autoFrame off so the camera does
// not move under the click.
import { expect, test } from '@playwright/test';

test('canvas comment draft autofocuses its input on open', async ({ page }) => {
  // Refused at once: left to the network, the refusal takes seconds.
  await page.route('**/rest/v1/comments**', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"refused by the test"}' })
    : route.fallback()));
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  const cb = await page.locator('.canvas-wrap').boundingBox();
  // Right-click an empty area → background menu → Add → Comment (the comment
  // item lives in the Add submenu now, as comment-draft-keeps-text does it).
  await page.mouse.click(cb.x + cb.width - 90, cb.y + 110, { button: 'right' });
  await page.locator('.ctx-submenu-wrap', { hasText: 'Add' }).first().hover();
  await page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Comment', exact: true }).first().click();
  // The draft is the shared comment card, opened beside its pin.
  const card = page.locator('.cmt-canvas-card');
  const input = card.locator('textarea.cmt-input');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  // Enter posts — Shift+Enter would newline. The ?local=1 harness has no
  // Supabase, so the post fails, and since SHARE-11 a failed post keeps the
  // draft and its text: the line under the box is the proof that Enter
  // submitted (comment-draft-keeps-text covers the keep).
  await input.fill('hello');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('hello\n');
  await expect(card.getByRole('alert')).toHaveCount(0);
  await input.fill('hello');
  await input.press('Enter');
  await expect(card.getByRole('alert')).toContainText("Couldn't send");
  await expect(input).toHaveValue('hello');
});
