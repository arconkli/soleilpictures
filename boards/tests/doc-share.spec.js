// A doc shared on its own (0426): read or edited through its live room.
// Driven through the DEV harness (?fileshareqa=doc-*, src/local/
// FileShareQaHarness.jsx): the real FileSharePage and DocShareView over an
// in-memory room (fakeDocRoom) and the dialog over a fake of the RPCs.
// window.__fileShareQa.calls records every api call; docRooms holds each room.
//
//   PW_PORT=5291 npx playwright test tests/doc-share.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';

async function open(page, fixture) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?fileshareqa=${fixture}`);
  await page.waitForSelector('[data-fileshareqa-ready]', { state: 'attached' });
}
const calls = (page, fn) => page.evaluate((f) => window.__fileShareQa.calls.filter((c) => c.fn === f), fn);
// The live room: the newest (in development React starts each effect twice,
// so the first room of a pair is thrown away at once).
const lastRoom = (page, call) => page.evaluate((c) => {
  const rooms = window.__fileShareQa.docRooms;
  return rooms[rooms.length - 1][c.fn](c.arg);
}, call);
const rooms = async (page) => [...new Set((await calls(page, 'attachDocRoom')).map((c) => c.args[0]))];
const view = (page) => page.locator('.dsv');
const editor = (page) => page.locator('.dsv .ProseMirror').first();

test.describe('a doc shared on its own', () => {
  test('to read: the words, in the view room, with nothing to edit', async ({ page }) => {
    await open(page, 'doc-view');
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
    await expect(view(page)).toHaveAttribute('data-doc-share-mode', 'view');
    await expect(page.locator('.dsv-mode')).toHaveText('View only');
    await expect(page.locator('.dsv-name')).toHaveText('Pilot, revisions');
    await expect(editor(page)).toContainText('A quiet street before dawn.');
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.locator('.dsv .doc-tb')).toHaveCount(0);
    expect(await rooms(page)).toEqual(['5d0c5d0c-0000-4000-8000-00000000d0c0.view.0123456789ab']);
    // A reader has no save of their own to report.
    await expect(page.locator('.dsv .doc-foot-status')).toHaveCount(0);
  });

  test('to edit: the toolbar, the edit room, and nothing to bring in', async ({ page }) => {
    await open(page, 'doc-edit');
    await expect(view(page)).toHaveAttribute('data-doc-share-mode', 'edit');
    await expect(page.locator('.dsv-mode')).toHaveText('Editing');
    await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
    expect(await rooms(page)).toEqual(['5d0c5d0c-0000-4000-8000-00000000d0c0.edit.0123456789ab']);
    // Images and cluster embeds are not offered; the rest of the insert menu is.
    await page.getByRole('button', { name: 'Insert a block' }).click();
    const items = page.locator('.doc-insert-item-title');
    await expect(items.filter({ hasText: 'Table' })).toHaveCount(1);
    await expect(items.filter({ hasText: 'Image' })).toHaveCount(0);
    await expect(items.filter({ hasText: 'Embed cluster' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Shared without "Allow saving a copy": no Export.
    await expect(page.locator('.dsv button[aria-label="Export"]')).toHaveCount(0);
    // Typing lands in the doc.
    await editor(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Rain starts.');
    await expect(editor(page)).toContainText('Rain starts.');
  });

  // The harness room judges every write with the real room's rule
  // (validateGuestUpdate) on a copy written by another client.
  test('real editing passes the room’s own checks: typing, marks, a list, a paste, a comment', async ({ page }) => {
    await open(page, 'doc-edit');
    await expect(view(page)).toHaveAttribute('data-doc-share-mode', 'edit');
    const ed = editor(page);
    await ed.locator('p', { hasText: 'MARA checks' }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Rain starts. ');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('Thunder.');
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- first beat');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second beat');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    // A paste carrying an image and an app link keeps only its words.
    await ed.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<p>Pasted <img src="https://example.com/x.png"> words and a <a href="soleil://board/x">doc link</a></p>');
      dt.setData('text/plain', 'Pasted words and a doc link');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(ed).toContainText('Rain starts. Thunder.');
    await expect(ed.locator('strong', { hasText: 'Thunder.' })).toHaveCount(1);
    await expect(ed.locator('li', { hasText: 'second beat' })).toHaveCount(1);
    await expect(ed).toContainText('words and a doc link');
    await expect(ed.locator('img')).toHaveCount(0);
    await expect(ed.locator('a[href^="soleil:"]')).toHaveCount(0);
    // A comment, as this guest (the room checks who and what name).
    await ed.locator('p', { hasText: 'A quiet street' }).getByText('quiet', { exact: false }).first().dblclick();
    await page.locator('.dsv button[title^="Add comment"]').click();
    await page.getByPlaceholder('Comment, then ⏎ to post').fill('Too quiet?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__fileShareQa.refusals || [])).toEqual([]);
    await expect(page.locator('.dsv-notice')).toHaveCount(0);
  });

  test('signed out on a link that edits: reading, with Sign in to edit', async ({ page }) => {
    await open(page, 'doc-signed-out');
    await expect(view(page)).toHaveAttribute('data-doc-share-mode', 'view');
    const signIn = page.getByRole('link', { name: 'Sign in to edit' });
    await expect(signIn).toBeVisible();
    expect(await signIn.getAttribute('href')).toContain('back=file&file_token=');
  });

  test('a refused write starts this copy over, and says so', async ({ page }) => {
    await open(page, 'doc-edit');
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
    const attached = (await calls(page, 'attachDocRoom')).length;
    await lastRoom(page, { fn: 'refuse', arg: 'comment_author' });
    await expect(page.locator('.dsv-notice')).toHaveText("That change couldn't be saved here, so the doc was reloaded.");
    await expect.poll(async () => (await calls(page, 'attachDocRoom')).length).toBeGreaterThan(attached);
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
    await expect(editor(page)).toContainText('A quiet street before dawn.');
  });

  test('a room that closed (moved, gone, access ended) asks the share again', async ({ page }) => {
    await open(page, 'doc-edit');
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
    const before = (await calls(page, 'fetchFileShare')).length;
    const attached = (await calls(page, 'attachDocRoom')).length;
    await lastRoom(page, { fn: 'end', arg: 4012 });
    await expect.poll(async () => (await calls(page, 'fetchFileShare')).length).toBeGreaterThan(before);
    // The share still names the same room: it starts again.
    await expect.poll(async () => (await calls(page, 'attachDocRoom')).length).toBeGreaterThan(attached);
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
  });
});

test.describe('the owner shares a doc as view | edit', () => {
  test('the dialog speaks a doc’s roles, and the rooms ask again after a change', async ({ page }) => {
    await open(page, 'doc-manage');
    await page.getByRole('button', { name: 'Manage sharing' }).click();
    const dialog = page.locator('.fsd-modal');
    await expect(dialog).toBeVisible();
    const sam = dialog.getByLabel('Access for Sam Rivera');
    await expect(sam).toHaveValue('edit');
    await expect(sam.locator('option')).toHaveText(['Can view', 'Can edit', 'Remove']);
    await expect(dialog.getByLabel('What anyone with the link can do')).toHaveValue('edit');
    await expect(dialog.getByText('Anyone with the link can read it. Signed in, they can edit it too.')).toBeVisible();
    await expect(dialog.getByText('Allow saving a copy')).toBeVisible();
    await expect(dialog.getByText('Can comment')).toHaveCount(0);
    await sam.selectOption('view');
    await expect.poll(async () => (await calls(page, 'setFileSharePerson')).map((c) => c.args[3])).toEqual(['view']);
    await expect.poll(async () => (await calls(page, 'recheckDocRooms')).length).toBe(1);
  });

  test('people invited to a doc can edit unless you say otherwise', async ({ page }) => {
    await open(page, 'doc-dialog');
    const dialog = page.locator('.fsd-modal');
    await expect(dialog.getByLabel('Access for the people you add')).toHaveValue('edit');
    await dialog.getByLabel('Add people by email').fill('jun@example.com');
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect.poll(async () => (await calls(page, 'addFileSharePeople')).map((c) => c.args[3])).toEqual(['edit']);
  });
});
