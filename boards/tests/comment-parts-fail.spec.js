// comment-parts-fail.spec.js
//
// A doc and a note when the comment parts (components/comments/commentParts.js,
// the chunk every comment surface shares) cannot be fetched. Nothing of the
// doc or the note depends on them: a press that needed them says the comments
// could not load, shows nothing half-made, and the words go on being written.
// The canvas's half of this is in tests/canvas-comment-pins.spec.js.
//
// The network is one the browser calls online and that answers nothing (the
// probe in lib/commentChunkReload.js fails too), so no press reloads the
// page; the harnesses keep their doc and their note in memory.

import { expect, test } from '@playwright/test';

const PARTS = /\/components\/comments\/commentParts\.js/;
const SAID = "Comments couldn't load. Check your connection.";
const said = (page) => page.locator('.toast-msg').filter({ hasText: SAID });
const crashed = (page) => page.getByText("Couldn't load this page");

async function deadParts(page) {
  await page.route(PARTS, (route) => route.abort());
  await page.route(/\/robots\.txt/, (route) => route.abort());
}

test.describe('a doc', () => {
  const modal = (page) => page.locator('.doc-card-modal');
  const editor = (page) => modal(page).locator('.tt-editor').first();

  async function openDoc(page) {
    await page.goto('/?docqa=1');
    await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
    await page.evaluate(() => window.__soleilDocTest.openCard());
    await expect(modal(page)).toBeVisible();
    await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
    await page.evaluate(() => { window.__same = true; });
  }
  const same = (page) => page.evaluate(() => window.__same === true);

  test('the Comments panel says the comments could not load; the doc is still written in', async ({ page }) => {
    await deadParts(page);
    await openDoc(page);
    // a comment on the doc's words, there before the panel is asked for
    const id = await page.evaluate(() => {
      const T = window.__soleilDocTest;
      T.editor.commands.setContent('<p>We open on the blue hour alley.</p>');
      const [first] = T.readPages(T.ydoc, T.getScope());
      const id = T.addCommentThread(T.ydoc, { pageId: first.id, body: 'Earlier than this?', author: 'QA Tester', authorId: 'docqa-user', authorColor: '#4f8df8', scope: T.getScope() });
      T.editor.chain().setTextSelection({ from: 16, to: 25 }).setMark('comment', { id }).setTextSelection(1).run();
      return id;
    });
    await expect(modal(page).locator(`.tt-comment[data-comment-id="${id}"]`)).toHaveText('blue hour');

    await modal(page).locator('.dl-head').getByRole('button', { name: /^Comments/ }).click();
    await expect(said(page)).toBeVisible();
    await expect(modal(page).locator('.cmt-thread, .cmt-list-row')).toHaveCount(0);
    await expect(crashed(page)).toHaveCount(0);
    expect(await same(page)).toBe(true);

    // the doc under it: its words, the comment's mark, and typing
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator(`.tt-comment[data-comment-id="${id}"]`)).toHaveText('blue hour');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Rain starts.');
    await expect(editor(page)).toContainText('alley. Rain starts.');
    // pressing the commented words asks for the parts again and breaks nothing
    await modal(page).locator(`.tt-comment[data-comment-id="${id}"]`).click();
    await page.waitForTimeout(500);
    await expect(crashed(page)).toHaveCount(0);
    await expect(editor(page)).toContainText('alley. Rain starts.');
    expect(await same(page)).toBe(true);
  });

  test('Comment on selected words says so, leaves no tint and no half-made card, and the words stay', async ({ page }) => {
    await deadParts(page);
    await openDoc(page);
    await page.evaluate(() => {
      const ed = window.__soleilDocTest.editor;
      ed.commands.setContent('<p>We open on the blue hour alley.</p>');
      ed.chain().focus().setTextSelection({ from: 16, to: 25 }).run();
    });
    await expect(editor(page)).toBeFocused();
    await modal(page).getByRole('toolbar', { name: 'Formatting', exact: true }).first().getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(said(page)).toBeVisible();
    await expect(page.locator('.cmt-float-host .cmt-card')).toHaveCount(0);
    await expect(modal(page).locator('.cmt-pending')).toHaveCount(0);
    await expect(modal(page).locator('.tt-comment')).toHaveCount(0);
    await expect(crashed(page)).toHaveCount(0);
    expect(await same(page)).toBe(true);
    // the editor is the same editor: it still takes words, and the press again
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Rain starts.');
    await expect(editor(page)).toContainText('alley. Rain starts.');
    await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().setTextSelection({ from: 16, to: 25 }).run());
    await modal(page).getByRole('toolbar', { name: 'Formatting', exact: true }).first().getByRole('button', { name: 'Comment', exact: true }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.cmt-float-host .cmt-card')).toHaveCount(0);
    await expect(modal(page).locator('.cmt-pending')).toHaveCount(0);
    await expect(crashed(page)).toHaveCount(0);
    expect(await same(page)).toBe(true);
  });
});

test.describe('a note', () => {
  const A = '[data-client="A"] .note';
  const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';

  test('⌘⌥M on selected words says so, leaves no tint and no card, and the note is still written in', async ({ page }) => {
    await deadParts(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/?noteqa=1');
    await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
    await page.evaluate(() => { window.__same = true; });
    await page.locator(A).dblclick();
    await page.locator(A_EDIT).waitFor();
    await page.locator(A_EDIT).click();
    await page.keyboard.type('Rewrite the ending');
    await expect(async () => {
      await page.keyboard.press('Shift+Home');
      await expect.poll(() => page.evaluate(
        () => window.__soleilNoteTest.getActiveEditor()?.state.selection.empty === false,
      ), { timeout: 2000 }).toBe(true);
    }).toPass({ timeout: 15000 });
    await page.keyboard.press('ControlOrMeta+Alt+m');
    await expect(said(page)).toBeVisible();
    await expect(page.locator('.cmt-float-host .cmt-card')).toHaveCount(0);
    await expect(page.locator('[data-client="A"] .cmt-pending')).toHaveCount(0);
    await expect(page.locator('[data-client="A"] .tt-comment')).toHaveCount(0);
    await expect(crashed(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__same === true)).toBe(true);

    // still the note being written: the words are there and take more
    await expect(page.locator(A_EDIT)).toHaveText('Rewrite the ending');
    await page.locator(A_EDIT).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(', gently');
    await expect(page.locator(A_EDIT)).toHaveText('Rewrite the ending, gently');
    // and it reaches the other person's copy
    await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getTextB())).toContain('Rewrite the ending, gently');
    // (React's development build raises an error a boundary caught on the
    // window as well, so the chunk's own failure is heard here on the dev
    // server; anything else is a break)
    expect(errors.filter((e) => !/Failed to fetch dynamically imported module/.test(e))).toEqual([]);
  });
});
