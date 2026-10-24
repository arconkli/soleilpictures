// Typing in a note redrew its formatting bar twice a keystroke: font picker,
// size box, both colour buttons, the comment button, every control. Nothing
// on the bar changes while you type plain text, so the bar draws only when
// what it shows does: the caret moves into bold, a selection starts, the
// note's own size changes.
import { expect, test } from '@playwright/test';
import { countRenders, resetRenders, renders } from './helpers/renderCounter.js';
import { formatButton, noteBar } from './helpers/noteBar.js';

// Today's bar's parts, and the toolbar look's (NoteBarA and what it draws with).
const BAR = ['NoteRichTextBar', 'NoteCommentBtn', 'FontPicker', 'SizeInput', 'ColorBtn',
  'NoteBarA', 'CommentBtn', 'MenuButton', 'Btn'];
const none = Object.fromEntries(BAR.map((k) => [k, 0]));
const barRenders = async (page) => {
  const n = await renders(page);
  return Object.fromEntries(BAR.map((k) => [k, n[k] || 0]));
};

async function typeAndCount(page) {
  await page.keyboard.type('hello');
  await expect(noteBar(page)).toBeVisible();
  await page.waitForTimeout(300);
  await resetRenders(page);
  await page.keyboard.type(' a quick brown fox!!', { delay: 25 });
  await page.waitForTimeout(300);
  return barRenders(page);
}

test('typing in a note leaves its formatting bar alone', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await countRenders(page);
  await page.goto('/?noteqa=1&toolbar=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  const edit = page.locator('[data-client="A"] .note-body[contenteditable="true"]');
  await page.locator('[data-client="A"] .note').dblclick();
  await edit.waitFor();
  await edit.click();
  expect(await typeAndCount(page)).toEqual(none);

  // It still follows the caret: a selection lets you comment on it, bold
  // lights Bold, and the bar's comment button opens the composer.
  const comment = page.getByRole('button', { name: 'Add comment' });
  const bold = formatButton(page, 'Bold');
  await expect(comment).toBeDisabled();
  await page.keyboard.press('Shift+Home');
  await expect(comment).toBeEnabled();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('ControlOrMeta+b');
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await comment.click();
  await expect(page.locator('.inline-composer')).toBeVisible();
});

// The canvas hands the bar new palette lists, styles and callbacks on every
// card change, and a keystroke in a note is one.
test('typing in a note on the canvas leaves its formatting bar alone', async ({ page }) => {
  await countRenders(page);
  await page.goto('/?local=1&reset=1');
  const note = page.locator('.canvas-wrap .card[data-card-id="home-note"]');
  await note.waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await note.dblclick();
  await expect(page.locator('.note-body[contenteditable="true"]')).toBeFocused();
  await page.keyboard.press('End');
  expect(await typeAndCount(page)).toEqual(none);
});
