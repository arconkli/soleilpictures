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
const row = (page, id) => page.locator(`.fsc-row[data-comment-id="${id}"]`);

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

  test('a video shows its comments as markers, and a chip seeks the player', async ({ page }) => {
    await open(page, 'video-comment');
    await expect(page.locator('.fsp-stage .film video')).toHaveCount(1);
    await expect(page.locator('.fsp-name')).toHaveText('Opening titles v3');
    // Open, untimed-last, resolved collapsed: 500 then 1500 (and 200 from an earlier version).
    await expect(rail(page).locator('.fsc-threads').first().locator(':scope > .fsc-thread')).toHaveCount(3);
    await expect(page.locator('.ft-marker:not(.is-ghost)')).toHaveCount(3);
    await expect(row(page, 'c-old')).toContainText('on an earlier version');
    await expect(rail(page).getByRole('button', { name: 'Show 1 resolved' })).toBeVisible();

    // The player needs the clip loaded before a seek can land.
    await page.waitForFunction(() => (document.querySelector('.fsp-stage video')?.readyState || 0) >= 1);
    await row(page, 'c-late').getByRole('button', { name: 'Go to 0:01' }).click();
    await expect.poll(() => page.locator('.fsp-stage video').evaluate((v) => v.currentTime)).toBeGreaterThan(1.4);
    await expect(row(page, 'c-late')).toHaveClass(/is-active/);

    await row(page, 'c-early').getByRole('button', { name: 'Go to 0:00' }).click();
    await expect.poll(() => page.locator('.fsp-stage video').evaluate((v) => v.currentTime)).toBeLessThan(0.7);
    await expect(row(page, 'c-early')).toHaveClass(/is-active/);
  });

  test('the composer pins the playhead, and add / reply / resolve / delete + undo reach the api', async ({ page }) => {
    await open(page, 'video-comment');
    await page.waitForFunction(() => (document.querySelector('.fsp-stage video')?.readyState || 0) >= 1);
    await row(page, 'c-late').getByRole('button', { name: 'Go to 0:01' }).click();
    await expect.poll(() => page.locator('.fsp-stage video').evaluate((v) => v.currentTime)).toBeGreaterThan(1.4);

    const input = rail(page).getByRole('textbox', { name: 'Add a comment' });
    await input.click();
    const pin = rail(page).locator('.fsc-pin');
    await expect(pin).toHaveText(/^at 0:01$/);
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await input.fill('Cut here');
    await input.press('ControlOrMeta+Enter');
    await expect.poll(async () => (await calls(page, 'addFileComment')).length).toBe(1);
    const [add] = await calls(page, 'addFileComment');
    expect(add.args[0]).toBe(TOKEN);
    expect(add.args[1]).toMatchObject({ body: 'Cut here', replyTo: null, page: null });
    expect(add.args[1].atMs).toBeGreaterThanOrEqual(1400);
    expect(add.args[1].atMs).toBeLessThan(1700);
    await expect(input).toHaveValue('');
    await expect(rail(page).getByText('Cut here')).toBeVisible();

    // Unpinned, it carries no time.
    await input.click();
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    await input.fill('General note');
    await rail(page).getByRole('button', { name: 'Comment', exact: true }).click();
    await expect.poll(async () => (await calls(page, 'addFileComment')).length).toBe(2);
    expect((await calls(page, 'addFileComment'))[1].args[1]).toMatchObject({ body: 'General note', atMs: null });

    // Reply.
    await row(page, 'c-late').getByRole('button', { name: 'Reply' }).click();
    const reply = rail(page).getByRole('textbox', { name: 'Reply' });
    await reply.fill('On it');
    await rail(page).locator('.fsc-composer.is-reply').getByRole('button', { name: 'Reply' }).click();
    await expect.poll(async () => (await calls(page, 'addFileComment')).length).toBe(3);
    expect((await calls(page, 'addFileComment'))[2].args[1]).toMatchObject({ body: 'On it', replyTo: 'c-late', atMs: null, page: null });

    // Resolve: it moves under "resolved".
    await row(page, 'c-early').getByRole('button', { name: 'Resolve' }).click();
    await expect.poll(async () => (await calls(page, 'resolveFileComment')).map((c) => c.args)).toEqual([['c-early', true]]);
    await expect(rail(page).getByRole('button', { name: 'Show 2 resolved' })).toBeVisible();

    // Delete, then Undo restores it.
    await row(page, 'c-late').locator('> .fsc-actions').getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => (await calls(page, 'deleteFileComment')).map((c) => c.args)).toEqual([['c-late']]);
    await expect(row(page, 'c-late')).toContainText('Comment deleted');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await calls(page, 'restoreFileComment')).map((c) => c.args)).toEqual([['c-late']]);
    await expect(row(page, 'c-late')).toContainText('Hold this frame a beat longer');
  });

  test('a comment body is text, never markup', async ({ page }) => {
    await open(page, 'video-comment');
    const body = row(page, 'c-early').locator('.fsc-body');
    await expect(body).toHaveText('Title card <b>x</b> comes in early');
    await expect(body.locator('b')).toHaveCount(0);
  });

  test('a pdf comment pins to a page and its chip turns to it', async ({ page }) => {
    await open(page, 'pdf');
    await expect(page.locator('.fsp-stage .pdfv')).toBeVisible();
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^1 \/ \d+$/, { timeout: 15000 });
    await row(page, 'p-1').getByRole('button', { name: 'Go to page 2' }).click();
    await expect(page.locator('.pdfv-pageind')).toHaveText(/^2 \/ \d+$/);
    const input = rail(page).getByRole('textbox', { name: 'Add a comment' });
    await input.click();
    await expect(rail(page).locator('.fsc-pin')).toHaveText('on page 2');
    await input.fill('Typo in the second paragraph');
    await input.press('ControlOrMeta+Enter');
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

  test('the rail stacks under the file on a narrow screen', async ({ page }) => {
    await open(page, 'video-comment');
    await page.setViewportSize({ width: 390, height: 844 });
    const stage = await page.locator('.fsp-stage').boundingBox();
    const r = await page.locator('.fsp-rail').boundingBox();
    expect(r.y).toBeGreaterThan(stage.y + stage.height - 1);
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
    await row(page, 'c-late').getByRole('button', { name: 'Go to 0:01' }).click();
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
    await row(page, 'c-late').getByRole('button', { name: 'Go to 0:01' }).click();
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
    await row(page, 'p-1').getByRole('button', { name: 'Go to page 2' }).click();
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
