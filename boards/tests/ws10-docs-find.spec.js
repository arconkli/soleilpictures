import { expect, test } from '@playwright/test';

async function openDocEditor(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.locator('.tt-editor').first().click();
}

test('docs Find: Escape closes and returns focus to the editor', async ({ page }) => {
  await openDocEditor(page);
  await page.keyboard.type('alpha beta alpha beta alpha');
  await page.keyboard.press('ControlOrMeta+f');
  const findInput = page.locator('.doc-find-input').first();
  await expect(findInput).toBeVisible();
  await findInput.click();
  await page.keyboard.type('alpha');
  await expect(page.locator('.doc-find-count')).toContainText('/3');

  // Escape closes the bar...
  await page.keyboard.press('Escape');
  await expect(page.locator('.doc-find')).toHaveCount(0);
  // ...and focus is back in the editor (next-frame, after the input unmounts):
  // the next keystroke lands in the doc.
  await page.waitForTimeout(60);
  await page.keyboard.type('Z');
  expect(await page.evaluate(() => window.__soleilDocTest.editor.getText())).toContain('Z');
});

test('docs Find spans every sheet of a page (not just the focused one)', async ({ page }) => {
  await openDocEditor(page);
  await page.keyboard.type('FINDME on page one');
  // Add a second sheet and type a second match into it.
  await page.locator('.doc-card-modal .doc-add-page-below').click();
  await expect(page.locator('.doc-card-modal .doc-editor-wrap')).toHaveCount(2);
  await page.locator('.doc-card-modal .tt-editor').nth(1).click();
  await page.keyboard.type('FINDME on page two');
  // Find sees BOTH sheets.
  await page.keyboard.press('ControlOrMeta+f');
  await page.locator('.doc-find-input').first().click();
  await page.keyboard.type('FINDME');
  await expect(page.locator('.doc-find-count')).toContainText('/2');
  // A highlight is painted in each sheet.
  await expect(page.locator('.doc-card-modal .doc-find-hit')).toHaveCount(2);
});

test('docs Replace preserves marks on the replaced text', async ({ page }) => {
  await openDocEditor(page);
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent('<p>plain <strong>TARGET</strong> end</p>'));
  await page.keyboard.press('ControlOrMeta+f');
  await page.locator('.doc-find-input').first().click();
  await page.keyboard.type('TARGET');
  await page.locator('.doc-find-btn[title="Replace"]').click();
  await page.getByPlaceholder('Replace').fill('SWAPPED');
  await page.getByRole('button', { name: 'All' }).click();
  await page.waitForTimeout(120);
  const html = await page.evaluate(() => window.__soleilDocTest.editor.getHTML());
  expect(html).toContain('<strong>SWAPPED</strong>');
});

test('docs Find: Escape from the Replace field collapses Replace, not the bar', async ({ page }) => {
  await openDocEditor(page);
  await page.keyboard.type('foo foo foo');
  await page.keyboard.press('ControlOrMeta+f');
  await page.locator('.doc-find-input').first().click();
  await page.keyboard.type('foo');
  // Reveal Replace and focus its field.
  await page.locator('.doc-find-btn[title="Replace"]').click();
  const replaceInput = page.getByPlaceholder('Replace');
  await replaceInput.click();
  // Escape from the Replace field collapses Replace but keeps the find bar open.
  await replaceInput.press('Escape');
  await expect(page.getByPlaceholder('Replace')).toHaveCount(0);
  await expect(page.locator('.doc-find')).toBeVisible();
});
