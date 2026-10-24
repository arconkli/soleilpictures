// An image going into a doc (A1.2, 2026-10-20). It is uploaded as the cluster's
// image (boardId), on its card (cardId), under the name the file had — so a
// person the cluster is shared with can see it, and an editor the cluster is
// shared with can add one at all (the upload party authorizes by the board).
// While it uploads, the spot it will land in shows it and how far it has got;
// none of that is written into the shared doc until the image lands; a failed
// upload says so in place, with Retry and Remove.
//
// ?docqa=1&uploads=1: the harness gives the doc a workspace, a host cluster and
// a stand-in for R2 (window.__soleilDocTest.uploads) the spec drives by hand.
import { expect, test } from '@playwright/test';
import { insertRow } from './helpers/docFrame.js';
import path from 'node:path';

const PHOTO = path.resolve('src/local/qa-photos/street.jpg');

async function openWithUploads(page) {
  // A workspace makes the doc reach for Supabase (tags, backlinks); the suite's
  // backend is a stand-in host, so keep those calls off the network.
  await page.route(/example\.supabase\.co/, (route) => route.abort());
  await page.goto('/?docqa=1&uploads=1');
  await page.waitForFunction(() => !!window.__soleilDocTest?.uploads, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setContent('<p>Before the image.</p><p>After the image.</p>');
    // The caret at the end of the first paragraph: where the image will go.
    ed.commands.focus();
    ed.commands.setTextSelection(1 + 'Before the image.'.length);
  });
}

async function pickFromToolbar(page) {
  const chooser = page.waitForEvent('filechooser');
  await insertRow(page.locator('.doc-card-modal'), /Image/);
  await (await chooser).setFiles(PHOTO);
}

// Text and images in reading order, `|` between nodes.
const readingOrder = (page) => page.evaluate(() => {
  const out = [];
  window.__soleilDocTest.editor.state.doc.descendants((n) => {
    if (n.type.name === 'image') out.push('[image]');
    else if (n.isText) out.push(n.text);
  });
  return out.join('|');
});

const uploads = (page) => page.evaluate(() => window.__soleilDocTest.uploads.calls);
const docJson = (page) => page.evaluate(() => JSON.stringify(window.__soleilDocTest.editor.getJSON()));
const placeholder = (page) => page.locator('.doc-card-modal .doc-upload');

test('an image from the toolbar is uploaded as the cluster\'s, on its card, under its own name', async ({ page }) => {
  await openWithUploads(page);
  await pickFromToolbar(page);
  await expect.poll(() => uploads(page)).toHaveLength(1);
  expect((await uploads(page))[0]).toEqual({
    workspaceId: 'docqa-workspace',
    userId: 'docqa-user',
    boardId: 'docqa-board',
    cardId: 'docqa-card',
    originalName: 'street.jpg',
  });
});

test('while it uploads, its spot shows the picture and how far it has got, and nothing is written into the doc', async ({ page }) => {
  await openWithUploads(page);
  await pickFromToolbar(page);
  await expect(placeholder(page)).toBeVisible();
  await expect(placeholder(page)).toContainText('street.jpg');
  await page.evaluate(() => window.__soleilDocTest.uploads.progress(0.4));
  await expect(placeholder(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  await expect(placeholder(page)).toContainText('40%');
  // Local to this editor: the shared doc holds no image, and no placeholder.
  expect(await docJson(page)).not.toContain('"image"');
  expect(await docJson(page)).not.toContain('doc-upload');
});

test('when it lands, the image takes the placeholder\'s spot, even after text was typed above it', async ({ page }) => {
  await openWithUploads(page);
  await pickFromToolbar(page);
  await expect(placeholder(page)).toBeVisible();
  // Someone types a new first line while the upload runs.
  await page.evaluate(() => window.__soleilDocTest.editor.commands.insertContentAt(1, 'A new first line. '));
  await page.evaluate(() => window.__soleilDocTest.uploads.finish());
  await expect(placeholder(page)).toHaveCount(0);
  await expect(page.locator('.doc-card-modal .ProseMirror img')).toHaveCount(1);
  // Still right after the sentence it was dropped after, not where the
  // caret was nor where the old position now points.
  expect(await readingOrder(page)).toBe('A new first line. Before the image.|[image]|After the image.');
});

test('a collaborator typing above it moves its spot too', async ({ page }) => {
  await openWithUploads(page);
  await pickFromToolbar(page);
  await expect(placeholder(page)).toBeVisible();
  // As a peer's edit arrives: straight into the shared doc, from another
  // origin, which y-prosemirror hands the editor as a whole-document replace.
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const pageId = T.readPages(T.ydoc, T.getScope())[0].id;
    const firstLine = T.getOrCreatePageContent(T.ydoc, pageId, T.getScope()).get(0).get(0);
    T.ydoc.transact(() => firstLine.insert(0, 'A new first line. '), 'docqa-peer');
  });
  await expect.poll(() => readingOrder(page)).toBe('A new first line. Before the image.|After the image.');
  await page.evaluate(() => window.__soleilDocTest.uploads.finish());
  await expect(placeholder(page)).toHaveCount(0);
  expect(await readingOrder(page)).toBe('A new first line. Before the image.|[image]|After the image.');
});

