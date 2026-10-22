// Replace All says what it did: how many it replaced, in the find bar and in a
// toast whose Undo puts every one back, as one step, and only while nothing
// has changed since (lib/undoToast.js); ⌘Z takes it back as one step too,
// apart from typing just before it.
import { expect, test } from '@playwright/test';
import { todaysLook } from './helpers/docFrame.js';

// Today's find bar. The look's Find is in its side panel: doc-panel-find.spec.js.
test.beforeEach(({ page }) => todaysLook(page));

const TEXT = 'The cat sat on the cat mat, and the cat slept.';

async function openWithFind(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 15000 });
  await page.evaluate((t) => window.__soleilDocTest.editor.commands.setContent(`<p>${t}</p>`), TEXT);
  await page.locator('.doc-card-modal .tt-editor').first().click();
}
async function replaceAll(page, find, replace) {
  await page.keyboard.press('ControlOrMeta+f');
  await page.locator('.doc-card-modal .doc-find-input').first().fill(find);
  await page.locator('.doc-card-modal').getByRole('button', { name: 'Toggle replace' }).click();
  await page.locator('.doc-card-modal .doc-find-input--replace').fill(replace);
  await page.locator('.doc-card-modal .doc-find').getByRole('button', { name: 'All' }).click();
}
const text = (page) => page.evaluate(() => window.__soleilDocTest.editor.getText());

test('Replace All says how many it replaced, and the toast\'s Undo puts every one back', async ({ page }) => {
  await openWithFind(page);
  await replaceAll(page, 'cat', 'dog');
  await expect.poll(() => text(page)).toBe(TEXT.replaceAll('cat', 'dog'));
  await expect(page.locator('.doc-card-modal .doc-find-count')).toHaveText('3 replaced');
  const toast = page.locator('.toast', { hasText: 'Replaced 3 matches' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => text(page)).toBe(TEXT);
});

test('replacing with nothing says it deleted them', async ({ page }) => {
  await openWithFind(page);
  await replaceAll(page, ' cat', '');
  await expect.poll(() => text(page)).toBe(TEXT.replaceAll(' cat', ''));
  await expect(page.locator('.doc-card-modal .doc-find-count')).toHaveText('3 deleted');
  await expect(page.locator('.toast', { hasText: 'Deleted 3 matches' })).toBeVisible();
});

test('the toast\'s Undo won\'t take back typing done since; it says to use ⌘Z', async ({ page }) => {
  await openWithFind(page);
  await replaceAll(page, 'cat', 'dog');
  const toast = page.locator('.toast', { hasText: 'Replaced 3 matches' });
  await expect(toast).toBeVisible();
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.chain().focus('end').insertContent(' Then it woke.').run();
  });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast', { hasText: '⌘Z' })).toBeVisible();
  expect(await text(page)).toBe(`${TEXT.replaceAll('cat', 'dog')} Then it woke.`);
});

test('⌘Z takes Replace All back as one step, leaving the typing just before it', async ({ page }) => {
  await openWithFind(page);
  await page.keyboard.press('End');
  await page.keyboard.type(' Meow.');
  await replaceAll(page, 'cat', 'dog');
  await expect.poll(() => text(page)).toBe(`${TEXT.replaceAll('cat', 'dog')} Meow.`);
  await page.locator('.doc-card-modal .tt-editor').first().click();
  // The harness's Chrome reports Windows, so the editor's Mod is Control.
  await page.keyboard.press('Control+z');
  await expect.poll(() => text(page)).toBe(`${TEXT} Meow.`);
});
