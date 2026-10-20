import { expect, test } from '@playwright/test';

// The message composer under a finger (Messages QA harness, ?msgqa=1): the
// return key on a touch keyboard makes a new line and the Send button sends,
// in the composer and in the edit box alike.

async function open(page) {
  await page.goto('/?msgqa=1&phone=1&conv=c-maya');
  await page.waitForSelector('html[data-msgqa-ready="1"]');
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'a touch device').toBe(true);
}

test('the return key makes a new line, and Send sends', async ({ page }) => {
  await open(page);
  const input = page.locator('.msg-composer-input');
  await input.tap();
  await page.keyboard.type('first line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second line');
  await expect(input).toHaveValue('first line\nsecond line');
  await expect(page.locator('.msg-bubble-body', { hasText: 'second line' })).toHaveCount(0);
  await page.locator('.msg-composer-send').tap();
  await expect(page.locator('.msg-bubble-body', { hasText: 'second line' })).toBeVisible();
  await expect(input).toHaveValue('');
});

test('editing a message: return makes a new line, Save saves', async ({ page }) => {
  await open(page);
  const input = page.locator('.msg-composer-input');
  await input.tap();
  await page.keyboard.type('to be edited');
  await page.locator('.msg-composer-send').tap();
  const sent = page.locator('.msg-bubble', { has: page.locator('.msg-bubble-body', { hasText: 'to be edited' }) }).last();
  await expect(sent).not.toHaveClass(/msg-bubble--pending/); // only a saved message can be edited
  const id = await sent.getAttribute('data-msg-id');
  // The body gives way to the edit box, so find the message by its id from here.
  const mine = page.locator(`.msg-bubble[data-msg-id="${id}"]`);
  await page.evaluate((msgId) => document.dispatchEvent(new CustomEvent('soleil-msg-edit', { detail: { id: msgId } })), id);
  const box = mine.locator('textarea.msg-composer-input');
  await expect(box).toBeFocused();
  await page.keyboard.press('Enter'); // the caret starts after the text
  await page.keyboard.type('and more');
  await expect(box).toHaveValue('to be edited\nand more');
  await mine.getByRole('button', { name: 'Save' }).tap();
  await expect(mine.locator('.msg-bubble-body')).toContainText('and more');
});

test('a conversation opens without raising the keyboard: the panel has focus, not the box', async ({ page }) => {
  await open(page);
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('msg-pane-thread'))).toBe(true);
  await expect(page.locator('.msg-composer-input')).not.toBeFocused();
});
