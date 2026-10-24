// The doc editor's frame in the look the owner picked on 2026-10-21 (direction
// A, with C's side panel), held to a dev opt-in (lib/appHost.js
// docLookAllowed): the window's header carries the page list's toggle, the
// cluster › title crumb and the side panel's toggle; the footer runs the
// window's width with the save state, the words and the zoom. With the look
// off, the doc keeps the frame it has today. Driven in the ?docqa=1 harness
// (&cluster= names the cluster the doc sits on).

import { expect, test } from '@playwright/test';
import { setScreenplay } from './helpers/docFrame.js';

async function openDoc(page, { look = true, query = '' } = {}) {
  // Said either way, so a run with the opt-in already stored still has a page
  // with the look off.
  await page.addInitScript((on) => {
    try { window.localStorage.setItem('soleil.dev.docLook', on ? '1' : '0'); } catch (_) {}
  }, look);
  await page.goto(`/?docqa=1${query}`);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const modal = (page) => page.locator('.doc-card-modal');
const head = (page) => modal(page).locator('.dl-head');
const foot = (page) => modal(page).locator('.dl-foot');

test('the header carries the page list, the crumb, Comments, Messages, dock and close, each named', async ({ page }) => {
  await openDoc(page, { query: '&cluster=Feature%20film' });
  await expect(head(page)).toBeVisible();
  const pages = head(page).getByRole('button', { name: 'Hide pages' });
  await expect(pages).toHaveAttribute('aria-expanded', 'true');
  await expect(head(page).locator('.dl-crumb')).toContainText('Feature film');
  await expect(head(page).getByRole('textbox', { name: 'Document title' })).toBeVisible();
  await expect(head(page).getByRole('button', { name: /^Comments/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(head(page).getByRole('button', { name: 'Messages' })).toBeVisible();
  await expect(head(page).getByRole('button', { name: 'Dock beside the canvas' })).toBeVisible();
  await expect(head(page).getByRole('button', { name: 'Close document' })).toBeVisible();
  // Today's header, the rail's own chevron and the phone's page button give
  // way to the header's.
  await expect(modal(page).locator('.doc-card-modal-head')).toHaveCount(0);
  await expect(modal(page).locator('.doc-rail-toggle')).toHaveCount(0);
  await expect(modal(page).locator('.doc-mobile-pages-btn')).toHaveCount(0);
});

test('with no cluster known, the crumb is the title alone', async ({ page }) => {
  await openDoc(page);
  await expect(head(page).locator('.dl-crumb-p')).toHaveCount(0);
  await expect(head(page).getByRole('textbox', { name: 'Document title' })).toBeVisible();
});

test('the page list toggle hides the rail and brings it back, and is remembered', async ({ page }) => {
  await openDoc(page);
  const rail = modal(page).locator('.doc-rail-left');
  await expect(rail).toBeVisible();
  await head(page).getByRole('button', { name: 'Hide pages' }).click();
  await expect(rail).toBeHidden();
  const show = head(page).getByRole('button', { name: 'Show pages' });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soleil.boards.docRails') || '{}').left)).toBe(false);
  await show.click();
  await expect(rail).toBeVisible();
  await expect(rail.locator('.doc-tree-name')).toHaveCount(1);
});

test('the comments toggle opens the side panel beside the page and closes it', async ({ page }) => {
  await openDoc(page);
  const toggle = head(page).getByRole('button', { name: /^Comments/ });
  const panel = modal(page).getByRole('complementary', { name: 'Comments and find' });
  await expect(panel).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('tab', { name: /^Comments/ })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('tab', { name: 'Find' })).toBeVisible();
  // Beside the page, at the window's right edge, under the header.
  const pb = await panel.boundingBox();
  const mb = await modal(page).boundingBox();
  expect(Math.abs((pb.x + pb.width) - (mb.x + mb.width))).toBeLessThan(3);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toHaveCount(0);
});

test('the side panel stays open for the next doc you open', async ({ page }) => {
  await openDoc(page);
  await head(page).getByRole('button', { name: /^Comments/ }).click();
  await head(page).getByRole('button', { name: 'Close document' }).click();
  await expect(modal(page)).toHaveCount(0);
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page).getByRole('complementary', { name: 'Comments and find' })).toBeVisible();
});

test('the footer runs the width of the window: save state, words, zoom', async ({ page }) => {
  await openDoc(page);
  const fb = await foot(page).boundingBox();
  const mb = await modal(page).boundingBox();
  // Under the page list as well as the page.
  expect(Math.abs(fb.x - mb.x)).toBeLessThan(3);
  expect(Math.abs(fb.width - mb.width)).toBeLessThan(3);
  await modal(page).locator('.tt-editor').first().click();
  await page.keyboard.type('two words');
  await expect(foot(page)).toContainText('2 words', { timeout: 3000 });
  const zoom = foot(page).getByRole('button', { name: 'Zoom, 100%' });
  await zoom.click();
  const menu = page.getByRole('menu', { name: 'Zoom' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: '125%' }).click();
  await expect(menu).toHaveCount(0);
  await expect(foot(page).getByRole('button', { name: 'Zoom, 125%' })).toBeVisible();
  await expect(modal(page).locator('.doc-paper')).toHaveAttribute('style', /--doc-zoom:\s*1\.25/);
  // The keys still zoom, and the footer follows.
  await modal(page).locator('.tt-editor').first().click();
  await page.keyboard.press('Control+-');
  await expect(foot(page).getByRole('button', { name: 'Zoom, 115%' })).toBeVisible();
});

test('a screenplay\'s footer says the page the caret is on, of how many, and the scenes', async ({ page }) => {
  await openDoc(page);
  await setScreenplay(modal(page), true);
  await expect(modal(page).locator('.doc-paper.is-screenplay')).toBeVisible();
  await page.waitForFunction(() => {
    const ed = window.__soleilDocTest.editor;
    return !!ed && !ed.isDestroyed && ed.schema.nodes.screenplayBlock && ed.isEditable;
  }, null, { timeout: 10000 });
  const pages = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const S = T.screenplay;
    const blocks = [];
    for (let s = 0; s < 4; s++) {
      blocks.push({ element: 'scene', text: `INT. ROOM ${s} - DAY` });
      blocks.push({ element: 'action', text: ('word ').repeat(60 * 12).trim() });
      blocks.push({ element: 'character', text: 'SPEAKER' });
      blocks.push({ element: 'dialogue', text: ('talk ').repeat(35 * 8).trim() });
    }
    T.editor.chain().setContent(S.blocksToDocJSON(blocks)).setTextSelection(1).run();
    return S.paginate(blocks).pageCount;
  });
  expect(pages).toBeGreaterThanOrEqual(2);
  const counts = foot(page).locator('.dl-foot-words');
  await expect(counts).toHaveText(`Page 1 of ${pages} · 4 scenes`, { timeout: 3000 });
  // The caret at the end is on the last page.
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
  });
  await expect(counts).toHaveText(`Page ${pages} of ${pages} · 4 scenes`, { timeout: 3000 });
  // A document says its words again.
  await setScreenplay(modal(page), false);
  await expect(counts).toHaveText(/^[\d,]+ words?$/, { timeout: 3000 });
});

test('a view-only member sees View only beside the title, and no Share', async ({ page }) => {
  await openDoc(page, { query: '&viewer=1&cluster=Feature%20film' });
  await expect(head(page).locator('.dl-chip')).toHaveText('View only');
  await expect(head(page).getByRole('button', { name: /^Share/ })).toHaveCount(0);
  await expect(head(page).getByRole('textbox', { name: 'Document title' })).toHaveAttribute('readonly', '');
});

test('with the look off, the doc keeps today\'s frame', async ({ page }) => {
  await openDoc(page, { look: false, query: '&cluster=Feature%20film' });
  await expect(modal(page).locator('.doc-card-modal-head')).toBeVisible();
  await expect(modal(page).locator('.dl-head')).toHaveCount(0);
  await expect(modal(page).locator('.doc-rail-toggle')).toHaveCount(1);
  await expect(modal(page).locator('.doc-center > .doc-foot')).toHaveCount(1);
  await expect(modal(page).locator('.dl-foot')).toHaveCount(0);
});
