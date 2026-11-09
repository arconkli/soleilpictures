// Korean typing in a text field outside the canvas. The Enter that picks a
// syllable belongs to the IME: a field that acts on it posts with the word cut
// short. The field here leaves a syllable still being composed alone, and acts
// on the next Enter (tests/canvas-ime.spec.js does the same on the canvas;
// src/lib/imeGuard.test.mjs checks every key handler in the app is guarded).
//
// Not here, and why: neither surface is reachable in the local QA shell
// (/?local=1). Its notes have no comment flow, so the comment composer
// (InlineComposer.jsx) is driven through the existing ?noteqa harness, as
// tests/note-comment-composer.spec.js does; and the shell has its own sidebar
// with no rename, so renaming a cluster in the sidebar (SidebarBoardTree.jsx)
// has no spec. Both are pinned by src/lib/imeGuard.test.mjs.
import { expect, test } from '@playwright/test';
import { korean } from './imeHelpers.js';

test.skip(({ browserName }) => browserName !== 'chromium', 'CDP drives Chromium\'s IME');

const A = '[data-client="A"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';

test('a comment on a note\'s text: Enter mid-syllable posts nothing; the next Enter posts it whole', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('Rewrite the ending');
  await page.keyboard.press('Shift+Home'); // select what was typed
  await expect.poll(() => page.evaluate(
    () => window.__soleilNoteTest.getActiveEditor()?.state.selection.empty === false,
  )).toBe(true);
  await page.keyboard.press('ControlOrMeta+Alt+m');
  const composer = page.locator('.inline-composer');
  await expect(composer).toBeVisible();
  const input = composer.locator('.inline-composer-input');
  await expect(input).toBeFocused();
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('컷이 늦다');
  await expect(input).toHaveValue('컷이 늦다');
  await page.waitForTimeout(400);
  await expect(composer).toBeVisible();
  expect(await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA())).not.toMatch(/data-comment-id=/);
  await page.keyboard.press('Enter');
  await expect(composer).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getFragHtmlA()))
    .toMatch(/data-comment-id="[^"]+"/);
});