test('landing leaves your caret where you were typing', async ({ page }) => {
  await openWithUploads(page);
  await pickFromToolbar(page);
  await expect(placeholder(page)).toBeVisible();
  // Gone on writing elsewhere: the caret at the end of the second line.
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
  });
  const caret = () => page.evaluate(() => {
    const { $from, empty } = window.__soleilDocTest.editor.state.selection;
    return { empty, line: $from.parent.textContent, offset: $from.parentOffset };
  });
  expect(await caret()).toEqual({ empty: true, line: 'After the image.', offset: 'After the image.'.length });
  await page.evaluate(() => window.__soleilDocTest.uploads.finish());
  // (The placeholder's thumbnail is an <img> too: wait for it to go.)
  await expect(placeholder(page)).toHaveCount(0);
  await expect(page.locator('.doc-card-modal .ProseMirror img')).toHaveCount(1);
  expect(await caret()).toEqual({ empty: true, line: 'After the image.', offset: 'After the image.'.length });
});

test('undo takes back a landed image on its own, not the typing just before it', async ({ page }) => {
  await openWithUploads(page);
  await pickFromToolbar(page);
  await expect(placeholder(page)).toBeVisible();
  await page.locator('.doc-card-modal .ProseMirror p').nth(1).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More.');
  await page.evaluate(() => window.__soleilDocTest.uploads.finish());
  await expect(placeholder(page)).toHaveCount(0);
  await expect(page.locator('.doc-card-modal .ProseMirror img')).toHaveCount(1);
  // The harness's Chrome reports Windows, so the editor's Mod is Control.
  await page.keyboard.press('Control+z');
  await expect(page.locator('.doc-card-modal .ProseMirror img')).toHaveCount(0);
  expect(await readingOrder(page)).toBe('Before the image.|After the image. More.');
});

test('pasting an image over selected text replaces the text', async ({ page }) => {
  await openWithUploads(page);
  await page.evaluate(async () => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setTextSelection({ from: 1, to: 1 + 'Before the image.'.length });
    const bytes = await (await fetch('/src/local/qa-photos/street.jpg')).arrayBuffer();
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'street.jpg', { type: 'image/jpeg' }));
    ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(placeholder(page)).toBeVisible();
  await page.evaluate(() => window.__soleilDocTest.uploads.finish());
  await expect(placeholder(page)).toHaveCount(0);
  expect(await readingOrder(page)).toBe('[image]|After the image.');
});

test('Cancel takes a running upload away, and it places nothing when it finishes', async ({ page }) => {
  await openWithUploads(page);
  const before = await docJson(page);
  await pickFromToolbar(page);
  await placeholder(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(placeholder(page)).toHaveCount(0);
  await page.evaluate(() => window.__soleilDocTest.uploads.finish());
  await page.waitForTimeout(300);
  await expect(page.locator('.doc-card-modal .ProseMirror img')).toHaveCount(0);
  expect(await docJson(page)).toBe(before);
});

test('a pasted image goes up the same way', async ({ page }) => {
  await openWithUploads(page);
  await page.evaluate(async () => {
    const bytes = await (await fetch('/src/local/qa-photos/street.jpg')).arrayBuffer();
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'street.jpg', { type: 'image/jpeg' }));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    window.__soleilDocTest.editor.view.dom.dispatchEvent(ev);
  });
  await expect.poll(() => uploads(page)).toHaveLength(1);
  expect((await uploads(page))[0]).toMatchObject({ boardId: 'docqa-board', cardId: 'docqa-card', originalName: 'street.jpg' });
  await expect(placeholder(page)).toBeVisible();
});

test('a dropped image goes up the same way, where it was dropped', async ({ page }) => {
  await openWithUploads(page);
  const box = await page.locator('.doc-card-modal .ProseMirror p').nth(1).boundingBox();
  await page.evaluate(async ({ x, y }) => {
    const bytes = await (await fetch('/src/local/qa-photos/street.jpg')).arrayBuffer();
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'street.jpg', { type: 'image/jpeg' }));
    const target = document.elementFromPoint(x, y);
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { x: box.x + 2, y: box.y + box.height / 2 });
  await expect.poll(() => uploads(page)).toHaveLength(1);
  expect((await uploads(page))[0]).toMatchObject({ boardId: 'docqa-board', cardId: 'docqa-card', originalName: 'street.jpg' });
  await page.evaluate(() => window.__soleilDocTest.uploads.finish());
  await expect(placeholder(page)).toHaveCount(0);
  // Dropped at the start of the second line: it goes in before it.
  expect(await readingOrder(page)).toBe('Before the image.|[image]|After the image.');
});

test('a failed upload says so in its spot, and Retry sends it again', async ({ page }) => {
  await openWithUploads(page);
  await pickFromToolbar(page);
  await page.evaluate(() => window.__soleilDocTest.uploads.fail('The connection dropped.'));
  await expect(placeholder(page)).toHaveClass(/is-failed/);
  await expect(placeholder(page).getByRole('alert')).toContainText("Couldn't upload street.jpg");
  await placeholder(page).getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => uploads(page)).toHaveLength(2);
  await expect(placeholder(page)).not.toHaveClass(/is-failed/);
  await page.evaluate(() => window.__soleilDocTest.uploads.finish());
  await expect(placeholder(page)).toHaveCount(0);
  await expect(page.locator('.doc-card-modal .ProseMirror img')).toHaveCount(1);
});

test('Remove takes a failed upload away and leaves the doc as it was', async ({ page }) => {
  await openWithUploads(page);
  const before = await docJson(page);
  await pickFromToolbar(page);
  await page.evaluate(() => window.__soleilDocTest.uploads.fail('The connection dropped.'));
  await placeholder(page).getByRole('button', { name: 'Remove' }).click();
  await expect(placeholder(page)).toHaveCount(0);
  expect(await docJson(page)).toBe(before);
});
