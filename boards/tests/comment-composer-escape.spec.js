// comment-composer-escape.spec.js
//
// SHARE-9: Escape in the @ picker also closed the whole comment box, losing
// what was typed. One box writes every comment now
// (comments/CommentComposer.jsx), and its rule is: Escape closes the picker
// first and nothing else; the next Escape, with words in the box, asks before
// it throws them away.
//
// Driven in a doc's side panel (?docqa=1), where "@" offers whoever has
// written in the doc.

import { test, expect } from '@playwright/test';

test('Escape with the @ picker open closes the picker and leaves the box and its words alone', async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  const modal = page.locator('.doc-card-modal');
  await expect(modal).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  const id = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ed = T.editor;
    ed.commands.setContent('<p>Keep the motel sign lit</p>');
    const [first] = T.readPages(T.ydoc, T.getScope());
    const id = T.addCommentThread(T.ydoc, { pageId: first.id, body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya', authorColor: '#4f8df8', scope: T.getScope() });
    ed.chain().setTextSelection({ from: 16, to: 20 }).setMark('comment', { id }).setTextSelection(1).run();
    return id;
  });
  await modal.locator(`.tt-comment[data-comment-id="${id}"]`).click();
  const card = modal.locator(`.cmt-thread.is-open[data-thread="${id}"]`);
  const box = card.locator('textarea.cmt-input');
  await box.click();
  await box.pressSequentially('Ask @');
  const picker = page.getByRole('listbox', { name: 'People' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('option', { name: /Maya Chen/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect(box).toHaveValue('Ask @');
  await expect(box).toBeFocused();

  // The next Escape asks before the words go; Keep writing keeps them.
  await page.keyboard.press('Escape');
  await expect(card.getByRole('alertdialog')).toContainText('Discard this comment?');
  await card.getByRole('button', { name: 'Keep writing' }).click();
  await expect(box).toHaveValue('Ask @');

  // Picking someone puts them in as a mention, sent with the words.
  await box.pressSequentially('M');
  await picker.getByRole('option', { name: /Maya Chen/ }).click();
  await box.press('Enter');
  await expect(card.locator('.cmt-row').nth(1).locator('.cmt-mention, [data-mention]').first()).toContainText('Maya Chen');
});
