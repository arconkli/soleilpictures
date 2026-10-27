// A doc shared on its own (0426): read or edited through its live room, in
// the doc look as in its cluster (2026-10-27). Driven through the DEV harness
// (?fileshareqa=doc-*, src/local/FileShareQaHarness.jsx): the real
// FileSharePage and DocShareView over an in-memory room (fakeDocRoom) and the
// dialog over a fake of the RPCs. window.__fileShareQa.calls records every api
// call; docRooms holds each room.
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
const head = (page) => page.locator('.dsv .dl-head');
const bar = (page) => page.locator('.dsv .dl-bar');
const panel = (page) => page.getByRole('complementary', { name: 'Comments and find' });
const refusals = (page) => page.evaluate(() => window.__fileShareQa.refusals || []);
// What a guest's header never has: the page around it closes it, and the
// cluster's messages, dock and title aren't theirs.
const NOT_A_GUESTS = /^(Close document|Open fullscreen|Dock beside the canvas|Messages)/;

test.describe('a doc shared on its own', () => {
  test('to read: the words, in the view room, with nothing to edit', async ({ page }) => {
    await open(page, 'doc-view');
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
    await expect(view(page)).toHaveAttribute('data-doc-share-mode', 'view');
    // The look's header: the doc's name, which only reads, and View only.
    await expect(head(page).locator('.dl-title')).toHaveValue('Pilot, revisions');
    await expect(head(page).locator('.dl-title')).toHaveAttribute('readonly', '');
    await expect(head(page).locator('.dl-chip')).toHaveText('View only');
    await expect(editor(page)).toContainText('A quiet street before dawn.');
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
    // No toolbar and no comments (the view room holds none), nor what a
    // cluster's doc has around it.
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator('.dsv .doc-tb')).toHaveCount(0);
    await expect(head(page).getByRole('button', { name: /^Comments/ })).toHaveCount(0);
    await expect(head(page).getByRole('button', { name: NOT_A_GUESTS })).toHaveCount(0);
    expect(await rooms(page)).toEqual(['5d0c5d0c-0000-4000-8000-00000000d0c0.view.0123456789ab']);
    // The look's footer, with no save of a reader's own to report.
    await expect(page.locator('.dsv .dl-foot')).toContainText('25 words');
    await expect(page.locator('.dsv .dl-foot-status')).toHaveCount(0);
  });

  test('to edit: the look’s toolbar, the edit room, and nothing to bring in', async ({ page }) => {
    await open(page, 'doc-edit');
    await expect(view(page)).toHaveAttribute('data-doc-share-mode', 'edit');
    await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
    expect(await rooms(page)).toEqual(['5d0c5d0c-0000-4000-8000-00000000d0c0.edit.0123456789ab']);
    await expect(bar(page)).toBeVisible();
    // The title is its cluster's to change (the room refuses it).
    await expect(head(page).locator('.dl-title')).toHaveAttribute('readonly', '');
    await expect(head(page).locator('.dl-chip')).toHaveCount(0);
    await expect(head(page).getByRole('button', { name: 'Comments', exact: true })).toBeVisible();
    await expect(head(page).getByRole('button', { name: NOT_A_GUESTS })).toHaveCount(0);
    // Images and cluster embeds are not offered; the rest of the insert menu is.
    await bar(page).getByRole('button', { name: 'Insert', exact: true }).click();
    const items = page.getByRole('menu', { name: 'Insert' }).locator('.tl-mt');
    await expect(items.filter({ hasText: 'Table' })).toHaveCount(1);
    await expect(items.filter({ hasText: 'Image' })).toHaveCount(0);
    await expect(items.filter({ hasText: 'Embed cluster' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Shared without "Allow exporting": no Export, in the bar or under its ⋯.
    await bar(page).getByRole('button', { name: 'More', exact: true }).click();
    const more = page.getByRole('menu', { name: 'More' });
    await expect(more.locator('.dl-minfo')).toContainText('words');
    await expect(more.locator('.tl-mh', { hasText: 'Export' })).toHaveCount(0);
    await expect(more.getByRole('menuitem', { name: 'HTML' })).toHaveCount(0);
    await page.keyboard.press('Escape');
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
    await bar(page).getByRole('button', { name: 'Comment', exact: true }).click();
    await page.getByPlaceholder('Comment, then ⏎ to post').fill('Too quiet?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect(await refusals(page)).toEqual([]);
    await expect(page.locator('.dsv-notice')).toHaveCount(0);
  });

  // The side panel's Comments, as a guest: a reply and a resolve in their own
  // name, which the room checks; Delete only on a thread they started.
  test('a guest replies to a member’s comment and resolves it in the side panel, and deletes only their own', async ({ page }) => {
    await open(page, 'doc-edit');
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
    await lastRoom(page, { fn: 'thread', arg: { body: 'Is it dawn already?' } });
    await expect(head(page).getByRole('button', { name: 'Comments, 1 open', exact: true })).toBeVisible();
    await head(page).getByRole('button', { name: 'Comments, 1 open', exact: true }).click();
    await expect(panel(page)).toBeVisible();
    const card = panel(page).locator('.dl-th').first();
    await expect(card).toContainText('“before dawn”');
    await expect(card).toContainText('Rae Okafor');
    // Someone else's thread: no Delete.
    await expect(card.getByRole('button', { name: 'Delete thread' })).toHaveCount(0);
    await card.getByRole('textbox', { name: /^Reply to/ }).fill('Not yet. Ten minutes.');
    await page.keyboard.press('Enter');
    await expect(card).toContainText('Not yet. Ten minutes.');
    await expect(card.locator('.dl-cm').last()).toContainText('You');
    await card.getByRole('button', { name: 'Resolve' }).click();
    await expect(card).toContainText('Resolved by you');
    await card.getByRole('button', { name: 'Reopen' }).click();
    await expect(card.getByRole('button', { name: 'Resolve' })).toBeVisible();
    // A thread of their own has its Delete.
    await editor(page).locator('p', { hasText: 'MARA checks' }).getByText('mirror', { exact: false }).first().dblclick();
    await bar(page).getByRole('button', { name: 'Comment', exact: true }).click();
    await page.getByPlaceholder('Comment, then ⏎ to post').fill('Which mirror?');
    await page.keyboard.press('Enter');
    const mine = panel(page).locator('.dl-th', { hasText: 'Which mirror?' });
    await expect(mine).toBeVisible();
    await expect(mine.getByRole('button', { name: 'Delete thread' })).toBeVisible();
    await page.waitForTimeout(400);
    expect(await refusals(page)).toEqual([]);
    await expect(page.locator('.dsv-notice')).toHaveCount(0);
  });

  test('a guest’s Find replaces words, as typing would', async ({ page }) => {
    await open(page, 'doc-edit');
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+f');
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole('textbox', { name: 'Find' }).fill('watch');
    await panel(page).getByRole('textbox', { name: 'Replace with' }).fill('phone');
    await panel(page).getByRole('button', { name: /^Replace all/ }).click();
    await expect(editor(page)).toContainText('MARA checks her phone, then the mirror, then her phone again.');
    await page.waitForTimeout(400);
    expect(await refusals(page)).toEqual([]);
  });

  test('signed out on a link that edits: reading, with Sign in to edit', async ({ page }) => {
    await open(page, 'doc-signed-out');
    await expect(view(page)).toHaveAttribute('data-doc-share-mode', 'view');
    const signIn = page.getByRole('link', { name: 'Sign in to edit' });
    await expect(signIn).toBeVisible();
    expect(await signIn.getAttribute('href')).toContain('back=file&file_token=');
  });

  test('a refused write starts this copy over, and says so until put away', async ({ page }) => {
    await open(page, 'doc-edit');
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
    const attached = (await calls(page, 'attachDocRoom')).length;
    await lastRoom(page, { fn: 'refuse', arg: 'comment_author' });
    const notice = page.locator('.dsv-notice');
    await expect(notice).toHaveText("That change couldn't be saved here, so the doc was reloaded.");
    await expect(notice).toHaveAttribute('role', 'status');
    await expect.poll(async () => (await calls(page, 'attachDocRoom')).length).toBeGreaterThan(attached);
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
    await expect(editor(page)).toContainText('A quiet street before dawn.');
    // Under the header, across the window.
    const [n, h] = await Promise.all([notice.boundingBox(), head(page).boundingBox()]);
    expect(Math.abs(n.y - (h.y + h.height))).toBeLessThan(2);
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);
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

  // C3: an undo of the doc's delete, a restore of the doc alone or an API
  // rewrite puts a new card in its place, under new ids. The reader must not
  // stay on the old one, showing (and writing into) what the cluster dropped.
  for (const fixture of ['doc-view', 'doc-edit']) {
    test(`a doc put back in its place starts the reader over on it (${fixture})`, async ({ page }) => {
      await open(page, fixture);
      await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
      await expect(editor(page)).toContainText('A quiet street before dawn.');
      const attached = (await calls(page, 'attachDocRoom')).length;
      await lastRoom(page, { fn: 'restore', arg: ['The restored opening, as it was on Monday.'] });
      await expect.poll(async () => (await calls(page, 'attachDocRoom')).length).toBeGreaterThan(attached);
      await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
      await expect(editor(page)).toContainText('The restored opening, as it was on Monday.');
      await expect(editor(page)).not.toContainText('A quiet street before dawn.');
      // It started over in place, with no notice. Whatever the old copy's
      // editor wrote into the types the cluster dropped was refused (the
      // real room's rule); the fresh copy writes into the doc as it now is.
      await expect(page.locator('.dsv-notice')).toHaveCount(0);
      if (fixture === 'doc-edit') {
        await page.evaluate(() => { window.__fileShareQa.refusals = []; });
        await editor(page).locator('p').filter({ hasText: 'The restored opening' }).click();
        await page.keyboard.press('End');
        await page.keyboard.type(' Kept.');
        await expect(editor(page)).toContainText('as it was on Monday. Kept.');
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => window.__fileShareQa.refusals || [])).toEqual([]);
      }
    });
  }
});

// Inside the app (the Shared page, the bell) the doc opens over it, in the
// same look: Close is the dialog's, and Escape is the doc's first, as in its
// cluster: while typing it's the text's, a layer in the doc takes its own,
// and only one nothing in the doc took closes the dialog.
test.describe('a shared doc opened in the app', () => {
  const dialog = (page) => page.getByRole('dialog', { name: 'Shared doc' });
  async function openOverlay(page) {
    await open(page, 'doc-overlay');
    await page.locator('[data-qa-open-shared]').click();
    await expect(dialog(page)).toBeVisible();
    await expect(view(page)).toHaveAttribute('data-doc-share-phase', 'ready');
  }

  test('the doc look over the app, with the dialog’s Close and none of its own', async ({ page }) => {
    await openOverlay(page);
    await expect(bar(page)).toBeVisible();
    await expect(head(page).locator('.dl-title')).toHaveValue('Pilot, revisions');
    await expect(head(page).getByRole('button', { name: NOT_A_GUESTS })).toHaveCount(0);
    await expect(dialog(page).getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  });

  test('Escape while typing, or in the side panel, stays in the doc; one with nothing to close closes it', async ({ page }) => {
    await openOverlay(page);
    await editor(page).locator('p', { hasText: 'MARA checks' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Still.');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
    await expect(editor(page)).toContainText('Still.');
    // The side panel's Escape goes back to the text, and leaves it open.
    await head(page).getByRole('button', { name: 'Comments', exact: true }).click();
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole('tab', { name: /^Find/ }).click();
    await panel(page).getByRole('textbox', { name: 'Find' }).fill('dawn');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
    await expect(panel(page)).toBeVisible();
    // A menu's Escape is the menu's.
    await bar(page).getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'More' })).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
    // Nothing in the doc to take it (no caret in the text, nothing open): the
    // dialog closes.
    await page.evaluate(() => { document.activeElement?.blur(); window.getSelection()?.removeAllRanges(); });
    await head(page).getByRole('button', { name: 'Hide pages' }).focus();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await refusals(page)).toEqual([]);
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
    // Its switch says what it does: Export, for the people who can edit it
    // (viewers have no toolbar). "Saving a copy" promised files' Save a copy.
    await expect(dialog.getByText('Allow exporting')).toBeVisible();
    await expect(dialog.getByText('People who can edit it can export a copy.')).toBeVisible();
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
