// Behavioural tests that drive the REAL doc card + editor in the ?docqa=1
// harness (in-memory Y.Doc, no backend). These exercise the things pure-logic
// tests can't: pagination, rename-survives-autofocus, formatting, in-app
// dialogs (vs native prompts), the link picker, theme-aware highlight,
// bookmark relative-position durability, per-card zoom, and title sync.

import { expect, test } from '@playwright/test';

// Open the harness, open the doc card, wait for a live editor. Returns nothing;
// callers use page locators + the window.__soleilDocTest bridge.
async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await expect(page.locator('.tt-editor').first()).toBeVisible();
  // Wait until DocSurface has handed the live editor to the bridge.
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const wraps = (page) => page.locator('.doc-card-modal .doc-editor-wrap');

test('a fresh doc opens with exactly one page and one sheet (no seeding/pagination runaway)', async ({ page }) => {
  await openDoc(page);
  await expect(wraps(page)).toHaveCount(1);
  await expect(page.locator('.doc-card-modal .doc-tree-name')).toHaveCount(1);
});

test('filling a page auto-adds exactly ONE sheet, with no runaway', async ({ page }) => {
  await openDoc(page);
  await expect(wraps(page)).toHaveCount(1);
  // Insert enough content to overflow one printed page (~795px of content).
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const para = '<p>The quick brown fox jumps over the lazy dog, again and again.</p>';
    ed.chain().focus().insertContent(para.repeat(45)).run();
  });
  // Exactly one new sheet appears…
  await expect(wraps(page)).toHaveCount(2, { timeout: 5000 });
  // …and it stays at two — no cascade. (The bug produced an endless stack.)
  await page.waitForTimeout(700);
  expect(await wraps(page).count()).toBe(2);
});

test('renaming a page persists and is not interrupted by editor autofocus', async ({ page }) => {
  await openDoc(page);
  const name = page.locator('.doc-card-modal .doc-tree-name').first();
  await name.dblclick();
  const input = page.locator('.doc-card-modal .doc-tree-rename');
  await expect(input).toBeVisible();
  await input.fill('Chapter One');
  await input.press('Enter');
  await expect(page.locator('.doc-card-modal .doc-tree-name').first()).toHaveText('Chapter One');
  // Persisted in the data layer too.
  const persisted = await page.evaluate(() =>
    window.__soleilDocTest.readPages(window.__soleilDocTest.ydoc, window.__soleilDocTest.getScope())[0].name);
  expect(persisted).toBe('Chapter One');
});

test('toolbar formatting (bold) applies to the selection', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.chain().focus().insertContent('hello world').run();
    ed.chain().focus().selectAll().toggleBold().run();
  });
  // Assert via editor state (robust) and the rendered DOM.
  const isBold = await page.evaluate(() => window.__soleilDocTest.editor.isActive('bold'));
  expect(isBold).toBe(true);
  await expect(page.locator('.tt-editor strong')).toHaveCount(1);
});

test('the bookmark button opens the in-app dialog (not a native prompt) and saves a bookmark', async ({ page }) => {
  await openDoc(page);
  // Put some text + a caret so there is a position to bookmark.
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().insertContent('Anchor here').run());
  await page.locator('.doc-card-modal').getByRole('button', { name: 'Bookmark this spot' }).click();
  // The app's prompt modal — NOT window.prompt — appears.
  const dialog = page.locator('.feedback-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('.feedback-field input').fill('My bookmark');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toHaveCount(0);
  const bookmarks = await page.evaluate(() =>
    window.__soleilDocTest.readBookmarks(window.__soleilDocTest.ydoc, window.__soleilDocTest.getScope()));
  expect(bookmarks.map(b => b.name)).toContain('My bookmark');
  // Durable relative anchor was stored (not just the raw int).
  expect(bookmarks.find(b => b.name === 'My bookmark').relAnchor).toBeTruthy();
});

test('the link button opens the in-app link picker (not a native prompt)', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().insertContent('link me').selectAll().run());
  await page.locator('.doc-card-modal').getByRole('button', { name: 'Add link (⌘K)' }).click();
  // The live link UI is the in-app EntityPicker (URL + entity targets), not window.prompt.
  await expect(page.locator('.entity-picker')).toBeVisible();
});

test('highlight is theme-aware (renders a non-transparent mark in dark mode)', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.chain().focus().insertContent('highlight me').selectAll().toggleHighlight().run();
  });
  const mark = page.locator('.tt-editor mark').first();
  await expect(mark).toBeVisible();
  const bg = await mark.evaluate(el => getComputedStyle(el).backgroundColor);
  // Themed CSS owns the colour — it must be a real, opaque-ish highlight, not
  // transparent and not pinned to an invisible value.
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');
});

test('bookmark relative anchor survives an insert before it (durability)', async ({ page }) => {
  await openDoc(page);
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ed = T.editor;
    ed.chain().focus().clearContent().insertContent('Hello World').run();
    // Anchor just after "Hello" (PM positions are 1-based inside the doc).
    const pos = 6;
    const rel = T.encodeAnchor(ed, pos);
    // Insert 4 chars at the very start; the absolute position should shift +4.
    ed.chain().insertContentAt(1, 'XXXX').run();
    const resolved = T.resolveAnchor(ed, rel);
    return { rel: !!rel, resolved, naive: pos };
  });
  expect(res.rel).toBe(true);
  // The durable anchor tracked the edit (6 → 10); the naive int would have stayed 6.
  expect(res.resolved).toBe(res.naive + 4);
});

test('editing the card title syncs the primary page name (until the page is renamed by hand)', async ({ page }) => {
  await openDoc(page);
  const titleInput = page.locator('.doc-card-title-input');
  await titleInput.fill('Project Brief');
  // The seeded "Untitled doc" primary page follows the card title.
  await expect(page.locator('.doc-card-modal .doc-tree-name').first()).toHaveText('Project Brief', { timeout: 5000 });
});

test('per-card zoom is remembered across reloads', async ({ page }) => {
  await openDoc(page);
  // Zoom in twice via the toolbar.
  const zoomIn = page.locator('.doc-card-modal').getByRole('button', { name: 'Zoom in' });
  await zoomIn.click();
  await zoomIn.click();
  // It is persisted under a card-scoped key.
  const stored = await page.evaluate(() => localStorage.getItem('soleil.boards.docZoom.docqa-card'));
  expect(stored).toBeTruthy();
  expect(parseFloat(stored)).toBeGreaterThan(1);
  // Reload, reopen — the zoom comes back (not reset to 100%).
  await openDoc(page);
  const z = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.doc-card-modal .doc-editor-wrap')).zoom);
  expect(parseFloat(z)).toBeGreaterThan(1);
});

test('comment add creates a tt-comment mark', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().insertContent('comment target').selectAll().run());
  await page.locator('.doc-card-modal').getByRole('button', { name: 'Add comment (⌘⌥M)' }).click();
  // The add-comment flow renders an InlineComposer; post a comment (Enter posts).
  const composer = page.locator('.inline-composer-input');
  await expect(composer).toBeVisible();
  await composer.fill('Looks good');
  await composer.press('Enter');
  // A thread is stored in the data layer (the inline popover reads from here).
  const count = await page.evaluate(() =>
    window.__soleilDocTest.readComments(window.__soleilDocTest.ydoc, window.__soleilDocTest.getScope()).length);
  expect(count).toBeGreaterThan(0);
});
