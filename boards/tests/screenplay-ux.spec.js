// Real-editor screenplay tests in the ?docqa=1 harness: toggling screenplay
// mode, the Courier layout class, Tab/Enter element cycling, and auto-uppercase.

import { expect, test } from '@playwright/test';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await expect(page.locator('.tt-editor').first()).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

async function enableScreenplay(page) {
  await page.locator('.doc-tb-screenplay-toggle').click();
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  // Editor rebuilds on mode change — wait for the re-handed live editor + the
  // seeded scene block.
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]').first()).toBeVisible({ timeout: 10000 });
}

test('toggling screenplay mode seeds a Scene Heading + Courier layout', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const font = await page.evaluate(() => {
    const pm = document.querySelector('.doc-paper.is-screenplay .ProseMirror');
    return getComputedStyle(pm).fontFamily.toLowerCase();
  });
  expect(font).toContain('courier');
  // Persisted mode in the data layer.
  const mode = await page.evaluate(() =>
    window.__soleilDocTest.getDocMode(window.__soleilDocTest.ydoc, window.__soleilDocTest.getScope()));
  expect(mode).toBe('screenplay');
});

test('Tab/Enter cycle elements and scene/character lines auto-uppercase', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);

  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();

  // Scene heading auto-uppercases.
  await page.keyboard.type('int. kitchen - day');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]').first()).toHaveText('INT. KITCHEN - DAY');

  // Enter → action (not uppercased).
  await page.keyboard.press('Enter');
  await page.keyboard.type('John enters.');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="action"]').first()).toHaveText('John enters.');

  // Tab cycles action → character; character auto-uppercases.
  await page.keyboard.press('Enter');           // new action line
  await page.keyboard.press('Tab');             // action → character
  await page.keyboard.type('mary');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="character"]').first()).toHaveText('MARY');

  // Enter → dialogue (not uppercased).
  await page.keyboard.press('Enter');
  await page.keyboard.type('Hello there.');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').first()).toHaveText('Hello there.');
});

test('a long screenplay shows on-screen page-break markers', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  // Load enough script to exceed one 54-line page.
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const ed = window.__soleilDocTest.editor;
    const blocks = [{ element: 'scene', text: 'INT. OFFICE - DAY' }];
    for (let i = 0; i < 90; i++) blocks.push({ element: 'action', text: 'The clock ticks forward another beat.' });
    ed.chain().focus().setContent(S.blocksToDocJSON(blocks)).run();
  });
  await expect(page.locator('.doc-card-modal .sp-page-break').first()).toBeVisible({ timeout: 5000 });
  // Page label reads "Page 2" on the first break.
  await expect(page.locator('.doc-card-modal .sp-page-break-rule[data-page="2"]').first()).toBeAttached();
});

test('screenplay export menu offers Fountain + Final Draft import/export', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.locator('.doc-card-modal .doc-export-wrap button').first().click();
  await expect(page.getByRole('button', { name: /Export Fountain/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Export Final Draft/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Import Fountain/ })).toBeVisible();
});
