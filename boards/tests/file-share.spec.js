// /f/<token>: one shared file on its own. Driven through the DEV harness
// (?fileshareqa=<fixture>, src/local/FileShareQaHarness.jsx): the real
// <FileSharePage> over a fake of 0421's RPCs and the party's /file-share
// answer. window.__fileShareQa.calls records every api call.
//
//   PW_PORT=5291 npx playwright test tests/file-share.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';

const TOKEN = '0f9a5c3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b';

async function open(page, fixture) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?fileshareqa=${fixture}`);
  await page.waitForSelector('[data-fileshareqa-ready]', { state: 'attached' });
}
const calls = (page, fn) => page.evaluate((f) => window.__fileShareQa.calls.filter((c) => c.fn === f), fn);
const rail = (page) => page.locator('.fsp-rail');
// A conversation's short row in the rail, and the open one (the shared comment
// parts: components/comments/FileThreads.jsx over CommentCard).
const row = (page, id) => page.locator(`.fsr-row[data-thread="${id}"]`);
const card = (page, id) => page.locator(`.cmt-thread.is-open[data-thread="${id}"]`);
const fold = (page, name) => rail(page).locator(`[data-fold="${name}"]`);
const TH = {
  early: 'aaaa0001-0000-4000-8000-000000000001',
  earlyReply: 'aaaa0002-0000-4000-8000-000000000002',
  mine: 'aaaa0003-0000-4000-8000-000000000003',
  gone: 'aaaa0004-0000-4000-8000-000000000004',
  done: 'aaaa0006-0000-4000-8000-000000000006',
  old: 'aaaa0008-0000-4000-8000-000000000008',
};
const toast = (page, words) => page.locator('.toast-msg', { hasText: words });
const videoTime = (page) => page.locator('.fsp-stage video').evaluate((v) => v.currentTime);
const videoReady = (page) => page.waitForFunction(() => (document.querySelector('.fsp-stage video')?.readyState || 0) >= 1);

test.describe('a shared file', () => {
  test('each state says what it is', async ({ page }) => {
    await open(page, 'gone');
    await expect(page.getByRole('heading', { name: "This file isn't available anymore." })).toBeVisible();
    await expect(page.getByText('It may have been deleted, or the person who shared it stopped sharing.')).toBeVisible();

    await open(page, 'sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in to open this file' })).toBeVisible();
    const href = await page.locator('.fsp-state a', { hasText: 'Sign in' }).getAttribute('href');
    expect(href).toContain(`back=file&file_token=${TOKEN}`);
    expect(href).toContain('utm_source=file_share');

    await open(page, 'no-access');
    await expect(page.getByRole('heading', { name: 'You need access' })).toBeVisible();
    await expect(page.getByText('Ask the person who shared it to add sam@example.com.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Use another account' })).toBeVisible();

    await open(page, 'error');
    await expect(page.getByRole('heading', { name: "Couldn't load this file." })).toBeVisible();
    const before = (await calls(page, 'fetchFileShare')).length;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(async () => (await calls(page, 'fetchFileShare')).length).toBeGreaterThan(before);
  });

  test('use another account signs out first', async ({ page }) => {
    await open(page, 'no-access');
    await page.route((u) => u.searchParams.get('back') === 'file', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>signin</p>' }));
    const nav = page.waitForURL(/back=file&file_token=/);
    await page.getByRole('link', { name: 'Use another account' }).click();
    await nav;
    expect(await page.evaluate(() => sessionStorage.getItem('fileshareqa.signedOut'))).toBe('1');
  });

  test('a video shows its comments as markers, and a row seeks the player', async ({ page }) => {
    await open(page, 'video-comment');
    await expect(page.locator('.fsp-stage .film video')).toHaveCount(1);
    await expect(page.locator('.fsp-name')).toHaveText('Opening titles v3');
    // Open ones in the file's order (500 then 1500); the resolved one and the
    // one from an earlier version wait in their own sections, and neither has
    // a marker. The header counts conversations, not replies.
    await expect(rail(page).locator('.fsr-row')).toHaveCount(2);
    await expect(rail(page).locator('.fsr-row').first()).toHaveAttribute('data-thread', 'c-early');
    await expect(rail(page).locator('.fsc-total')).toHaveText('2 open · 1 resolved');
    await expect(page.locator('.ft-marker:not(.is-ghost)')).toHaveCount(2);
    await expect(fold(page, 'resolved')).toContainText('Resolved');
    await expect(fold(page, 'earlier')).toContainText('On an earlier version');
    await expect(fold(page, 'earlier').locator('.cmt-list-tab-n')).toHaveText('1');

    // The player needs the clip loaded before a seek can land.
    await videoReady(page);
    await row(page, 'c-late').click();
    await expect.poll(() => videoTime(page)).toBeGreaterThan(1.4);
    // The active one is the open card, and the only gold: its chip and its marker.
    await expect(card(page, 'c-late')).toBeVisible();
    await expect(rail(page).locator('.fsr-chip.is-active')).toHaveCount(1);
    await expect(page.locator('.ft-marker.is-active')).toHaveCount(1);

    await row(page, 'c-early').click();
    await expect.poll(() => videoTime(page)).toBeLessThan(0.7);
    await expect(card(page, 'c-early')).toBeVisible();
    await expect(card(page, 'c-late')).toHaveCount(0);
    // its chip goes there again
    await page.locator('.fsp-stage video').evaluate((v) => { v.currentTime = 0; });
    await card(page, 'c-early').getByRole('button', { name: 'Go to 0:00' }).click();
    await expect.poll(() => videoTime(page)).toBeGreaterThan(0.4);

    // Escape puts the active one away, and with it the gold.
    await page.keyboard.press('Escape');
    await expect(rail(page).locator('.cmt-thread.is-open')).toHaveCount(0);
    await expect(page.locator('.ft-marker.is-active')).toHaveCount(0);

    // A marker makes its comment the active one.
    await page.locator('.ft-marker[aria-label="0:01"]').click();
    await expect(card(page, 'c-late')).toBeVisible();
    // …and a seek elsewhere puts it away.
    const track = await page.locator('.ft-track').boundingBox();
    await page.mouse.click(track.x + track.width * 0.05, track.y + 8);
    await expect(rail(page).locator('.cmt-thread.is-open')).toHaveCount(0);
  });

  test('a comment on an earlier version waits in its own section and never seeks', async ({ page }) => {
    await open(page, 'video-comment');
    await videoReady(page);
    await expect(row(page, 'c-old')).toHaveCount(0);
    await fold(page, 'earlier').click();
    const chip = row(page, 'c-old').locator('.fsr-chip');
    await expect(chip).toHaveClass(/is-old/);
    await expect(chip).toHaveAttribute('title', 'Time on an earlier version');
    const before = await videoTime(page);
    await row(page, 'c-old').click();
    await expect(card(page, 'c-old')).toBeVisible();
    await expect(card(page, 'c-old').getByRole('button', { name: /^Go to/ })).toHaveCount(0);
    expect(await videoTime(page)).toBe(before);
    await expect(page.locator('.ft-marker.is-active')).toHaveCount(0);
  });

  test('the box pins the playhead, and add / reply / resolve / delete + undo reach the api', async ({ page }) => {
    await open(page, 'video-comment');
    await videoReady(page);
    await row(page, 'c-late').click();
    await expect.poll(() => videoTime(page)).toBeGreaterThan(1.4);

    const box = rail(page).locator('.fsr-new');
    const input = box.getByRole('textbox', { name: 'Add a comment…' });
    await input.click();
    const pin = box.locator('.fsr-moment');
    await expect(pin).toContainText('0:01');
    await expect(pin).toContainText('Comment at this moment');
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await input.fill('Cut here');
    await input.press('Enter');                       // Enter sends
    await expect.poll(async () => (await calls(page, 'addFileComment')).length).toBe(1);
    const [add] = await calls(page, 'addFileComment');
    expect(add.args[0]).toBe(TOKEN);
    expect(add.args[1]).toMatchObject({ body: 'Cut here', replyTo: null, page: null });
    expect(add.args[1].atMs).toBeGreaterThanOrEqual(1400);
    expect(add.args[1].atMs).toBeLessThan(1700);
    await expect(input).toHaveValue('');
    await expect(rail(page).getByText('Cut here')).toBeVisible();

    // Off the moment, it carries no time. Shift+Enter is a new line.
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    await expect(pin).toHaveText('Comment on the whole file');
    await input.fill('General note');
    await input.press('Shift+Enter');
    expect((await calls(page, 'addFileComment')).length).toBe(1);
    await input.fill('General note');
    await box.getByRole('button', { name: 'Send' }).click();
    await expect.poll(async () => (await calls(page, 'addFileComment')).length).toBe(2);
    expect((await calls(page, 'addFileComment'))[1].args[1]).toMatchObject({ body: 'General note', atMs: null });

    // Reply, in the conversation that is still open.
    const reply = card(page, 'c-late').getByRole('textbox', { name: 'Reply…' });
    await reply.fill('On it');
    await reply.press('Enter');
    await expect.poll(async () => (await calls(page, 'addFileComment')).length).toBe(3);
    expect((await calls(page, 'addFileComment'))[2].args[1]).toMatchObject({ body: 'On it', replyTo: 'c-late', atMs: null, page: null });
    await expect(card(page, 'c-late').locator('[data-cmt-row]')).toHaveCount(2);

    // Resolve: it moves under Resolved, and the header says so.
    await row(page, 'c-early').click();
    await card(page, 'c-early').getByRole('button', { name: 'Resolve' }).click();
    await expect.poll(async () => (await calls(page, 'resolveFileComment')).map((c) => c.args)).toEqual([['c-early', true]]);
    await expect(fold(page, 'resolved').locator('.cmt-list-tab-n')).toHaveText('2');
    await expect(rail(page).locator('.fsc-total')).toHaveText('3 open · 2 resolved');
    // …with a way back, as on the canvas: Undo opens it again.
    const resolved = page.locator('.toast').filter({ hasText: 'Comment resolved' });
    await resolved.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await calls(page, 'resolveFileComment')).map((c) => c.args)).toEqual([['c-early', true], ['c-early', false]]);
    await expect(rail(page).locator('.fsc-total')).toHaveText('4 open · 1 resolved');

    // Delete lives in the row's menu; then Undo restores it.
    await row(page, 'c-late').click();
    const mine = card(page, 'c-late').locator('[data-cmt-row="c-late"]');
    await expect(card(page, 'c-late').getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await mine.hover();
    await mine.getByRole('button', { name: 'More' }).click();
    await page.locator('.cmt-pop').getByRole('menuitem', { name: 'Delete' }).click();
    await expect.poll(async () => (await calls(page, 'deleteFileComment')).map((c) => c.args)).toEqual([['c-late']]);
    // it still has a reply, so it stays as a row that says only that it was deleted
    await expect(rail(page).locator('[data-thread="c-late"]').first()).toContainText('Comment deleted');
    await expect(rail(page).locator('[data-thread="c-late"]').first()).not.toContainText('Hold this frame');
    await page.locator('.toast').filter({ hasText: 'Comment deleted' }).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await calls(page, 'restoreFileComment')).map((c) => c.args)).toEqual([['c-late']]);
    await expect(rail(page).locator('[data-thread="c-late"]').first()).toContainText('Hold this frame a beat longer');
  });

  test('your own words can be edited; before the migration the rail says so and keeps them', async ({ page }) => {
    await open(page, 'video-threads');
    await row(page, TH.mine).click();
    const mine = card(page, TH.mine).locator(`[data-cmt-row="${TH.mine}"]`);
    await mine.hover();
    await mine.getByRole('button', { name: 'More' }).click();
    await expect(page.locator('.cmt-pop [role="menuitem"]')).toHaveText(['Copy link', 'Edit', 'Delete']);
    await page.locator('.cmt-pop').getByRole('menuitem', { name: 'Edit' }).click();
    const edit = mine.getByRole('textbox');
    await edit.fill('Hold it two beats');
    await edit.press('Enter');
    await expect.poll(async () => (await calls(page, 'editFileComment')).map((c) => c.args)).toEqual([[TH.mine, 'Hold it two beats']]);
    await expect(mine).toContainText('Hold it two beats');
    // someone else's row offers only the link
    await row(page, TH.early).click();
    const theirs = card(page, TH.early).locator(`[data-cmt-row="${TH.early}"]`);
    await theirs.hover();
    await theirs.getByRole('button', { name: 'More' }).click();
    await expect(page.locator('.cmt-pop [role="menuitem"]')).toHaveText(['Copy link']);

    await open(page, 'video-threads-before');
    await row(page, TH.mine).click();
    const row2 = card(page, TH.mine).locator(`[data-cmt-row="${TH.mine}"]`);
    await row2.hover();
    await row2.getByRole('button', { name: 'More' }).click();
    await page.locator('.cmt-pop').getByRole('menuitem', { name: 'Edit' }).click();
    await row2.getByRole('textbox').fill('Changed words');
    await row2.getByRole('textbox').press('Enter');
    await expect(toast(page, "Editing isn't available yet.")).toBeVisible();
    await expect(row2.getByRole('textbox')).toHaveValue('Changed words');
    // …and an author whose resolve the database still refuses is told quietly
    await row2.getByRole('textbox').press('Escape');
    await page.getByRole('button', { name: /^Discard/ }).click();
    await card(page, TH.mine).getByRole('button', { name: 'Resolve' }).click();
    await expect.poll(async () => (await calls(page, 'resolveFileComment')).length).toBe(1);
    await expect(card(page, TH.mine)).toBeVisible();
    await expect(page.locator('.fsp-stage .film')).toHaveCount(1);
  });

  test('a reply on a resolved conversation shows, and says when it stays resolved', async ({ page }) => {
    await open(page, 'video-threads');
    await expect(rail(page).locator('.fsc-total')).toHaveText('3 open · 1 resolved');
    await fold(page, 'resolved').click();
    await row(page, TH.done).click();
    // the viewer neither started it nor manages the file: no promise to reopen
    const reply = card(page, TH.done).getByRole('textbox', { name: 'Reply…' });
    await reply.fill('One more thing');
    await reply.press('Enter');
    await expect(toast(page, 'Sent. Only an editor or the person who started this can reopen it.')).toBeVisible();
    expect(await calls(page, 'resolveFileComment')).toEqual([]);
    await expect(card(page, TH.done)).toContainText('One more thing');
    await expect(card(page, TH.done)).toContainText('Looks right now');

    // Someone who may reopen is told so, and the reply reopens first.
    await open(page, 'video-comment');
    await fold(page, 'resolved').click();
    await row(page, 'c-done').click();
    const again = card(page, 'c-done').getByRole('textbox', { name: 'Reply to reopen…' });
    await again.fill('Not quite');
    await again.press('Enter');
    await expect.poll(async () => (await calls(page, 'resolveFileComment')).map((c) => c.args)).toEqual([['c-done', false]]);
    await expect.poll(async () => (await calls(page, 'addFileComment')).length).toBe(1);
    await expect(rail(page).locator('.fsc-total')).toHaveText('3 open');
  });

  test('a deleted comment that still has a reply says only that', async ({ page }) => {
    await open(page, 'video-threads');
    await expect(row(page, TH.gone)).toContainText('Comment deleted');
    await expect(row(page, TH.gone).locator('.cmt-list-who')).toHaveCount(0);
    await row(page, TH.gone).click();
    const gone = card(page, TH.gone).locator(`[data-cmt-row="${TH.gone}"]`);
    await expect(gone).toContainText('Comment deleted');
    await expect(gone.locator('.fsc-avatar, img')).toHaveCount(0);
    await expect(card(page, TH.gone)).toContainText('Still worth a look');
  });

  test('Copy link, and a link opens its conversation', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, 'video-threads');
    await row(page, TH.mine).click();
    const mine = card(page, TH.mine).locator(`[data-cmt-row="${TH.mine}"]`);
    await mine.hover();
    await mine.getByRole('button', { name: 'More' }).click();
    await page.locator('.cmt-pop').getByRole('menuitem', { name: 'Copy link' }).click();
    await expect(toast(page, 'Link copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/f/${TOKEN}\\?comment=${TH.mine}$`));

    // A resolved one: its section opens, the player goes there, the address is cleaned.
    await page.goto(`/?fileshareqa=video-threads&comment=${TH.done}`);
    await expect(card(page, TH.done)).toBeVisible();
    await expect.poll(() => videoTime(page)).toBeGreaterThan(0.9);
    await expect(page).not.toHaveURL(/comment=/);
    // One on an earlier version: its section opens, and nothing seeks.
    await page.goto(`/?fileshareqa=video-threads&comment=${TH.old}`);
    await expect(card(page, TH.old)).toBeVisible();
    expect(await videoTime(page)).toBe(0);
    // One that is gone.
    await page.goto('/?fileshareqa=video-threads&comment=aaaa0099-0000-4000-8000-000000000099');
    await expect(toast(page, "That comment isn't here any more")).toBeVisible();
    await expect(page).not.toHaveURL(/comment=/);
  });

  test('a refresh that fails says so quietly and keeps the list', async ({ page }) => {
    await open(page, 'video-threads');
    await expect(rail(page).locator('.fsr-row')).toHaveCount(3);
    const poll = (fail) => page.evaluate((f) => {
      window.__fileShareQa.api.fail.listFileComments = f;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, fail);
    await poll(true);
    await expect(rail(page).locator('.fsc-stale')).toHaveText("Couldn't refresh. Trying again…");
    await expect(rail(page).locator('.fsr-row')).toHaveCount(3);
    await poll(false);
    await expect(rail(page).locator('.fsc-stale')).toHaveCount(0);
  });

  test('keys typed in a comment are the comment\'s, and unsent words are kept', async ({ page }) => {
    await open(page, 'video-threads');
    await videoReady(page);
    // opened from the keyboard, the caret goes into the conversation
    await row(page, TH.mine).focus();
    await page.keyboard.press('Enter');
    await expect(card(page, TH.mine)).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.cmt-card'))).toBe(true);
    await expect.poll(() => videoTime(page)).toBeGreaterThan(1.4);
    const at = await videoTime(page);
    const reply = card(page, TH.mine).getByRole('textbox', { name: 'Reply…' });
    await reply.click();
    await page.keyboard.type('k j l m half a thought');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Home');
    expect(await videoTime(page)).toBe(at);
    expect(await page.locator('.fsp-stage video').evaluate((v) => v.paused)).toBe(true);
    // Escape asks before it lets the words go
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(card(page, TH.mine)).toBeVisible();
    await page.keyboard.press('Escape');
    // a seek elsewhere does not take the conversation away while words are unsent
    const track = await page.locator('.ft-track').boundingBox();
    await page.mouse.click(track.x + track.width * 0.05, track.y + 8);
    await page.waitForTimeout(700);
    await expect(card(page, TH.mine)).toBeVisible();
    // leaving for another conversation, and loading the page again, keep them
    await row(page, TH.early).click();
    await row(page, TH.mine).click();
    await expect(card(page, TH.mine).getByRole('textbox', { name: 'Reply…' })).toHaveValue('k j l m half a thought');
    await page.reload();
    await page.waitForSelector('[data-fileshareqa-ready]', { state: 'attached' });
    await row(page, TH.mine).click();
    await expect(card(page, TH.mine).getByRole('textbox', { name: 'Reply…' })).toHaveValue('k j l m half a thought');
  });

  test('an audio file has its comments along a line, and playing past one puts it away', async ({ page }) => {
    await open(page, 'audio-comment');
    await expect(page.locator('.fsp-amark')).toHaveCount(2);        // none for the earlier version
    await page.waitForFunction(() => (document.querySelector('.fsp-stage audio')?.readyState || 0) >= 1);
    await page.locator(`.fsp-amark[data-mark="${TH.mine}"]`).click();
    await expect(card(page, TH.mine)).toBeVisible();
    await expect(page.locator('.fsp-amark.is-active')).toHaveCount(1);
    await expect.poll(() => page.locator('.fsp-stage audio').evaluate((a) => a.currentTime)).toBeGreaterThan(1.4);
    // (each seek is let land before the next: a second one on its heels can leave this short clip seeking)
    const landed = () => page.waitForFunction(() => { const a = document.querySelector('.fsp-stage audio'); return !a.seeking && a.readyState >= 2; });
    await landed();
    await row(page, TH.early).click();
    await expect.poll(() => page.locator('.fsp-stage audio').evaluate((a) => a.currentTime)).toBeLessThan(0.7);
    await landed();
    // the file loops round and leaves the moment behind
    await page.locator(`.fsp-amark[data-mark="${TH.mine}"]`).click();
    await landed();
    await page.locator('.fsp-stage audio').evaluate((a) => { a.muted = true; a.loop = true; a.play().catch(() => {}); });
    await expect(rail(page).locator('.cmt-thread.is-open')).toHaveCount(0, { timeout: 8000 });
  });

  test('the conversations failing to download leaves the file as it is', async ({ page }) => {
    await page.route(/\/comments\/fileCommentParts\.js/, (r) => r.abort());
    await open(page, 'video-comment');
    await expect(rail(page).getByText("Couldn't load comments.")).toBeVisible();
    await expect(rail(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('.fsp-stage .film video')).toHaveCount(1);
    await expect(page.locator('.fsp-name')).toHaveText('Opening titles v3');
    await expect(rail(page).locator('.fsc-total')).toHaveText('2 open · 1 resolved');
  });

  test('a comment body is text, never markup', async ({ page }) => {
    await open(page, 'video-comment');
    const body = row(page, 'c-early').locator('.cmt-list-text');
    await expect(body).toHaveText('Title card <b>x</b> comes in early');
    await expect(body.locator('b')).toHaveCount(0);
    await row(page, 'c-early').click();
    const said = card(page, 'c-early').locator('[data-cmt-row="c-early"]');
    await expect(said).toContainText('Title card <b>x</b> comes in early');
    await expect(said.locator('b')).toHaveCount(0);
  });

  test('a pdf comment pins to a page and its row turns to it', async ({ page }) => {
    await open(page, 'pdf');
    await expect(page.locator('.fsp-stage .pdfv')).toBeVisible();
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^1 \/ \d+$/, { timeout: 15000 });
    await expect(row(page, 'p-1').locator('.fsr-chip')).toHaveText('p. 2');
    await row(page, 'p-1').click();
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^2 \/ \d+$/);
    const box = rail(page).locator('.fsr-new');
    const input = box.getByRole('textbox', { name: 'Add a comment…' });
    await input.click();
    await expect(box.locator('.fsr-moment')).toContainText('p. 2');
    await expect(box.locator('.fsr-moment')).toContainText('Comment on this page');
    await input.fill('Typo in the second paragraph');
    // the arrows move the caret here, not the pages
    await input.press('ArrowUp');
    await input.press('ArrowDown');
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^2 \/ \d+$/);
    await input.press('Enter');
    await expect.poll(async () => (await calls(page, 'addFileComment')).length).toBe(1);
    expect((await calls(page, 'addFileComment'))[0].args[1]).toMatchObject({ page: 2, atMs: null });
  });

  test('Download shows only when downloading is allowed', async ({ page }) => {
    await open(page, 'video-comment');
    await expect(page.getByRole('link', { name: 'Download' })).toHaveCount(1);
    await open(page, 'image');
    await expect(page.locator('.fsp-stage .lightbox-stage')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download' })).toHaveCount(0);
    // View access: no comment rail at all.
    await expect(page.locator('.fsp-rail')).toHaveCount(0);
  });

  test('a program file warns and never plays inline', async ({ page }) => {
    await open(page, 'file-risky');
    await expect(page.getByText('Files like this can run programs on your computer. Only download it if you trust the person who shared it.')).toBeVisible();
    await expect(page.locator('.fsp-ext')).toHaveText('EXE');
    await expect(page.locator('.fsp-stage video, .fsp-stage audio, .fsp-stage img, .fsp-stage iframe, .fsp-stage canvas')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Download' })).toHaveCount(1);
  });

  test('signed out: comments ask to sign in and come back to this file', async ({ page }) => {
    await open(page, 'signed-out-comment');
    await expect(row(page, 's-1')).toContainText('Love the opening');
    await expect(rail(page).getByRole('textbox')).toHaveCount(0);
    const link = rail(page).getByRole('link', { name: 'Sign in to comment' });
    expect(await link.getAttribute('href')).toContain(`back=file&file_token=${TOKEN}`);
    await expect(page.getByRole('link', { name: 'Try Clusters free' })).toHaveAttribute('href', `/?utm_source=file_share&utm_medium=cta&utm_campaign=${TOKEN}`);
    await expect(page.getByText('Made with Clusters, one place for every file you make.')).toBeVisible();
  });

  test('a view-only link shows the file and nothing to comment with', async ({ page }) => {
    await open(page, 'view-only');
    await expect(page.locator('.fsp-name')).toHaveText('Still 04');
    await expect(page.locator('.fsp-rail')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Download' })).toHaveCount(0);
  });

  test('on a narrow screen the box sits under the file, then the comments', async ({ page }) => {
    await open(page, 'video-comment');
    await page.setViewportSize({ width: 390, height: 844 });
    const stage = await page.locator('.fsp-stage').boundingBox();
    const slot = page.locator('.fsp-compose-slot');
    await expect(slot.getByRole('textbox', { name: 'Add a comment…' })).toBeVisible();
    await expect(rail(page).locator('.fsr-new')).toHaveCount(0);
    const box = await slot.boundingBox();
    const r = await page.locator('.fsp-rail').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    expect(r.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    expect(await slot.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    // the active conversation, with its reply box, takes the same place
    await row(page, 'c-late').click();
    await expect(slot.locator('.cmt-card')).toBeVisible();
    await expect(slot.getByRole('textbox', { name: 'Reply…' })).toBeVisible();
    await expect(row(page, 'c-late')).toHaveClass(/is-open/);
    const overflow = await page.locator('.fsp').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the page stops being the file when the share is stopped', async ({ page }) => {
    await open(page, 'video-comment');
    await expect(page.locator('.fsp-stage .film')).toHaveCount(1);
    await page.evaluate(() => {
      window.__fileShareQa.api.setShare({ status: 'gone' });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('heading', { name: "This file isn't available anymore." })).toBeVisible();
    await expect(page.locator('.fsp-stage')).toHaveCount(0);
  });
});

test.describe('a shared file: keys, replies and links', () => {
  test('inside the app, a notice about one comment opens the file at that conversation', async ({ page }) => {
    await open(page, 'overlay-comment');
    // what the bell's row and the toast's Open send (lib/sharedFileBus.js)
    await page.evaluate(async ({ token, commentId }) => {
      const m = await import('/src/lib/sharedFileBus.js');
      m.openSharedFile({ token, via: 'bell', commentId });
    }, { token: TOKEN, commentId: TH.mine });
    await expect(page.getByRole('dialog', { name: 'Shared file' })).toBeVisible();
    await expect(card(page, TH.mine)).toBeVisible();
    // the address under the app is left alone
    await expect(page).toHaveURL(/fileshareqa=overlay-comment$/);
    // an id that is not an id opens the file, at no conversation
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Shared file' })).toHaveCount(0);
    await page.evaluate(async ({ token }) => {
      const m = await import('/src/lib/sharedFileBus.js');
      m.openSharedFile({ token, via: 'bell', commentId: 'x"><b>' });
    }, { token: TOKEN });
    await expect(page.getByRole('dialog', { name: 'Shared file' })).toBeVisible();
    await expect(page.locator('.cmt-thread.is-open')).toHaveCount(0);
  });

  test('inside the app, Escape on a row of the list is the page\'s: it puts the conversation away, then closes', async ({ page }) => {
    await open(page, 'overlay-comment');
    await page.getByRole('button', { name: 'Open shared file' }).click();
    const dialog = page.getByRole('dialog', { name: 'Shared file' });
    await expect(dialog).toBeVisible();
    // opened from the keyboard: the caret is in the conversation
    await row(page, TH.mine).focus();
    await page.keyboard.press('Enter');
    await expect(card(page, TH.mine)).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.cmt-card'))).toBe(true);
    // 1: the conversation's own Escape closes it, and nothing is active
    await page.keyboard.press('Escape');
    await expect(card(page, TH.mine)).toHaveCount(0);
    await expect(rail(page).locator('.fsr-row.is-open')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-thread'))).toBe(TH.mine);
    // 2: on its row, in the rail, Escape is the dialog's
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // An active conversation with the caret on another row: Escape puts it
    // away, the next one closes.
    await page.getByRole('button', { name: 'Open shared file' }).click();
    await expect(dialog).toBeVisible();
    await row(page, TH.mine).click();
    await expect(card(page, TH.mine)).toBeVisible();
    await row(page, TH.early).focus();
    await page.keyboard.press('Escape');
    await expect(card(page, TH.mine)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // In the box you write in it stays the box's own.
    await page.getByRole('button', { name: 'Open shared file' }).click();
    await expect(dialog).toBeVisible();
    const box = rail(page).getByRole('textbox', { name: 'Add a comment…' });
    await box.click();
    await page.keyboard.type('half');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('a reply to a resolved conversation is sent first; a reopen that fails is said, a send that fails changes nothing', async ({ page }) => {
    await open(page, 'video-comment');
    await fold(page, 'resolved').click();
    await row(page, 'c-done').click();
    const reply = card(page, 'c-done').getByRole('textbox', { name: 'Reply to reopen…' });
    // the send fails: nothing is reopened, the words stay
    await page.evaluate(() => { window.__fileShareQa.api.fail.addFileComment = true; });
    await reply.fill('Not quite');
    await reply.press('Enter');
    await expect.poll(async () => (await calls(page, 'addFileComment')).length).toBe(1);
    await page.waitForTimeout(300);
    expect(await calls(page, 'resolveFileComment')).toEqual([]);
    await expect(rail(page).locator('.fsc-total')).toHaveText('2 open · 1 resolved');
    await expect(reply).toHaveValue('Not quite');
    // the send works and the reopen fails: sent, and told it stayed resolved
    await page.evaluate(() => {
      window.__fileShareQa.api.fail.addFileComment = false;
      window.__fileShareQa.api.fail.resolveFileComment = true;
    });
    await reply.press('Enter');
    await expect(toast(page, "Sent, but it couldn't be reopened. Try again.")).toBeVisible();
    const order = await page.evaluate(() => window.__fileShareQa.calls.map((c) => c.fn).filter((f) => f === 'addFileComment' || f === 'resolveFileComment'));
    expect(order).toEqual(['addFileComment', 'addFileComment', 'resolveFileComment']);
    await expect(rail(page).locator('.fsc-total')).toHaveText('2 open · 1 resolved');
    await expect(card(page, 'c-done')).toContainText('Not quite');
  });

  test('at phone width the box takes the caret only when asked, not when it is drawn again', async ({ page }) => {
    await open(page, 'video-comment');
    await page.setViewportSize({ width: 390, height: 844 });
    await videoReady(page);
    const slot = page.locator('.fsp-compose-slot');
    const box = slot.getByRole('textbox', { name: 'Add a comment…' });
    await expect(box).toBeVisible();
    await expect(box).not.toBeFocused();
    // C asks for a comment: the box takes the caret
    await page.locator('.fsp-stage video').click();
    await page.keyboard.press('c');
    await expect(box).toBeFocused();
    await box.blur();
    // a conversation takes the box's place, then gives it back: the box is
    // drawn again, and the old request does not bring the keyboard up
    await row(page, 'c-late').click();
    await expect(slot.locator('.cmt-card')).toBeVisible();
    await slot.locator('.cmt-card').getByRole('button', { name: 'Close' }).click();
    await expect(box).toBeVisible();
    await page.waitForTimeout(300);
    await expect(box).not.toBeFocused();
    // the moment it will sit at wears the gold ring, and loses it with the moment
    const moment = slot.locator('.fsr-moment');
    await expect(moment.locator('.fsr-chip.is-at')).toHaveCount(1);
    await moment.click();
    await expect(moment).toHaveText('Comment on the whole file');
    await expect(moment.locator('.fsr-chip')).toHaveCount(0);
    // and asking again still works (the caret has to be out of the comments:
    // while it is in them, C is a letter)
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.locator('.fsp-stage video').click();
    await page.keyboard.press('c');
    await expect(box).toBeFocused();
  });

  test('a link to a comment waits for the player: the time is applied once it is there, then the address is cleaned', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route(/\/film\/FilmPlayer\.jsx/, async (r) => { await held; await r.continue(); });
    await page.goto(`/?fileshareqa=video-threads&comment=${TH.done}`);
    // the conversation is shown, the player is not there yet: the address keeps the comment
    await expect(card(page, TH.done)).toBeVisible();
    await expect(page.locator('.fsp-stage video')).toHaveCount(0);
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/comment=/);
    release();
    await expect.poll(() => videoTime(page)).toBeGreaterThan(0.9);
    await expect(page).not.toHaveURL(/comment=/);
    await expect(card(page, TH.done)).toBeVisible();
  });

  test('a whole-file comment has no empty chip in its header', async ({ page }) => {
    await open(page, 'video-comment');
    const box = rail(page).getByRole('textbox', { name: 'Add a comment…' });
    await rail(page).locator('.fsr-moment').click();
    await box.fill('About the whole thing');
    await box.press('Enter');
    const mine = rail(page).locator('.fsr-row', { hasText: 'About the whole thing' });
    await mine.click();
    const open_ = rail(page).locator('.cmt-thread.is-open');
    await expect(open_).toContainText('About the whole thing');
    await expect(open_.locator('.cmt-headx')).toHaveCount(0);
    // one with a time has its chip
    await row(page, 'c-late').click();
    await expect(card(page, 'c-late').locator('.cmt-headx .fsr-chip')).toHaveCount(1);
  });
});

test.describe('a shared file over time', () => {
  const vid = (page) => page.locator('.fsp-stage video');
  const refresh = (page, patch) => page.evaluate((p) => {
    const a = window.__fileShareQa.api;
    const cur = a.getShare();
    a.setShare(p.status ? p : { ...cur, urls: { ...cur.urls, src: `${cur.urls.src.split('#')[0]}#${p.tag}` } });
    if (p.event !== 'none') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  }, patch);
  const fetches = async (page) => (await calls(page, 'fetchFileShare')).length;

  test('a refresh that fails in any new way keeps the file, and keeps checking', async ({ page }) => {
    await open(page, 'video-comment');
    await expect(page.locator('.fsp-stage .film')).toHaveCount(1);
    const before = await fetches(page);
    await refresh(page, { status: 'auth_expired' });
    await expect.poll(() => fetches(page)).toBeGreaterThan(before);
    await expect(page.locator('.fsp-stage .film')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: "Couldn't load this file." })).toHaveCount(0);
    await refresh(page, { status: 'gone' });
    await expect(page.getByRole('heading', { name: "This file isn't available anymore." })).toBeVisible();
  });

  test('a first read that says auth_expired asks once more as nobody', async ({ page }) => {
    await open(page, 'auth-expired');
    await expect(page.locator('.fsp-name')).toHaveText('Look book');
    // (StrictMode's double mount in dev reads twice; the first read is the one that retries.)
    const args = (await calls(page, 'fetchFileShare')).map((c) => c.args);
    expect(args[0]).toEqual([TOKEN]);
    expect(args.filter((x) => x[1]?.anonymous === true)).toEqual([[TOKEN, { anonymous: true }]]);
  });

  test('old urls: a stopped video remounts on the fresh ones, at the same time', async ({ page }) => {
    await open(page, 'video-stale');
    await page.waitForFunction(() => (document.querySelector('.fsp-stage video')?.readyState || 0) >= 1);
    await row(page, 'c-late').click();
    await expect.poll(() => vid(page).evaluate((v) => v.currentTime)).toBeGreaterThan(1.4);
    await vid(page).evaluate((v) => { v.dataset.old = '1'; });

    // New urls while the old ones are still young: nothing moves.
    const before = await fetches(page);
    await refresh(page, { tag: 'young' });
    await expect.poll(() => fetches(page)).toBeGreaterThan(before);
    await page.waitForTimeout(200);
    await expect(page.locator('.fsp-stage video[data-old]')).toHaveCount(1);

    await page.waitForTimeout(1700);
    await refresh(page, { tag: 'fresh' });
    await expect(page.locator('.fsp-stage video[data-old]')).toHaveCount(0);
    await expect(vid(page)).toHaveCount(1);
    await expect.poll(() => vid(page).evaluate((v) => v.currentSrc)).toMatch(/#fresh$/);
    await expect.poll(() => vid(page).evaluate((v) => v.currentTime)).toBeGreaterThan(1.4);
    expect(await vid(page).evaluate((v) => v.paused)).toBe(true);
  });

  test('old urls: a video error re-fetches and remounts at once', async ({ page }) => {
    await open(page, 'video-stale');
    await page.waitForFunction(() => (document.querySelector('.fsp-stage video')?.readyState || 0) >= 1);
    await row(page, 'c-late').click();
    await expect.poll(() => vid(page).evaluate((v) => v.currentTime)).toBeGreaterThan(1.4);
    await vid(page).evaluate((v) => { v.dataset.old = '1'; });
    await page.waitForTimeout(1700);
    await refresh(page, { tag: 'fresh', event: 'none' });
    const before = await fetches(page);
    await vid(page).evaluate((v) => v.dispatchEvent(new Event('error')));
    await expect.poll(() => fetches(page)).toBeGreaterThan(before);
    await expect(page.locator('.fsp-stage video[data-old]')).toHaveCount(0);
    await expect.poll(() => vid(page).evaluate((v) => v.currentSrc)).toMatch(/#fresh$/);
    await expect.poll(() => vid(page).evaluate((v) => v.currentTime)).toBeGreaterThan(1.4);
  });

  test('old urls: a PDF remounts on the fresh ones, on the same page', async ({ page }) => {
    await open(page, 'pdf-stale');
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^1 \/ \d+$/, { timeout: 15000 });
    await row(page, 'p-1').click();
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^2 \/ \d+$/);
    await page.locator('.fsp-stage .pdfv').evaluate((el) => { el.dataset.old = '1'; });
    await page.waitForTimeout(1700);
    await refresh(page, { tag: 'fresh' });
    await expect(page.locator('.fsp-stage .pdfv[data-old]')).toHaveCount(0);
    await expect(page.locator('.fsp-stage .pdfv')).toBeVisible();
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^2 \/ \d+$/, { timeout: 15000 });
  });
});

test.describe('the owner dialog', () => {
  const dlg = (page) => page.locator('.fsd-modal');

  test('add two emails (one invalid), change a role, remove and undo', async ({ page }) => {
    await open(page, 'dialog');
    await expect(dlg(page).getByText('Jun Park')).toBeVisible();
    const input = dlg(page).getByLabel('Add people by email');
    await input.pressSequentially('sam@example.com,');
    await input.pressSequentially('not-an-email,');
    await expect(dlg(page).locator('.fsd-chip')).toHaveCount(2);
    await expect(dlg(page).locator('.fsd-chip.is-invalid')).toHaveCount(1);
    await dlg(page).getByRole('button', { name: 'Send' }).click();
    await expect(dlg(page).locator('.fsd-person[data-email="sam@example.com"]')).toBeVisible();
    const added = await calls(page, 'addFileSharePeople');
    expect(added).toHaveLength(1);
    expect(added[0].args[2]).toEqual(['sam@example.com']);
    expect(added[0].args[3]).toBe('comment');
    // The dialog's own status line, never a toast: it can sit over a
    // full-screen viewer, which covers the toast stack.
    await expect(dlg(page).locator('.fsd-notice[role="status"]')).toContainText('Shared with 1 · 1 skipped');

    await dlg(page).getByLabel('Access for Jun Park').selectOption('view');
    await expect.poll(async () => (await calls(page, 'setFileSharePerson')).length).toBe(1);
    expect((await calls(page, 'setFileSharePerson'))[0].args.slice(2)).toEqual(['jun@example.com', 'view']);

    await dlg(page).getByLabel('Access for Jun Park').selectOption('__remove');
    await expect(dlg(page).locator('.fsd-person[data-email="jun@example.com"]')).toHaveCount(0);
    await expect(dlg(page).locator('.fsd-notice[role="status"]')).toContainText('Removed Jun Park');
    await dlg(page).getByRole('button', { name: 'Undo' }).click();
    await expect(dlg(page).locator('.fsd-person[data-email="jun@example.com"]')).toBeVisible();
    const sp = await calls(page, 'setFileSharePerson');
    expect(sp[sp.length - 1].args.slice(2)).toEqual(['jun@example.com', 'view']);
  });

  test('general access and downloading write through', async ({ page }) => {
    await open(page, 'dialog');
    await dlg(page).getByLabel('Who can open it').selectOption('anyone');
    await expect(dlg(page).getByLabel('What anyone with the link can do')).toBeVisible();
    await expect.poll(async () => (await calls(page, 'setFileShare')).length).toBeGreaterThan(0);
    const sw = dlg(page).getByRole('switch', { name: 'Allow downloading' });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    const last = (await calls(page, 'setFileShare')).pop();
    expect(last.args[2].allowDownload).toBe(false);
  });

  test('two queued writes that both fail end on what the server has', async ({ page }) => {
    await open(page, 'dialog-fail');
    await expect(dlg(page).getByText('Jun Park')).toBeVisible();
    const who = dlg(page).getByLabel('Who can open it');
    const sw = dlg(page).getByRole('switch', { name: 'Allow downloading' });
    await who.selectOption('anyone');
    await sw.click();
    await expect.poll(async () => (await calls(page, 'setFileShare')).length).toBe(2);
    await page.waitForTimeout(700);   // the second write's answer (400ms) lands
    await expect(who).toHaveValue('restricted');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(dlg(page).getByLabel('What anyone with the link can do')).toHaveCount(0);
    await expect(dlg(page).locator('.fsd-error')).toHaveText("New accounts can't open program files to anyone with the link yet.");

    // People: remove one, change another, both fail: both are back as they were.
    await dlg(page).getByLabel('Access for Jun Park').selectOption('__remove');
    await dlg(page).getByLabel('Access for Sam Lee').selectOption('view');
    await expect.poll(async () => (await calls(page, 'setFileSharePerson')).length).toBe(2);
    await page.waitForTimeout(700);
    await expect(dlg(page).getByLabel('Access for Jun Park')).toHaveValue('comment');
    await expect(dlg(page).getByLabel('Access for Sam Lee')).toHaveValue('comment');
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  });

  test('Copy link writes the share URL', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, 'dialog');
    await dlg(page).getByRole('button', { name: 'Copy link' }).click();
    await expect(dlg(page).getByRole('button', { name: 'Copied' })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toMatch(new RegExp(`/f/${TOKEN}$`));
  });
});

test.describe('sharing from a full-screen viewer', () => {
  const dlg = (page) => page.locator('.fsd-modal');
  const share = (page) => page.locator('.fsb-btn');

  // The dialog is the thing on top: the point at its centre is inside it.
  async function dialogOnTop(page) {
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page).getByLabel('Add people by email')).toBeVisible();
    const inside = await page.evaluate(() => {
      const r = document.querySelector('.fsd-modal').getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!el?.closest?.('.fsd-modal');
    });
    expect(inside).toBe(true);
  }

  test('the lightbox: Shared, opens the dialog on top, keys stay in it, Escape closes only it', async ({ page }) => {
    await open(page, 'lightbox-share');
    await expect(page.locator('.lightbox')).toBeVisible();
    await expect(share(page)).toHaveText('Shared');
    await expect(share(page)).toHaveAttribute('aria-label', 'Shared - manage sharing');
    await expect(share(page)).toHaveClass(/lightbox-share/);
    await share(page).click();
    await dialogOnTop(page);
    await expect(page.locator('.lightbox')).toBeVisible();

    const input = dlg(page).getByLabel('Add people by email');
    await input.click();
    await input.press('ArrowRight');
    await input.press('ArrowLeft');
    await input.press('Space');
    await expect(page.locator('.lightbox')).toHaveClass(/lightbox-mode-fit/);
    await expect(page.locator('.lightbox')).toBeVisible();

    await input.press('Escape');
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator('.lightbox')).toBeVisible();
    await expect(page.locator('[data-fileshareqa-viewer-closed]')).toHaveCount(0);
    // And the viewer's own Escape still works once the dialog is gone.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-fileshareqa-viewer-closed]')).toHaveCount(1);
  });

  test('the PDF viewer: Share, dialog on top, no paging from the dialog, Shared after a write', async ({ page }) => {
    await open(page, 'pdf-share');
    await expect(page.locator('.pdfv')).toBeVisible();
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^1 \/ \d+$/, { timeout: 15000 });
    await expect(share(page)).toHaveText('Share');
    await expect(share(page)).toHaveAttribute('aria-label', 'Share file');
    await expect(share(page)).toHaveClass(/pdfv-btn/);
    // It sits in the bar before Download.
    const order = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.pdfv-bar > button')];
      return [btns.findIndex((b) => b.classList.contains('fsb-btn')), btns.findIndex((b) => b.getAttribute('aria-label') === 'Download')];
    });
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1]);

    await share(page).click();
    await dialogOnTop(page);
    const input = dlg(page).getByLabel('Add people by email');
    await input.click();
    for (const k of ['ArrowRight', 'ArrowDown', 'PageDown', 'Space']) await input.press(k);
    await page.waitForTimeout(400);   // a smooth scroll to page 2 would have landed
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^1 \/ \d+$/);
    expect(await page.locator('.pdfv-scroll').evaluate((el) => el.scrollTop)).toBe(0);

    // A write turns the button to Shared, through the bus.
    await input.fill('sam@example.com');
    await dlg(page).getByRole('button', { name: 'Send' }).click();
    await expect(dlg(page).locator('.fsd-notice[role="status"]')).toContainText('Shared with 1');
    await expect(share(page)).toHaveText('Shared');

    await page.keyboard.press('Escape');
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator('.pdfv')).toBeVisible();
    await expect(page.locator('[data-fileshareqa-viewer-closed]')).toHaveCount(0);
  });

  test('the page: Manage sharing for someone who manages it, and only them', async ({ page }) => {
    await open(page, 'manage-page');
    await expect(page.locator('.fsp-name')).toHaveText('Look book');
    const manage = page.getByRole('button', { name: 'Manage sharing' });
    await expect(manage).toBeVisible();
    await manage.click();
    await dialogOnTop(page);
    const settings = await calls(page, 'getFileShareSettings');
    expect(settings[settings.length - 1].args).toEqual(['qa-board', 'card-1']);
    const before = (await calls(page, 'fetchFileShare')).length;
    await dlg(page).getByRole('button', { name: 'Done' }).click();
    await expect(dlg(page)).toHaveCount(0);
    await expect.poll(async () => (await calls(page, 'fetchFileShare')).length).toBeGreaterThan(before);

    await open(page, 'image');   // view access
    await expect(page.locator('.fsp-name')).toHaveText('Look book');
    await expect(page.getByRole('button', { name: 'Manage sharing' })).toHaveCount(0);
    await open(page, 'pdf');     // comment access
    await expect(page.locator('.fsp-name')).toHaveText('Treatment.pdf');
    await expect(page.getByRole('button', { name: 'Manage sharing' })).toHaveCount(0);
  });
});

