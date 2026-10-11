import { expect, test } from '@playwright/test';

// NOTES-03: adding a comment on note text closed itself. The composer focuses
// its textarea on mount, the note editor read that blur as "left the note",
// exited edit mode, and unmounted the composer with it. Drives the real
// NoteCardCollab through the ?noteqa harness.

const A = '[data-client="A"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';

// ProseMirror picks a keyboard selection up from selectionchange, a tick after
// the keypress; the shortcut no-ops on an empty selection.
const selectionReady = (page) => expect.poll(() => page.evaluate(
  () => window.__soleilNoteTest.getActiveEditor()?.state.selection.empty === false,
)).toBe(true);

test('a note comment can be written and posted', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });

  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('Rewrite the ending');
  await page.keyboard.press('Shift+Home'); // select what was typed
  await selectionReady(page);

  await page.keyboard.press('ControlOrMeta+Alt+m');
  const composer = page.locator('.inline-composer');
  await expect(composer).toBeVisible();
  // Still visible a beat later: it used to flash and vanish.
  await page.waitForTimeout(300);
  await expect(composer).toBeVisible();
  await expect(page.locator(A_EDIT)).toBeVisible();

  await page.keyboard.type('Too abrupt?');
  await page.keyboard.press('Enter');
  await expect(composer).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getFragHtmlA()))
    .toMatch(/data-comment-id="[^"]+"/);
  // Posting hands the caret back to the note; a click elsewhere then ends editing.
  await expect(page.locator(A_EDIT)).toBeFocused();
  await page.mouse.click(5, 5);
  await expect(page.locator(A_EDIT)).toHaveCount(0);
});

test('Escape out of the composer keeps the note in edit mode', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });

  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('Keep going');
  await page.keyboard.press('Shift+Home');
  await selectionReady(page);
  await page.keyboard.press('ControlOrMeta+Alt+m');
  await expect(page.locator('.inline-composer')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.inline-composer')).toHaveCount(0);
  await expect(page.locator(A_EDIT)).toBeFocused();
});
