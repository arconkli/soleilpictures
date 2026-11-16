// note-doc-comments-app.spec.js
//
// Comments on a note's and a doc's words, in the real signed-in app on a real
// cluster (tests/commentApp.js answers Supabase): the paths the ?noteqa and
// ?docqa harnesses cannot reach. A note's menu on the canvas lists its
// comments ("Comments (n)"); Copy link says so and copies a link that names
// the cluster, the card and the comment; opening that link goes through
// App.jsx to the card and the thread, and leaves a clean address; a link to a
// comment that is gone says so once the cluster is in.

import { expect, test } from '@playwright/test';
import { signedIn, BOARD } from './commentApp.js';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const float = (page) => page.locator('.cmt-float-host .cmt-card');
const toast = (page, text) => page.locator('.toast-msg').filter({ hasText: text });
const noteBody = (page) => page.locator('.canvas-wrap .card .note-body');
const GONE = "That comment isn't here any more";

async function openCluster(page, query = '') {
  await page.goto(`/?board=${BOARD}${query}`);
  await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
}

// A note on the cluster with a comment on its words, made as a person makes
// them: N, a click, the words, then ⌘⌥M on the selection. Returns the
// thread's id; the note is left being read.
async function noteWithComment(page) {
  // (on a busy machine the canvas can be on screen a moment before it hears
  // keys: N again until the click makes the note)
  await expect(async () => {
    await page.keyboard.press('n');
    await page.mouse.click(640, 400);
    await expect(page.locator('.canvas-wrap .card')).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.keyboard.type('Rewrite the ending');
  await expect(noteBody(page)).toHaveText('Rewrite the ending');
  // ProseMirror picks a keyboard selection up a tick after the keypress, and
  // the shortcut does nothing on an empty one
  await expect(async () => {
    await page.keyboard.press('Shift+Home');
    await page.waitForTimeout(250);
    await page.keyboard.press('ControlOrMeta+Alt+m');
    await expect(float(page)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20000 });
  await float(page).locator('textarea').fill('Too abrupt?');
  await float(page).locator('textarea').press('Enter');
  await expect(float(page).locator('.cmt-row')).toHaveCount(1);
  const id = await float(page).getAttribute('data-cmt-card');
  await float(page).getByRole('button', { name: 'Close' }).click();
  await expect(float(page)).toHaveCount(0);
  await page.mouse.click(200, 650);
  await expect(page.locator('.canvas-wrap .card .note-body[contenteditable="true"]')).toHaveCount(0);
  return id;
}

test.describe('a note on a real cluster', () => {
  test('its menu lists its comments; Copy link says so; the link opens the thread and the address is cleaned', async ({ page, baseURL }) => {
    const app = await signedIn(page, baseURL);
    await openCluster(page);
    const id = await noteWithComment(page);
    const cardId = await page.locator('.canvas-wrap [data-card-id]').first().getAttribute('data-card-id');

    // the note's own menu on the canvas
    await noteBody(page).click({ button: 'right' });
    const item = page.locator('.ctx-menu').getByRole('menuitem', { name: 'Comments (1)' });
    await expect(item).toBeVisible();
    await item.click();
    const rows = page.locator('.cmt-float-host .cmt-list-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Too abrupt?');
    await rows.first().click();
    await expect(float(page).locator('.cmt-row .cmt-text')).toHaveText('Too abrupt?');

    // Copy link, from the conversation's menu
    await float(page).locator('.cmt-head').getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Copy link' }).click();
    await expect(toast(page, 'Link copied')).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const u = new URL(link);
    expect(u.origin).toBe(new URL(baseURL).origin);
    expect(u.searchParams.get('board')).toBe(BOARD);
    expect(u.searchParams.get('card')).toBe(cardId);
    expect(u.searchParams.get('comment')).toBe(id);

    // the cluster is saved with the comment in it
    const saved = app.state.saves;
    await expect.poll(() => app.state.saves, { timeout: 20000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    expect(app.state.saves).toBeGreaterThanOrEqual(saved);

    // the link, opened cold: App.jsx hands it to the note
    await page.goto(u.pathname + u.search);
    await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
    await expect(float(page)).toHaveAttribute('data-cmt-card', id, { timeout: 20000 });
    await expect(float(page).locator('.cmt-row .cmt-text')).toHaveText('Too abrupt?');
    await expect(toast(page, GONE)).toHaveCount(0);
    // one-shot: the address no longer names the card or the comment
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(noteBody(page)).toHaveText('Rewrite the ending');
  });

  test('a link to a comment the note no longer has says so, once the cluster is in', async ({ page, baseURL }) => {
    const app = await signedIn(page, baseURL);
    await openCluster(page);
    await noteWithComment(page);
    const cardId = await page.locator('.canvas-wrap [data-card-id]').first().getAttribute('data-card-id');
    await expect.poll(() => app.state.saves, { timeout: 20000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    await openCluster(page, `&card=${cardId}&comment=cm_nothere`);
    await expect(toast(page, GONE)).toBeVisible({ timeout: 20000 });
    await expect(float(page)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('');
  });
});

test.describe('a doc on a real cluster', () => {
  const modal = (page) => page.locator('.doc-card-modal');
  const panel = (page) => modal(page).getByRole('complementary', { name: 'Comments and find' });
  const thread = (page, id) => panel(page).locator(`.cmt-thread.is-open[data-thread="${id}"]`);
  // The doc's shortcut is the editor's own Mod-Alt-M, and Mod follows the
  // platform the page reports: this project reports Windows, whatever it runs on.
  const COMMENT_KEY = 'Control+Alt+m';

  // A doc on the empty cluster, open, with words in it.
  async function docWithWords(page) {
    await page.locator('.cnv-empty-tiles').getByRole('button', { name: 'Doc' }).click();
    await expect(modal(page)).toBeVisible({ timeout: 20000 });
    const editor = modal(page).locator('.tt-editor').first();
    await editor.click();
    await page.keyboard.type('We open on the blue hour alley');
    await expect(editor).toContainText('We open on the blue hour alley');
    return editor;
  }

  // The cluster is saved with the doc in it, and the doc is closed: left open
  // beside the cluster, the next load would bring the two panes back.
  async function savedAndClosed(page, app) {
    await expect.poll(() => app.state.saves, { timeout: 20000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    await modal(page).getByRole('button', { name: 'Close document' }).click();
    await expect(modal(page)).toHaveCount(0);
    await page.waitForTimeout(500);
  }

  test('⌘⌥M on selected words starts a comment; Copy link says so; the link opens the doc on its thread and the address is cleaned', async ({ page, baseURL }) => {
    const app = await signedIn(page, baseURL);
    await openCluster(page);
    await docWithWords(page);
    const cardId = await page.locator('.canvas-wrap [data-card-id]').first().getAttribute('data-card-id');

    // nothing selected: the shortcut starts nothing
    await page.keyboard.press(COMMENT_KEY);
    await page.waitForTimeout(400);
    await expect(float(page)).toHaveCount(0);

    await expect(async () => {
      await page.keyboard.press('Shift+Home');
      await page.waitForTimeout(250);
      await page.keyboard.press(COMMENT_KEY);
      await expect(float(page)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await expect(modal(page).locator('.cmt-pending').first()).toBeVisible();
    await float(page).locator('textarea').fill('Earlier than this?');
    await float(page).locator('textarea').press('Enter');
    await expect(float(page)).toHaveCount(0);
    const id = await modal(page).locator('.tt-comment').first().getAttribute('data-comment-id');
    await expect(thread(page, id)).toBeVisible();
    await expect(thread(page, id).locator('.cmt-text')).toHaveText('Earlier than this?');

    await thread(page, id).locator('.cmt-head').getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Copy link' }).click();
    await expect(toast(page, 'Link copied')).toBeVisible();
    const u = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect(u.searchParams.get('board')).toBe(BOARD);
    expect(u.searchParams.get('card')).toBe(cardId);
    expect(u.searchParams.get('comment')).toBe(id);

    await savedAndClosed(page, app);

    // the link, opened cold: the canvas opens the doc, the doc its thread
    await page.goto(u.pathname + u.search);
    await expect(modal(page)).toBeVisible({ timeout: 60000 });
    await expect(thread(page, id)).toBeVisible({ timeout: 20000 });
    await expect(thread(page, id).locator('.cmt-text')).toHaveText('Earlier than this?');
    await expect(toast(page, GONE)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('comment')).toBe(null);
    await expect.poll(() => new URL(page.url()).searchParams.get('card')).toBe(null);
  });

  test('a link to a comment the doc no longer has says so, once the cluster is in', async ({ page, baseURL }) => {
    const app = await signedIn(page, baseURL);
    await openCluster(page);
    await docWithWords(page);
    const cardId = await page.locator('.canvas-wrap [data-card-id]').first().getAttribute('data-card-id');
    await savedAndClosed(page, app);
    await openCluster(page, `&card=${cardId}&comment=cm_nothere`);
    await expect(modal(page)).toBeVisible({ timeout: 20000 });
    await expect(toast(page, GONE)).toBeVisible({ timeout: 20000 });
    await expect(panel(page)).toBeHidden();
  });
});