// The real route: /f/<uuid> through main.jsx's ladder, outside AuthGate, with
// only the party's /file-share answer (and the comment RPC) mocked. The shape
// is the harness's ok() fixture; the video is the harness's local one.
test.describe('the /f/ route', () => {
  const ROUTE_TOKEN = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const VIDEO = '/tests/fixtures/media/frames-vp9.mp4';
  const viewOk = {
    status: 'ok', access: 'view', signed_in: false, can_comment: false, allow_download: false,
    file: { kind: 'video', name: 'Route cut v1', mime: 'video/mp4', size: 2304, duration: 2, page_count: null, ext: 'mp4', risky: false },
    shared_by: { name: 'Jules Marlow', avatar_url: null },
    comment_count: 0, urls: { src: VIDEO }, ttl: 21600,
  };

  async function openRoute(page, body) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const seen = [];
    await page.route('**/parties/upload/share/file-share', async (r) => {
      seen.push(r.request().postDataJSON());
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/rest/v1/rpc/get_file_comments', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', access: 'view', comments: [] }) }));
    await page.goto(`/f/${ROUTE_TOKEN}`);
    return seen;
  }

  test('a link to a comment: a share nobody may comment on drops it quietly; sign-in carries it back', async ({ page }) => {
    const C = 'aaaa0003-0000-4000-8000-000000000003';
    await openRoute(page, viewOk);
    await page.goto(`/f/${ROUTE_TOKEN}?comment=${C}`);
    await expect(page.locator('.fsp-name')).toHaveText('Route cut v1');
    await expect(page).not.toHaveURL(/comment=/);
    await expect(page).toHaveURL(new RegExp(`/f/${ROUTE_TOKEN}$`));
    await expect(page.locator('.toast-msg')).toHaveCount(0);

    // one that may be commented on, signed out: both sign-in links come back to the comment
    await page.unroute('**/parties/upload/share/file-share');
    await page.route('**/parties/upload/share/file-share', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...viewOk, access: 'comment' }) }));
    await page.goto(`/f/${ROUTE_TOKEN}?comment=${C}`);
    const link = page.locator('.fsp-rail').getByRole('link', { name: 'Sign in to comment' });
    await expect(link).toBeVisible();
    // the comment is gone (the list is empty): said, the address cleaned, and the way back still names it
    await expect(page).not.toHaveURL(/comment=/);
    expect(await link.getAttribute('href')).toContain(`back=file&file_token=${ROUTE_TOKEN}&`);
    expect(await link.getAttribute('href')).toMatch(new RegExp(`&comment=${C}$`));
    expect(await page.locator('.fsp-top-link').first().getAttribute('href')).toContain(`&comment=${C}`);
  });

  test('opens the shared file on its own page, with no app around it', async ({ page }) => {
    const seen = await openRoute(page, viewOk);
    await expect(page.locator('.fsp-name')).toHaveText('Route cut v1');
    await expect(page.locator('.fsp-stage video')).toHaveCount(1);
    expect(seen.some((b) => b?.token === ROUTE_TOKEN)).toBe(true);
    // No app chrome and no sign-in wall: the route renders before AuthGate.
    await expect(page.locator('.app')).toHaveCount(0);
    await expect(page.locator('.sidebar')).toHaveCount(0);
    await expect(page.locator('.topbar')).toHaveCount(0);
    await expect(page.locator('.auth-screen')).toHaveCount(0);
    await expect(page.locator('.auth-code-input')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Download' })).toHaveCount(0);
  });

  test('a link that has ended says so', async ({ page }) => {
    await openRoute(page, { status: 'gone' });
    await expect(page.getByRole('heading', { name: "This file isn't available anymore." })).toBeVisible();
    await expect(page.locator('.fsp-stage')).toHaveCount(0);
    await expect(page.locator('.app')).toHaveCount(0);
    await expect(page.locator('.auth-screen')).toHaveCount(0);
  });
});
